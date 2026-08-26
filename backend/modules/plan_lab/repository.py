"""SQLite persistence for plans, immutable revisions, and stable trade links."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.modules.journal import repository as journal_repository
from backend.modules.journal.trade_selection import timestamp_ms

PLAN_TABLE = "trading_plans"
REVISION_TABLE = "trading_plan_revisions"
LINK_TABLE = "trading_plan_links"
PLAN_SOURCES = {"UNLINKED", "RETROSPECTIVE", "VERIFIED_PRETRADE"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_symbol(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper().split(":", 1)[0])


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS {PLAN_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exchange TEXT NOT NULL,
            symbol TEXT NOT NULL,
            symbol_key TEXT NOT NULL,
            side TEXT NOT NULL CHECK(side IN ('Long', 'Short')),
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'linked', 'cancelled')),
            source TEXT NOT NULL DEFAULT 'UNLINKED',
            client_created_at TEXT,
            received_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS {REVISION_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL REFERENCES {PLAN_TABLE}(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            entry_price REAL,
            entry_min REAL,
            entry_max REAL,
            stop_loss REAL NOT NULL,
            take_profit REAL NOT NULL,
            setup TEXT,
            entry_note TEXT,
            exit_note TEXT,
            memo TEXT,
            max_hold_hours REAL,
            client_created_at TEXT,
            received_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(plan_id, version)
        );
        CREATE TABLE IF NOT EXISTS {LINK_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL UNIQUE REFERENCES {PLAN_TABLE}(id) ON DELETE CASCADE,
            journal_entry_id INTEGER,
            journal_external_id TEXT,
            link_status TEXT NOT NULL CHECK(link_status IN ('LINKED', 'AMBIGUOUS_LINK')),
            linked_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS {LINK_TABLE}_external_unique
        ON {LINK_TABLE}(journal_external_id)
        WHERE journal_external_id IS NOT NULL AND link_status = 'LINKED';
        CREATE INDEX IF NOT EXISTS {PLAN_TABLE}_lookup
        ON {PLAN_TABLE}(exchange, symbol_key, side, status, received_at);
        """
    )
    plan_columns = {str(row[1]) for row in conn.execute(f"PRAGMA table_info({PLAN_TABLE})")}
    if "source" not in plan_columns:
        conn.execute(f"ALTER TABLE {PLAN_TABLE} ADD COLUMN source TEXT NOT NULL DEFAULT 'UNLINKED'")
    revision_columns = {str(row[1]) for row in conn.execute(f"PRAGMA table_info({REVISION_TABLE})")}
    if "max_hold_hours" not in revision_columns:
        conn.execute(f"ALTER TABLE {REVISION_TABLE} ADD COLUMN max_hold_hours REAL")


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    conn = journal_repository._connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    _ensure_schema(conn)
    return conn


def _revision_payload(revision: Dict[str, Any], server_time: str) -> tuple[Any, ...]:
    return (
        revision.get("entry_price"), revision.get("entry_min"), revision.get("entry_max"),
        revision["stop_loss"], revision["take_profit"],
        (str(revision.get("setup") or "").strip() or None),
        (str(revision.get("entry_note") or "").strip() or None),
        (str(revision.get("exit_note") or "").strip() or None),
        (str(revision.get("memo") or "").strip() or None),
        revision.get("max_hold_hours"),
        revision.get("client_created_at"), server_time, server_time,
    )


