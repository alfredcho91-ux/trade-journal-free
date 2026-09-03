"""SQLite persistence for Strategies and immutable StrategyVersions."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.modules.journal import repository as journal_repository

STRATEGY_TABLE = "strategies"
VERSION_TABLE = "strategy_versions"


class StrategyRepositoryNotFound(LookupError):
    """Raised when a requested Strategy domain record does not exist."""


class StrategyRepositoryConflict(RuntimeError):
    """Raised when a requested Strategy lifecycle transition is invalid."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS {STRATEGY_TABLE} (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            name_key TEXT NOT NULL UNIQUE,
            description TEXT,
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS {VERSION_TABLE} (
            id INTEGER PRIMARY KEY,
            strategy_id INTEGER NOT NULL
                REFERENCES {STRATEGY_TABLE}(id) ON DELETE RESTRICT,
            sequence INTEGER NOT NULL,
            version_label TEXT NOT NULL,
            version_label_key TEXT NOT NULL,
            description TEXT,
            rules_json TEXT NOT NULL,
            is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
            retired_at TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(strategy_id, sequence),
            UNIQUE(strategy_id, version_label_key)
        );

        CREATE INDEX IF NOT EXISTS {STRATEGY_TABLE}_archive_name
        ON {STRATEGY_TABLE}(archived_at, name_key);

        CREATE INDEX IF NOT EXISTS {VERSION_TABLE}_strategy_sequence
        ON {VERSION_TABLE}(strategy_id, sequence DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS {VERSION_TABLE}_one_active
        ON {VERSION_TABLE}(strategy_id)
        WHERE is_active = 1;
        """
    )


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Open a Strategy-scoped connection without changing global FK behavior."""
    conn = journal_repository._connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    if int(conn.execute("PRAGMA foreign_keys").fetchone()[0]) != 1:
        conn.close()
        raise RuntimeError("Strategy storage requires SQLite foreign key enforcement")
    journal_repository._ensure_schema(conn)
    _ensure_schema(conn)
    return conn


def initialize_schema(*, db_path: Optional[Path] = None) -> None:
    """Run the production Strategy schema bootstrap path."""
    with _connect(db_path):
        pass


def _decode_rules(value: Any) -> Dict[str, Any]:
    try:
        decoded = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Stored StrategyVersion rules are invalid") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError("Stored StrategyVersion rules are invalid")
    return decoded


def _strategy_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "archived_at": row["archived_at"],
        "active_version_id": (
            int(row["active_version_id"])
            if row["active_version_id"] is not None
            else None
        ),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _version_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "strategy_id": int(row["strategy_id"]),
        "sequence": int(row["sequence"]),
        "version_label": row["version_label"],
        "description": row["description"],
        "rules": _decode_rules(row["rules_json"]),
        "is_active": bool(row["is_active"]),
        "retired_at": row["retired_at"],
        "created_at": row["created_at"],
    }


def _strategy_select() -> str:
    return f"""
        SELECT strategy.id, strategy.name, strategy.description,
               strategy.archived_at, strategy.created_at, strategy.updated_at,
               active.id AS active_version_id
        FROM {STRATEGY_TABLE} strategy
        LEFT JOIN {VERSION_TABLE} active
          ON active.strategy_id = strategy.id AND active.is_active = 1
    """


