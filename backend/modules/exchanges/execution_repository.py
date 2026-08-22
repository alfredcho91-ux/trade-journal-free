"""Compact persistence for raw exchange executions used by chart review."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

from backend.config.settings import JOURNAL_DB_PATH

TABLE_NAME = "exchange_executions"
COLUMNS = [
    "external_id", "datetime", "symbol", "direction", "size", "entry_price",
    "source", "exchange", "order_id", "notes", "fee", "fee_currency", "indicator_snapshot", "created_at",
]


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or JOURNAL_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            external_id TEXT PRIMARY KEY,
            datetime TEXT NOT NULL,
            symbol TEXT NOT NULL,
            direction TEXT NOT NULL,
            size REAL,
            entry_price REAL NOT NULL,
            source TEXT NOT NULL,
            exchange TEXT NOT NULL,
            order_id TEXT,
            notes TEXT,
            fee REAL,
            fee_currency TEXT,
            indicator_snapshot TEXT,
            created_at TEXT
        )
    """)
    existing_columns = {
        str(row["name"])
        for row in connection.execute(f"PRAGMA table_info({TABLE_NAME})").fetchall()
    }
    if "notes" not in existing_columns:
        connection.execute(f"ALTER TABLE {TABLE_NAME} ADD COLUMN notes TEXT")
    connection.execute(
        f"CREATE INDEX IF NOT EXISTS {TABLE_NAME}_lookup ON {TABLE_NAME} (exchange, symbol, datetime)"
    )
    _migrate_legacy_rows(connection)
    connection.commit()


def _migrate_legacy_rows(connection: sqlite3.Connection) -> None:
    journal_exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'journal_entries'"
    ).fetchone()
    if journal_exists is None:
        return
    sources = ("binance_fill", "bybit_fill", "okx_fill")
    placeholders = ", ".join("?" for _ in sources)
    connection.execute(f"""
        INSERT OR IGNORE INTO {TABLE_NAME} ({", ".join(COLUMNS)})
        SELECT external_id, datetime, symbol, direction, size, entry_price,
               source, exchange, order_id, notes, fee, fee_currency, indicator_snapshot, created_at
        FROM journal_entries
        WHERE source IN ({placeholders}) AND external_id IS NOT NULL
    """, sources)
    connection.execute(f"DELETE FROM journal_entries WHERE source IN ({placeholders})", sources)


def add_executions_if_new(rows: Iterable[Dict[str, Any]], *, db_path: Optional[Path] = None) -> Set[str]:
    payloads = {str(row["external_id"]): _normalize_row(row) for row in rows if row.get("external_id")}
    if not payloads:
        return set()
    with _connect(db_path) as connection:
        _ensure_schema(connection)
        existing = _existing_ids(connection, payloads)
        placeholders = ", ".join("?" for _ in COLUMNS)
        connection.executemany(
            f"INSERT OR IGNORE INTO {TABLE_NAME} ({', '.join(COLUMNS)}) VALUES ({placeholders})",
            [tuple(payloads[key][column] for column in COLUMNS) for key in sorted(set(payloads) - existing)],
        )
        for key in sorted(existing):
            snapshot = payloads[key].get("indicator_snapshot")
            if snapshot is not None:
                connection.execute(
                    f"UPDATE {TABLE_NAME} SET indicator_snapshot = COALESCE(indicator_snapshot, ?) WHERE external_id = ?",
                    (snapshot, key),
                )
        connection.commit()
        return set(payloads) - existing


def list_executions(
    *,
    exchange: Optional[str] = None,
    symbol: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    conditions, values = [], []
    for column, value in (("exchange", exchange), ("symbol", symbol)):
        if value:
            conditions.append(f"{column} = ?")
            values.append(value)
    if start_time:
        conditions.append("datetime >= ?")
        values.append(start_time)
    if end_time:
        conditions.append("datetime <= ?")
        values.append(end_time)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    with _connect(db_path) as connection:
        _ensure_schema(connection)
        rows = connection.execute(
            f"SELECT {', '.join(COLUMNS)} FROM {TABLE_NAME} {where} ORDER BY datetime ASC LIMIT 5000",
            values,
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def _existing_ids(connection: sqlite3.Connection, external_ids: Iterable[str]) -> Set[str]:
    identifiers = sorted(set(external_ids))
    found: Set[str] = set()
    for offset in range(0, len(identifiers), 900):
        batch = identifiers[offset:offset + 900]
        placeholders = ", ".join("?" for _ in batch)
        rows = connection.execute(
            f"SELECT external_id FROM {TABLE_NAME} WHERE external_id IN ({placeholders})", batch
        ).fetchall()
        found.update(str(row["external_id"]) for row in rows)
    return found


def _normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    payload = {column: row.get(column) for column in COLUMNS}
    snapshot = payload.get("indicator_snapshot")
    if isinstance(snapshot, dict):
        payload["indicator_snapshot"] = json.dumps(snapshot, separators=(",", ":"))
    return payload


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    result = dict(row)
    raw_snapshot = result.get("indicator_snapshot")
    if raw_snapshot:
        try:
            result["indicator_snapshot"] = json.loads(raw_snapshot)
        except (TypeError, json.JSONDecodeError):
            result["indicator_snapshot"] = None
    return result


__all__ = ["add_executions_if_new", "list_executions"]