def create_plan(payload: Dict[str, Any], *, db_path: Optional[Path] = None) -> Dict[str, Any]:
    server_time = utc_now()
    with _connect(db_path) as conn:
        cursor = conn.execute(
            f"""INSERT INTO {PLAN_TABLE}
            (exchange, symbol, symbol_key, side, status, source, client_created_at, received_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', 'UNLINKED', ?, ?, ?, ?)""",
            (
                str(payload["exchange"]).strip().lower(), str(payload["symbol"]).strip().upper(),
                normalize_symbol(payload["symbol"]), payload["side"], payload.get("client_created_at"),
                server_time, server_time, server_time,
            ),
        )
        plan_id = int(cursor.lastrowid)
        conn.execute(
            f"""INSERT INTO {REVISION_TABLE}
            (plan_id, version, entry_price, entry_min, entry_max, stop_loss, take_profit,
             setup, entry_note, exit_note, memo, max_hold_hours, client_created_at, received_at, created_at)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (plan_id, *_revision_payload(payload["revision"], server_time)),
        )
        conn.commit()
    return get_plan(plan_id, db_path=db_path)


def add_revision(plan_id: int, revision: Dict[str, Any], *, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    server_time = utc_now()
    with _connect(db_path) as conn:
        plan = conn.execute(f"SELECT id FROM {PLAN_TABLE} WHERE id = ?", (plan_id,)).fetchone()
        if plan is None:
            return None
        version = int(conn.execute(
            f"SELECT COALESCE(MAX(version), 0) + 1 FROM {REVISION_TABLE} WHERE plan_id = ?", (plan_id,),
        ).fetchone()[0])
        conn.execute(
            f"""INSERT INTO {REVISION_TABLE}
            (plan_id, version, entry_price, entry_min, entry_max, stop_loss, take_profit,
             setup, entry_note, exit_note, memo, max_hold_hours, client_created_at, received_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (plan_id, version, *_revision_payload(revision, server_time)),
        )
        conn.execute(f"UPDATE {PLAN_TABLE} SET updated_at = ? WHERE id = ?", (server_time, plan_id))
        conn.commit()
    return get_plan(plan_id, db_path=db_path)


def _row_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def get_plan(plan_id: int, *, db_path: Optional[Path] = None) -> Dict[str, Any]:
    with _connect(db_path) as conn:
        plan_row = conn.execute(f"SELECT * FROM {PLAN_TABLE} WHERE id = ?", (plan_id,)).fetchone()
        if plan_row is None:
            raise KeyError("Plan not found")
        revisions = [_row_dict(row) for row in conn.execute(
            f"SELECT * FROM {REVISION_TABLE} WHERE plan_id = ? ORDER BY version ASC", (plan_id,),
        ).fetchall()]
        link_row = conn.execute(f"SELECT * FROM {LINK_TABLE} WHERE plan_id = ?", (plan_id,)).fetchone()
        result = _row_dict(plan_row)
        result["revisions"] = revisions
        result["latest_revision"] = revisions[-1]
        result["link"] = _row_dict(link_row) if link_row is not None else None
        return result


def list_plans(*, db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    reconcile_links(db_path=db_path)
    with _connect(db_path) as conn:
        ids = [int(row[0]) for row in conn.execute(f"SELECT id FROM {PLAN_TABLE} ORDER BY received_at DESC").fetchall()]
    return [get_plan(plan_id, db_path=db_path) for plan_id in ids]


def update_status(plan_id: int, status: str, *, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        cursor = conn.execute(
            f"UPDATE {PLAN_TABLE} SET status = ?, updated_at = ? WHERE id = ?",
            (status, utc_now(), plan_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_plan(plan_id, db_path=db_path)


def link_plan(plan_id: int, journal_entry_id: int, *, db_path: Optional[Path] = None) -> Dict[str, Any]:
    entries = {int(entry["id"]): entry for entry in journal_repository.list_entries(db_path=db_path)}
    entry = entries.get(journal_entry_id)
    if entry is None:
        raise ValueError("Journal entry not found")
    plan = get_plan(plan_id, db_path=db_path)
    if normalize_symbol(entry.get("symbol")) != plan["symbol_key"] or entry.get("direction") != plan["side"]:
        raise ValueError("Plan and trade symbol/side do not match")
    plan_exchange = str(plan.get("exchange") or "").lower()
    trade_exchange = str(entry.get("exchange") or "").lower()
    if plan_exchange and trade_exchange and plan_exchange != trade_exchange:
        raise ValueError("Plan and trade exchange do not match")
    external_id = str(entry.get("external_id") or "").strip() or None
    link_status = "LINKED" if external_id is not None else "AMBIGUOUS_LINK"
    entry_ms = timestamp_ms(entry.get("entry_datetime"))
    verified_revision = any(
        received_ms is not None and entry_ms is not None and received_ms < entry_ms
        for received_ms in (timestamp_ms(item.get("received_at")) for item in plan.get("revisions") or [])
    )
    plan_source = "VERIFIED_PRETRADE" if verified_revision else "RETROSPECTIVE"
    server_time = utc_now()
    with _connect(db_path) as conn:
        existing = conn.execute(
            f"SELECT journal_entry_id, journal_external_id FROM {LINK_TABLE} WHERE plan_id=?",
            (plan_id,),
        ).fetchone()
        if existing is not None:
            same_internal = existing["journal_entry_id"] is not None and int(existing["journal_entry_id"]) == journal_entry_id
            same_external = bool(external_id) and existing["journal_external_id"] == external_id
            if same_internal or same_external:
                return get_plan(plan_id, db_path=db_path)
            raise ValueError("Plan is already linked to a different trade")
        if external_id is not None:
            conflict = conn.execute(
                f"SELECT plan_id FROM {LINK_TABLE} WHERE journal_external_id=? AND link_status='LINKED' AND plan_id<>?",
                (external_id, plan_id),
            ).fetchone()
            if conflict is not None:
                raise ValueError("Trade is already linked to another plan")
        conn.execute(
            f"""INSERT INTO {LINK_TABLE}
            (plan_id, journal_entry_id, journal_external_id, link_status, linked_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (plan_id, journal_entry_id, external_id, link_status, server_time, server_time),
        )
        conn.execute(
            f"UPDATE {PLAN_TABLE} SET status='linked', source=?, updated_at=? WHERE id=?",
            (plan_source, server_time, plan_id),
        )
        conn.commit()
    return get_plan(plan_id, db_path=db_path)


def reconcile_links(*, db_path: Optional[Path] = None) -> None:
    """Repair stable links and reclassify their source from server timestamps."""
    entries = journal_repository.list_entries(db_path=db_path)
    by_id = {int(entry["id"]): entry for entry in entries}
    by_external = {str(entry.get("external_id")): entry for entry in entries if entry.get("external_id")}
    with _connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT id, plan_id, journal_entry_id, journal_external_id FROM {LINK_TABLE}"
        ).fetchall()
        for row in rows:
            external_id = row["journal_external_id"]
            external_entry = by_external.get(str(external_id)) if external_id else None
            repaired = int(external_entry["id"]) if external_entry is not None else None
            current = row["journal_entry_id"]
            if repaired is not None and repaired != current:
                conn.execute(f"UPDATE {LINK_TABLE} SET journal_entry_id=?, updated_at=? WHERE id=?", (repaired, utc_now(), row["id"]))
            elif current is not None and int(current) not in by_id and repaired is None:
                conn.execute(f"UPDATE {LINK_TABLE} SET journal_entry_id=NULL, link_status='AMBIGUOUS_LINK', updated_at=? WHERE id=?", (utc_now(), row["id"]))

            linked_entry = external_entry or (by_id.get(int(current)) if current is not None else None)
            if linked_entry is None:
                conn.execute(
                    f"UPDATE {PLAN_TABLE} SET source='UNLINKED' WHERE id=?",
                    (row["plan_id"],),
                )
                continue
            entry_ms = timestamp_ms(linked_entry.get("entry_datetime"))
            received_times = conn.execute(
                f"SELECT received_at FROM {REVISION_TABLE} WHERE plan_id=?",
                (row["plan_id"],),
            ).fetchall()
            verified = entry_ms is not None and any(
                (received_ms := timestamp_ms(revision["received_at"])) is not None
                and received_ms < entry_ms
                for revision in received_times
            )
            source = "VERIFIED_PRETRADE" if verified else "RETROSPECTIVE"
            conn.execute(
                f"UPDATE {PLAN_TABLE} SET source=? WHERE id=?",
                (source, row["plan_id"]),
            )
        conn.commit()


def annotate_revisions(plan: Dict[str, Any], entry_time: Any, exit_time: Any) -> Dict[str, Any]:
    entry_ms = timestamp_ms(entry_time)
    exit_ms = timestamp_ms(exit_time)
    effective: Optional[Dict[str, Any]] = None
    annotated = []
    for revision in plan["revisions"]:
        received_ms = timestamp_ms(revision.get("received_at"))
        if entry_ms is None or received_ms is None:
            phase = "NOT_LINKED"
        elif received_ms < entry_ms:
            phase = "PRE_TRADE"
            effective = revision
        elif exit_ms is not None and received_ms > exit_ms:
            phase = "POST_TRADE_INPUT"
        else:
            phase = "POST_ENTRY_EDIT"
        annotated.append({**revision, "phase": phase})
    source = str(plan.get("source") or "UNLINKED")
    if source == "RETROSPECTIVE" and annotated:
        effective = annotated[-1]
    return {
        **plan,
        "revisions": annotated,
        "plan_initial": annotated[0] if annotated else None,
        "plan_effective_at_entry": effective,
        "plan_source": source,
    }


def create_retrospective_plan(
    payload: Dict[str, Any], journal_entry_id: int, *, db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Create a hindsight-labelled plan and explicitly attach it to one closed trade."""
    plan = create_plan(payload, db_path=db_path)
    return link_plan(int(plan["id"]), journal_entry_id, db_path=db_path)