def list_strategies(
    *, include_archived: bool = False, db_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    with _connect(db_path) as conn:
        where = "" if include_archived else "WHERE strategy.archived_at IS NULL"
        rows = conn.execute(
            f"{_strategy_select()} {where} ORDER BY strategy.name_key ASC"
        ).fetchall()
        return [_strategy_from_row(row) for row in rows]


def get_strategy(
    strategy_id: int, *, db_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"{_strategy_select()} WHERE strategy.id = ?", (strategy_id,)
        ).fetchone()
        return _strategy_from_row(row) if row is not None else None


def get_version(
    strategy_id: int, version_id: int, *, db_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        row = conn.execute(
            f"SELECT * FROM {VERSION_TABLE} WHERE id = ? AND strategy_id = ?",
            (version_id, strategy_id),
        ).fetchone()
        return _version_from_row(row) if row is not None else None


def list_versions(
    strategy_id: int, *, db_path: Optional[Path] = None,
) -> Optional[List[Dict[str, Any]]]:
    with _connect(db_path) as conn:
        if conn.execute(
            f"SELECT 1 FROM {STRATEGY_TABLE} WHERE id = ?", (strategy_id,)
        ).fetchone() is None:
            return None
        rows = conn.execute(
            f"SELECT * FROM {VERSION_TABLE} WHERE strategy_id = ? ORDER BY sequence ASC",
            (strategy_id,),
        ).fetchall()
        return [_version_from_row(row) for row in rows]


def _rules_json(rules: Dict[str, Any]) -> str:
    return json.dumps(rules, ensure_ascii=False, separators=(",", ":"))


def create_strategy(
    *,
    name: str,
    name_key: str,
    description: Optional[str],
    version_label: str,
    version_label_key: str,
    version_description: Optional[str],
    rules: Dict[str, Any],
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    timestamp = utc_now()
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = conn.execute(
                f"""INSERT INTO {STRATEGY_TABLE}
                (name, name_key, description, archived_at, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?)""",
                (name, name_key, description, timestamp, timestamp),
            )
            strategy_id = int(cursor.lastrowid)
            conn.execute(
                f"""INSERT INTO {VERSION_TABLE}
                (strategy_id, sequence, version_label, version_label_key,
                 description, rules_json, is_active, retired_at, created_at)
                VALUES (?, 1, ?, ?, ?, ?, 1, NULL, ?)""",
                (
                    strategy_id,
                    version_label,
                    version_label_key,
                    version_description,
                    _rules_json(rules),
                    timestamp,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    created = get_strategy(strategy_id, db_path=db_path)
    if created is None:
        raise RuntimeError("Created Strategy could not be read")
    return created


def update_strategy(
    strategy_id: int,
    changes: Dict[str, Any],
    *,
    db_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    if not changes:
        raise ValueError("At least one Strategy field is required")
    payload = {**changes, "updated_at": utc_now()}
    assignments = ", ".join(f"{field} = ?" for field in payload)
    with _connect(db_path) as conn:
        cursor = conn.execute(
            f"UPDATE {STRATEGY_TABLE} SET {assignments} WHERE id = ?",
            (*payload.values(), strategy_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_strategy(strategy_id, db_path=db_path)


def set_strategy_archived(
    strategy_id: int,
    archived: bool,
    *,
    db_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        existing = conn.execute(
            f"SELECT archived_at FROM {STRATEGY_TABLE} WHERE id = ?", (strategy_id,)
        ).fetchone()
        if existing is None:
            return None
        current = existing["archived_at"]
        next_value = (current or utc_now()) if archived else None
        if current != next_value:
            conn.execute(
                f"UPDATE {STRATEGY_TABLE} SET archived_at = ?, updated_at = ? WHERE id = ?",
                (next_value, utc_now(), strategy_id),
            )
            conn.commit()
    return get_strategy(strategy_id, db_path=db_path)


def create_version(
    strategy_id: int,
    *,
    version_label: str,
    version_label_key: str,
    description: Optional[str],
    rules: Dict[str, Any],
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            strategy = conn.execute(
                f"SELECT archived_at FROM {STRATEGY_TABLE} WHERE id = ?", (strategy_id,)
            ).fetchone()
            if strategy is None:
                raise StrategyRepositoryNotFound("Strategy not found")
            if strategy["archived_at"] is not None:
                raise StrategyRepositoryConflict(
                    "Archived Strategies cannot receive new versions"
                )
            sequence = int(
                conn.execute(
                    f"SELECT COALESCE(MAX(sequence), 0) + 1 FROM {VERSION_TABLE} WHERE strategy_id = ?",
                    (strategy_id,),
                ).fetchone()[0]
            )
            cursor = conn.execute(
                f"""INSERT INTO {VERSION_TABLE}
                (strategy_id, sequence, version_label, version_label_key,
                 description, rules_json, is_active, retired_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)""",
                (
                    strategy_id,
                    sequence,
                    version_label,
                    version_label_key,
                    description,
                    _rules_json(rules),
                    utc_now(),
                ),
            )
            version_id = int(cursor.lastrowid)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    created = get_version(strategy_id, version_id, db_path=db_path)
    if created is None:
        raise RuntimeError("Created StrategyVersion could not be read")
    return created


def activate_version(
    strategy_id: int, version_id: int, *, db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            strategy = conn.execute(
                f"SELECT archived_at FROM {STRATEGY_TABLE} WHERE id = ?", (strategy_id,)
            ).fetchone()
            if strategy is None:
                raise StrategyRepositoryNotFound("Strategy not found")
            version = conn.execute(
                f"SELECT strategy_id, retired_at FROM {VERSION_TABLE} WHERE id = ?",
                (version_id,),
            ).fetchone()
            if version is None:
                raise StrategyRepositoryNotFound("StrategyVersion not found")
            if int(version["strategy_id"]) != strategy_id:
                raise StrategyRepositoryConflict(
                    "StrategyVersion does not belong to this Strategy"
                )
            if strategy["archived_at"] is not None:
                raise StrategyRepositoryConflict(
                    "Archived Strategies cannot activate versions"
                )
            if version["retired_at"] is not None:
                raise StrategyRepositoryConflict("Retired versions cannot be activated")
            conn.execute(
                f"UPDATE {VERSION_TABLE} SET is_active = 0 WHERE strategy_id = ? AND is_active = 1",
                (strategy_id,),
            )
            conn.execute(
                f"UPDATE {VERSION_TABLE} SET is_active = 1 WHERE id = ?",
                (version_id,),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    activated = get_version(strategy_id, version_id, db_path=db_path)
    if activated is None:
        raise RuntimeError("Activated StrategyVersion could not be read")
    return activated


def retire_version(
    strategy_id: int, version_id: int, *, db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if conn.execute(
                f"SELECT 1 FROM {STRATEGY_TABLE} WHERE id = ?", (strategy_id,)
            ).fetchone() is None:
                raise StrategyRepositoryNotFound("Strategy not found")
            version = conn.execute(
                f"SELECT strategy_id, retired_at FROM {VERSION_TABLE} WHERE id = ?",
                (version_id,),
            ).fetchone()
            if version is None:
                raise StrategyRepositoryNotFound("StrategyVersion not found")
            if int(version["strategy_id"]) != strategy_id:
                raise StrategyRepositoryConflict(
                    "StrategyVersion does not belong to this Strategy"
                )
            if version["retired_at"] is None:
                conn.execute(
                    f"UPDATE {VERSION_TABLE} SET retired_at = ?, is_active = 0 WHERE id = ?",
                    (utc_now(), version_id),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    retired = get_version(strategy_id, version_id, db_path=db_path)
    if retired is None:
        raise RuntimeError("Retired StrategyVersion could not be read")
    return retired


__all__ = [
    "STRATEGY_TABLE",
    "VERSION_TABLE",
    "StrategyRepositoryConflict",
    "StrategyRepositoryNotFound",
    "activate_version",
    "create_strategy",
    "create_version",
    "get_strategy",
    "get_version",
    "initialize_schema",
    "list_strategies",
    "list_versions",
    "retire_version",
    "set_strategy_archived",
    "update_strategy",
]
