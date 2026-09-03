"""Date-keyed Daily Journal persistence in the main journal database."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional

from backend.modules.journal.repository import DAILY_TABLE_NAME, _connect, _ensure_schema

DAILY_FIELDS = (
    "market_bias",
    "session_plan",
    "max_daily_loss",
    "max_trade_count",
    "pre_session_notes",
    "post_session_notes",
    "what_went_well",
    "what_went_wrong",
    "next_focus",
)
TEXT_LIMITS = {
    "market_bias": 160,
    "session_plan": 5000,
    "pre_session_notes": 5000,
    "post_session_notes": 5000,
    "what_went_well": 5000,
    "what_went_wrong": 5000,
    "next_focus": 2000,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_trade_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("trade_date must be a valid YYYY-MM-DD date") from exc
    if parsed.isoformat() != value:
        raise ValueError("trade_date must be a valid YYYY-MM-DD date")
    return value


def _normalize_value(field: str, value: Any) -> Any:
    if field in TEXT_LIMITS:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError(f"{field} must be text or null")
        normalized = value.strip() or None
        if normalized is not None and len(normalized) > TEXT_LIMITS[field]:
            raise ValueError(f"{field} is too long")
        return normalized
    if field == "max_daily_loss":
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError("max_daily_loss must be greater than zero")
        return float(value)
    if field == "max_trade_count":
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError("max_trade_count must be a positive integer")
        return value
    raise ValueError(f"Unsupported daily journal field: {field}")


def _normalize_changes(changes: Dict[str, Any]) -> Dict[str, Any]:
    unknown = set(changes) - set(DAILY_FIELDS)
    if unknown:
        raise ValueError(f"Unsupported daily journal fields: {', '.join(sorted(unknown))}")
    return {field: _normalize_value(field, value) for field, value in changes.items()}


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def get_daily_journal(trade_date: str, *, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    trade_date = _validate_trade_date(trade_date)
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        row = conn.execute(
            f"SELECT * FROM {DAILY_TABLE_NAME} WHERE trade_date = ?",
            (trade_date,),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None


def list_daily_journals(
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    if start_date is not None:
        start_date = _validate_trade_date(start_date)
    if end_date is not None:
        end_date = _validate_trade_date(end_date)
    if start_date is not None and end_date is not None and start_date > end_date:
        raise ValueError("start_date must be on or before end_date")

    where: List[str] = []
    params: List[str] = []
    if start_date is not None:
        where.append("trade_date >= ?")
        params.append(start_date)
    if end_date is not None:
        where.append("trade_date <= ?")
        params.append(end_date)
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        rows = conn.execute(
            f"SELECT * FROM {DAILY_TABLE_NAME}{clause} ORDER BY trade_date ASC",
            params,
        ).fetchall()
        return [_row_to_dict(row) for row in rows]


def upsert_daily_journal(
    trade_date: str,
    changes: Dict[str, Any],
    *,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    trade_date = _validate_trade_date(trade_date)
    payload = _normalize_changes(changes)
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            f"SELECT * FROM {DAILY_TABLE_NAME} WHERE trade_date = ?",
            (trade_date,),
        ).fetchone()
        if existing is None:
            timestamp = _utc_now()
            columns = ["trade_date", *payload.keys(), "created_at", "updated_at"]
            values = [trade_date, *payload.values(), timestamp, timestamp]
            placeholders = ", ".join("?" for _ in columns)
            conn.execute(
                f"INSERT INTO {DAILY_TABLE_NAME} ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
        else:
            changed = {field: value for field, value in payload.items() if existing[field] != value}
            if changed:
                changed["updated_at"] = _utc_now()
                assignments = ", ".join(f"{field} = ?" for field in changed)
                conn.execute(
                    f"UPDATE {DAILY_TABLE_NAME} SET {assignments} WHERE trade_date = ?",
                    (*changed.values(), trade_date),
                )
        conn.commit()
        row = conn.execute(
            f"SELECT * FROM {DAILY_TABLE_NAME} WHERE trade_date = ?",
            (trade_date,),
        ).fetchone()
        if row is None:
            raise RuntimeError("Daily journal upsert did not return a record")
        return _row_to_dict(row)


def delete_daily_journal(trade_date: str, *, db_path: Optional[Path] = None) -> bool:
    trade_date = _validate_trade_date(trade_date)
    with _connect(db_path) as conn:
        _ensure_schema(conn)
        cursor = conn.execute(
            f"DELETE FROM {DAILY_TABLE_NAME} WHERE trade_date = ?",
            (trade_date,),
        )
        conn.commit()
        return cursor.rowcount > 0
