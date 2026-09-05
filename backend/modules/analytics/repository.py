"""Bounded batch reads from one SQLite snapshot. No bootstraps, writes or N+1."""

from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
import sqlite3

from backend.modules.analytics.core import close_timestamp, matches_trade
from backend.modules.analytics.registry import MAX_PLAN_ROWS, MAX_TRADES
from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_assignments import repository as assignments
from backend.utils.error_handler import APIError, ValidationError


@dataclass(frozen=True)
class AnalyticsSnapshot:
    entries: list
    assignments: dict
    linked_plans: dict
    excluded_unavailable_close_count: int = 0


def _bounded_rows(conn, sql, limit):
    rows = conn.execute(sql).fetchmany(limit + 1)
    if len(rows) > limit:
        raise ValidationError("Analytics snapshot limit exceeded")
    return rows


def _read_journal(conn):
    rows = _bounded_rows(conn, f"SELECT {', '.join(journal.JOURNAL_COLUMNS)} FROM {journal.TABLE_NAME} ORDER BY id", MAX_TRADES)
    entries = []
    for row in rows:
        entry = journal._row_to_dict(row)
        # SQLite stores bool as 0/1. Preserve malformed historical values instead
        # of inheriting the general Journal decoder's bool(any non-null value).
        for field in ("fomo", "revenge_trade"):
            value = row[field]
            entry[field] = bool(value) if type(value) is int and value in (0, 1) else value
        entries.append(entry)
    return entries


def _read_assignments(conn):
    rows = _bounded_rows(conn, f"""
        SELECT a.journal_entry_id, a.strategy_version_id, v.strategy_id,
               v.version_label, v.rules_json, s.name AS strategy_name
        FROM {assignments.ASSIGNMENT_TABLE} a
        LEFT JOIN {strategies.VERSION_TABLE} v ON v.id = a.strategy_version_id
        LEFT JOIN {strategies.STRATEGY_TABLE} s ON s.id = v.strategy_id
        ORDER BY a.journal_entry_id
    """, MAX_TRADES)
    result = {}
    for row in rows:
        if row["strategy_id"] is None or row["strategy_name"] is None:
            raise APIError("Assignment provenance is unavailable", status_code=503)
        item = dict(row)
        item["version_rules"] = strategies._decode_rules(item.pop("rules_json"))
        result[int(row["journal_entry_id"])] = item
    return result


def _read_plans(conn, entries):
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    plan_tables = {plans.PLAN_TABLE, plans.LINK_TABLE, plans.REVISION_TABLE}
    if not tables.intersection(plan_tables):
        return {}
    if not plan_tables.issubset(tables):
        raise APIError("Plan schema is unavailable", status_code=503)
    rows = _bounded_rows(conn, f"""
        SELECT p.*, l.id AS _link_id, l.journal_entry_id AS _journal_id,
               l.journal_external_id AS _external_id, l.link_status AS _status
        FROM {plans.LINK_TABLE} l JOIN {plans.PLAN_TABLE} p ON p.id = l.plan_id
        ORDER BY p.id
    """, MAX_PLAN_ROWS)
    revisions = defaultdict(list)
    for row in _bounded_rows(conn, f"SELECT * FROM {plans.REVISION_TABLE} ORDER BY plan_id, version", MAX_PLAN_ROWS):
        revisions[int(row["plan_id"])].append(dict(row))
    by_id, by_external = defaultdict(dict), defaultdict(dict)
    for row in rows:
        plan_id = int(row["id"])
        plan = {key: row[key] for key in row.keys() if not key.startswith("_")}
        plan["revisions"] = revisions[plan_id]
        plan["latest_revision"] = revisions[plan_id][-1] if revisions[plan_id] else None
        plan["link"] = {"id": row["_link_id"], "plan_id": plan_id, "journal_entry_id": row["_journal_id"],
                        "journal_external_id": row["_external_id"], "link_status": row["_status"]}
        by_id[row["_journal_id"]][plan_id] = plan
        if row["_external_id"]:
            by_external[row["_external_id"]][plan_id] = plan
    linked = {}
    for entry in entries:
        candidates = {**by_id.get(entry["id"], {}), **by_external.get(str(entry.get("external_id") or "").strip(), {})}
        if len(candidates) > 1:
            raise APIError("Journal has multiple linked Plan candidates", status_code=503)
        if candidates:
            linked[entry["id"]] = next(iter(candidates.values()))
    return linked


def load_snapshot(query, *, db_path: Path | None = None, include_plans=False):
    path = Path(db_path or journal.JOURNAL_DB_PATH).resolve()
    if not path.exists():
        return AnalyticsSnapshot([], {}, {})
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        conn.execute("BEGIN")
        entries = _read_journal(conn)
        assignment_map = _read_assignments(conn)
        excluded = sum(str(entry.get("source") or "").endswith("_position") and close_timestamp(entry) is None for entry in entries)
        selected = [entry for entry in entries if matches_trade(entry, assignment_map.get(entry["id"]), query.filters)]
        linked = _read_plans(conn, [entry for entry in selected if entry["id"] in assignment_map]) if include_plans else {}
        return AnalyticsSnapshot(selected, assignment_map, linked, excluded)
