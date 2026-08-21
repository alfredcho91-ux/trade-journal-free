"""SQLite-backed persistence helpers for the trading journal."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import pandas as pd

from backend.config.settings import JOURNAL_COLUMNS, JOURNAL_CSV_PATH, JOURNAL_DB_PATH

TABLE_NAME = "journal_entries"
INSERTABLE_COLUMNS = [col for col in JOURNAL_COLUMNS if col != "id"]
OPTIONAL_SCHEMA_COLUMNS = {
    "entry_datetime": "TEXT",
    "entry_reason_1_indicator": "TEXT",
    "entry_reason_1": "TEXT",
    "entry_reason_2_indicator": "TEXT",
    "entry_reason_2": "TEXT",
    "entry_reason_3_indicator": "TEXT",
    "entry_reason_3": "TEXT",
    "indicators": "TEXT",
    "source": "TEXT",
    "external_id": "TEXT",
    "exchange": "TEXT",
    "order_id": "TEXT",
    "fee": "REAL",
    "fee_currency": "TEXT",
    "funding_fee": "REAL",
    "realized_pnl": "REAL",
    "leverage": "REAL",
    "invested_amount": "REAL",
    "pnl_calculation_version": "INTEGER",
    "indicator_snapshot": "TEXT",
}
EXCHANGE_REFRESH_COLUMNS = [
    "datetime",
    "entry_datetime",
    "symbol",
    "timeframe",
    "direction",
    "size",
    "entry_price",
    "exit_price",
    "pnl_pct",
    "outcome",
    "tags",
    "notes",
    "exchange",
    "order_id",
    "fee",
    "fee_currency",
    "funding_fee",
    "realized_pnl",
    "leverage",
    "invested_amount",
    "pnl_calculation_version",
]
SCHEMA_LOCK = threading.Lock()
INITIALIZED_DATABASES: Set[str] = set()


def _normalize_indicator_name(value: Any) -> Optional[str]:
    value = _clean_value(value)
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    upper_text = text.upper()
    if upper_text.startswith("EMA "):
        return "MA"
    if text in {"이평선", "이동평균선"}:
        return "MA"
    if upper_text == "MA":
        return "MA"

    return text


def _clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set, dict)):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _resolve_db_path(db_path: Optional[Path] = None) -> Path:
    return db_path or JOURNAL_DB_PATH


def _resolve_csv_path(csv_path: Optional[Path] = None) -> Path:
    return csv_path or JOURNAL_CSV_PATH


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    db_path = _resolve_db_path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    database = conn.execute("PRAGMA database_list").fetchone()
    database_key = str(database[2]) if database is not None else ":memory:"
    with SCHEMA_LOCK:
        if database_key in INITIALIZED_DATABASES:
            return
        conn.execute(
            f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            datetime TEXT,
            entry_datetime TEXT,
            symbol TEXT,
            timeframe TEXT,
            direction TEXT,
            entry_reason_1_indicator TEXT,
            entry_reason_1 TEXT,
            entry_reason_2_indicator TEXT,
            entry_reason_2 TEXT,
            entry_reason_3_indicator TEXT,
            entry_reason_3 TEXT,
            indicators TEXT,
            size REAL,
            entry_price REAL,
            exit_price REAL,
            pnl_pct REAL,
            r_multiple REAL,
            outcome TEXT,
            emotion TEXT,
            tags TEXT,
            mistakes TEXT,
            notes TEXT,
            source TEXT,
            external_id TEXT,
            exchange TEXT,
            order_id TEXT,
            fee REAL,
            fee_currency TEXT,
            funding_fee REAL,
            realized_pnl REAL,
            leverage REAL,
            invested_amount REAL,
            pnl_calculation_version INTEGER,
            indicator_snapshot TEXT,
            created_at TEXT
        )
        """
        )
        existing_columns = {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({TABLE_NAME})").fetchall()
        }
        for column, column_type in OPTIONAL_SCHEMA_COLUMNS.items():
            if column not in existing_columns:
                conn.execute(
                    f"ALTER TABLE {TABLE_NAME} ADD COLUMN {column} {column_type}"
                )
        _migrate_signed_pnl(conn)
        conn.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {TABLE_NAME}_external_id_unique
            ON {TABLE_NAME} (external_id)
            WHERE external_id IS NOT NULL
            """
        )
        conn.commit()
        INITIALIZED_DATABASES.add(database_key)


def _migrate_signed_pnl(conn: sqlite3.Connection) -> None:
    signed_pnl = """
        realized_pnl
        + ABS(COALESCE(fee, 0)) - COALESCE(fee, 0)
        + ABS(COALESCE(funding_fee, 0)) + COALESCE(funding_fee, 0)
    """
    conn.execute(
        f"""
        UPDATE {TABLE_NAME}
        SET realized_pnl = {signed_pnl},
            outcome = CASE
                WHEN ({signed_pnl}) > 0 THEN 'Win'
                WHEN ({signed_pnl}) < 0 THEN 'Loss'
                ELSE 'Breakeven'
            END,
            pnl_calculation_version = 2
        WHERE source = 'deepcoin_position'
          AND realized_pnl IS NOT NULL
          AND COALESCE(pnl_calculation_version, 1) < 2
        """
    )


def _table_has_rows(conn: sqlite3.Connection) -> bool:
    row = conn.execute(f"SELECT 1 FROM {TABLE_NAME} LIMIT 1").fetchone()
    return row is not None


def _normalize_record(record: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for column in JOURNAL_COLUMNS:
        normalized[column] = _normalize_column_value(column, record.get(column))
    return normalized


def _normalize_indicator_list(value: Any) -> Optional[str]:
    value = _clean_value(value)
    if value is None:
        return None

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            parsed = [
                normalized
                for item in stripped.split(",")
                if (normalized := _normalize_indicator_name(item)) is not None
            ]
        else:
            if isinstance(parsed, list):
                parsed = [
                    normalized
                    for item in parsed
                    if (normalized := _normalize_indicator_name(item)) is not None
                ]
            else:
                normalized = _normalize_indicator_name(parsed)
                parsed = [normalized] if normalized else []
        return json.dumps(parsed) if parsed else None

    if isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray, dict)):
        normalized = [
            normalized_value
            for item in value
            if (normalized_value := _normalize_indicator_name(item)) is not None
        ]
        return json.dumps(normalized) if normalized else None

    normalized = _normalize_indicator_name(value)
    return json.dumps([normalized]) if normalized else None


def _normalize_column_value(column: str, value: Any) -> Any:
    if column == "indicators":
        return _normalize_indicator_list(value)
    if column.endswith("_indicator"):
        return _normalize_indicator_name(value)
    if column == "indicator_snapshot":
        value = _clean_value(value)
        if value is None:
            return None
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return None
        else:
            parsed = value
        if not isinstance(parsed, dict):
            return None
        return json.dumps(parsed, ensure_ascii=True, separators=(",", ":"))
    value = _clean_value(value)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def _migrate_legacy_csv_if_needed(
    conn: sqlite3.Connection,
    *,
    csv_path: Optional[Path] = None,
) -> int:
    csv_path = _resolve_csv_path(csv_path)
    if _table_has_rows(conn) or not csv_path.exists():
        return 0

    df = pd.read_csv(csv_path)
    if df.empty:
        return 0

    records = []
    for raw in df.to_dict(orient="records"):
        normalized = _normalize_record(raw)
        records.append(tuple(normalized[column] for column in JOURNAL_COLUMNS))

    placeholders = ", ".join(["?"] * len(JOURNAL_COLUMNS))
    conn.executemany(
        f"""
        INSERT OR IGNORE INTO {TABLE_NAME} ({", ".join(JOURNAL_COLUMNS)})
        VALUES ({placeholders})
        """,
        records,
    )
    conn.commit()
    return len(records)


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    result = {key: row[key] for key in row.keys()}
    indicators = result.get("indicators")
    if indicators in (None, ""):
        parsed: List[str] = []
    else:
        try:
            legacy_value = json.loads(str(indicators))
        except (TypeError, json.JSONDecodeError):
            legacy_value = [
                normalized
                for item in str(indicators).split(",")
                if (normalized := _normalize_indicator_name(item)) is not None
            ]

        if isinstance(legacy_value, list):
            parsed = [
                normalized
                for item in legacy_value
                if (normalized := _normalize_indicator_name(item)) is not None
            ]
        else:
            normalized = _normalize_indicator_name(legacy_value)
            parsed = [normalized] if normalized else []

    for index in range(1, 4):
        indicator_key = f"entry_reason_{index}_indicator"
        detail_key = f"entry_reason_{index}"
        indicator_value = result.get(indicator_key)
        detail_value = result.get(detail_key)

        if isinstance(indicator_value, str):
            indicator_value = _normalize_indicator_name(indicator_value)
        if isinstance(detail_value, str):
            detail_value = detail_value.strip() or None

        if indicator_value is None and len(parsed) >= index:
            indicator_value = parsed[index - 1]

        result[indicator_key] = indicator_value
        result[detail_key] = detail_value

    result.pop("indicators", None)
    snapshot = result.get("indicator_snapshot")
    if isinstance(snapshot, str):
        try:
            parsed_snapshot = json.loads(snapshot)
        except json.JSONDecodeError:
            parsed_snapshot = None
        result["indicator_snapshot"] = parsed_snapshot if isinstance(parsed_snapshot, dict) else None
    elif not isinstance(snapshot, dict):
        result["indicator_snapshot"] = None
    result["source"] = result.get("source") or "manual"
    return result


def _fetch_entry_by_id(conn: sqlite3.Connection, entry_id: int) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        f"""
        SELECT {", ".join(JOURNAL_COLUMNS)}
        FROM {TABLE_NAME}
        WHERE id = ?
        """,
        (entry_id,),
    ).fetchone()
    return _row_to_dict(row) if row is not None else None


def list_entries(
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        _migrate_signed_pnl(conn)
        rows = conn.execute(
            f"""
            SELECT {", ".join(JOURNAL_COLUMNS)}
            FROM {TABLE_NAME}
            ORDER BY id ASC
            """
        ).fetchall()
        return [_row_to_dict(row) for row in rows]


def external_entry_exists(
    external_id: str,
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> bool:
    """Return whether an exchange fill has already been imported."""
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        row = conn.execute(
            f"SELECT 1 FROM {TABLE_NAME} WHERE external_id = ? LIMIT 1",
            (external_id,),
        ).fetchone()
        return row is not None


def _existing_external_ids_in_connection(
    conn: sqlite3.Connection,
    external_ids: Iterable[str],
) -> Set[str]:
    normalized_ids = sorted({str(value).strip() for value in external_ids if str(value).strip()})
    found: Set[str] = set()
    for offset in range(0, len(normalized_ids), 900):
        batch = normalized_ids[offset:offset + 900]
        placeholders = ", ".join("?" for _ in batch)
        rows = conn.execute(
            f"SELECT external_id FROM {TABLE_NAME} WHERE external_id IN ({placeholders})",
            batch,
        ).fetchall()
        found.update(str(row["external_id"]) for row in rows if row["external_id"] is not None)
    return found


def existing_external_ids(
    external_ids: Iterable[str],
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> Set[str]:
    """Return existing exchange IDs in one read transaction."""
    normalized_ids = sorted({str(value).strip() for value in external_ids if str(value).strip()})
    if not normalized_ids:
        return set()
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        return _existing_external_ids_in_connection(conn, normalized_ids)


def add_entry_if_new_external_id(
    entry_data: Dict[str, Any],
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> tuple[Dict[str, Any], bool]:
    """Insert an exchange-backed entry once, keeping re-sync operations idempotent."""
    external_id = _normalize_column_value("external_id", entry_data.get("external_id"))
    if not external_id:
        raise ValueError("external_id is required for imported journal entries")

    payload = {
        column: _normalize_column_value(column, entry_data.get(column))
        for column in INSERTABLE_COLUMNS
    }
    payload["external_id"] = external_id

    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        placeholders = ", ".join(["?"] * len(INSERTABLE_COLUMNS))
        cursor = conn.execute(
            f"""
            INSERT OR IGNORE INTO {TABLE_NAME} ({", ".join(INSERTABLE_COLUMNS)})
            VALUES ({placeholders})
            """,
            tuple(payload[column] for column in INSERTABLE_COLUMNS),
        )
        if cursor.rowcount > 0:
            entry_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            conn.commit()
            entry = _fetch_entry_by_id(conn, entry_id)
            if entry is None:
                raise RuntimeError("Failed to fetch imported journal entry")
            return entry, True

        conn.commit()
        columns = ", ".join(JOURNAL_COLUMNS)
        row = conn.execute(
            f"SELECT {columns} FROM {TABLE_NAME} WHERE external_id = ?",
            (external_id,),
        ).fetchone()
        if row is None:
            raise RuntimeError("Failed to fetch existing imported journal entry")
        return _row_to_dict(row), False


def add_entries_if_new_external_ids(
    entries: Iterable[Dict[str, Any]],
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> Set[str]:
    """Insert new exchange records with one connection and one commit."""
    payloads: Dict[str, Dict[str, Any]] = {}
    for entry_data in entries:
        external_id = _normalize_column_value("external_id", entry_data.get("external_id"))
        if not external_id:
            raise ValueError("external_id is required for imported journal entries")
        payload = {
            column: _normalize_column_value(column, entry_data.get(column))
            for column in INSERTABLE_COLUMNS
        }
        payload["external_id"] = external_id
        payloads[external_id] = payload
    if not payloads:
        return set()

    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        existing = _existing_external_ids_in_connection(conn, payloads)
        new_ids = set(payloads) - existing
        if not new_ids:
            return set()
        placeholders = ", ".join(["?"] * len(INSERTABLE_COLUMNS))
        conn.executemany(
            f"""
            INSERT OR IGNORE INTO {TABLE_NAME} ({", ".join(INSERTABLE_COLUMNS)})
            VALUES ({placeholders})
            """,
            [tuple(payloads[external_id][column] for column in INSERTABLE_COLUMNS) for external_id in new_ids],
        )
        conn.commit()
        return new_ids


def update_imported_entry_by_external_id(
    entry_data: Dict[str, Any],
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Refresh exchange-owned fields while preserving journal annotations and snapshots."""
    external_id = _normalize_column_value("external_id", entry_data.get("external_id"))
    if not external_id:
        raise ValueError("external_id is required for imported journal entries")

    update_columns = list(EXCHANGE_REFRESH_COLUMNS)
    if entry_data.get("indicator_snapshot") is not None:
        update_columns.append("indicator_snapshot")
    payload = {
        column: _normalize_column_value(column, entry_data.get(column))
        for column in update_columns
    }

    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        assignments = ", ".join(f"{column} = ?" for column in update_columns)
        cursor = conn.execute(
            f"UPDATE {TABLE_NAME} SET {assignments} WHERE external_id = ?",
            (*[payload[column] for column in update_columns], external_id),
        )
        if cursor.rowcount == 0:
            return None
        conn.commit()
        columns = ", ".join(JOURNAL_COLUMNS)
        row = conn.execute(
            f"SELECT {columns} FROM {TABLE_NAME} WHERE external_id = ?",
            (external_id,),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None


def update_imported_entries_by_external_id(
    entries: Iterable[Dict[str, Any]],
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> int:
    """Refresh many exchange-owned records in one transaction."""
    normalized_entries = list(entries)
    if not normalized_entries:
        return 0
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        updated = 0
        for entry_data in normalized_entries:
            external_id = _normalize_column_value("external_id", entry_data.get("external_id"))
            if not external_id:
                raise ValueError("external_id is required for imported journal entries")
            update_columns = list(EXCHANGE_REFRESH_COLUMNS)
            if entry_data.get("indicator_snapshot") is not None:
                update_columns.append("indicator_snapshot")
            payload = {
                column: _normalize_column_value(column, entry_data.get(column))
                for column in update_columns
            }
            assignments = ", ".join(f"{column} = ?" for column in update_columns)
            cursor = conn.execute(
                f"UPDATE {TABLE_NAME} SET {assignments} WHERE external_id = ?",
                (*[payload[column] for column in update_columns], external_id),
            )
            updated += max(0, cursor.rowcount)
        conn.commit()
        return updated


def delete_entry(
    entry_id: int,
    *,
    db_path: Optional[Path] = None,
    csv_path: Optional[Path] = None,
) -> bool:
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        _migrate_legacy_csv_if_needed(conn, csv_path=csv_path)
        cursor = conn.execute(
            f"DELETE FROM {TABLE_NAME} WHERE id = ?",
            (entry_id,),
        )
        conn.commit()
        return cursor.rowcount > 0


__all__ = [
    "add_entries_if_new_external_ids",
    "add_entry_if_new_external_id",
    "delete_entry",
    "existing_external_ids",
    "external_entry_exists",
    "list_entries",
    "update_imported_entries_by_external_id",
    "update_imported_entry_by_external_id",
]
