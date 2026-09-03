"""SQLite persistence for user-owned Journal StrategyVersion assignments."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from backend.modules.exchanges import execution_repository
from backend.modules.journal import repository as journal_repository
from backend.modules.strategies import repository as strategy_repository

ASSIGNMENT_TABLE = "journal_strategy_assignments"
ASSIGNMENT_VERSION_INDEX = "journal_strategy_assignments_version_lookup"
JOURNAL_DELETE_TRIGGER = "journal_strategy_assignments_cleanup_on_journal_delete"
VERSION_DELETE_GUARD_TRIGGER = "journal_strategy_assignments_guard_version_delete"


class AssignmentJournalNotFound(LookupError):
    """Raised when the Journal parent does not exist."""


class AssignmentVersionNotFound(LookupError):
    """Raised when the StrategyVersion target does not exist."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS {ASSIGNMENT_TABLE} (
            journal_entry_id INTEGER PRIMARY KEY
                REFERENCES {journal_repository.TABLE_NAME}(id) ON DELETE CASCADE,
            strategy_version_id INTEGER NOT NULL
                REFERENCES {strategy_repository.VERSION_TABLE}(id) ON DELETE RESTRICT,
            assigned_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS {ASSIGNMENT_VERSION_INDEX}
        ON {ASSIGNMENT_TABLE}(strategy_version_id);

        CREATE TRIGGER IF NOT EXISTS {JOURNAL_DELETE_TRIGGER}
        AFTER DELETE ON {journal_repository.TABLE_NAME}
        FOR EACH ROW
        BEGIN
            DELETE FROM {ASSIGNMENT_TABLE}
            WHERE journal_entry_id = OLD.id;
        END;

        CREATE TRIGGER IF NOT EXISTS {VERSION_DELETE_GUARD_TRIGGER}
        BEFORE DELETE ON {strategy_repository.VERSION_TABLE}
        FOR EACH ROW
        WHEN EXISTS (
            SELECT 1 FROM {ASSIGNMENT_TABLE}
            WHERE strategy_version_id = OLD.id
        )
        BEGIN
            SELECT RAISE(ABORT, 'Assigned StrategyVersion cannot be deleted');
        END;
        """
    )


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Open an FK-enforced connection after bootstrapping every parent schema."""
    conn = journal_repository._connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        if int(conn.execute("PRAGMA foreign_keys").fetchone()[0]) != 1:
            raise RuntimeError("Assignment storage requires SQLite foreign key enforcement")
        journal_repository._ensure_schema(conn)
        strategy_repository._ensure_schema(conn)
        # This one-time move must finish before an Assignment can be read or written.
        execution_repository._ensure_schema(conn)
        _ensure_schema(conn)
        conn.commit()
        return conn
    except Exception:
        conn.close()
        raise


def initialize_schema(*, db_path: Optional[Path] = None) -> None:
    """Run the production parent and Assignment bootstrap in the required order."""
    with _connect(db_path):
        pass


def _fetch_assignment(
    conn: sqlite3.Connection, journal_entry_id: int,
) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        f"""
        SELECT assignment.journal_entry_id,
               assignment.strategy_version_id,
               version.strategy_id,
               strategy.name AS strategy_name,
               strategy.archived_at AS strategy_archived_at,
               version.sequence AS version_sequence,
               version.version_label,
               version.description AS version_description,
               version.is_active AS version_is_active,
               version.retired_at AS version_retired_at,
               assignment.assigned_at,
               assignment.updated_at
        FROM {ASSIGNMENT_TABLE} assignment
        JOIN {strategy_repository.VERSION_TABLE} version
          ON version.id = assignment.strategy_version_id
        JOIN {strategy_repository.STRATEGY_TABLE} strategy
          ON strategy.id = version.strategy_id
        WHERE assignment.journal_entry_id = ?
        """,
        (journal_entry_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "journal_entry_id": int(row["journal_entry_id"]),
        "strategy_version_id": int(row["strategy_version_id"]),
        "strategy_id": int(row["strategy_id"]),
        "strategy_name": str(row["strategy_name"]),
        "strategy_archived_at": row["strategy_archived_at"],
        "version_sequence": int(row["version_sequence"]),
        "version_label": str(row["version_label"]),
        "version_description": row["version_description"],
        "version_is_active": bool(row["version_is_active"]),
        "version_retired_at": row["version_retired_at"],
        "assigned_at": str(row["assigned_at"]),
        "updated_at": str(row["updated_at"]),
    }


def _require_journal(conn: sqlite3.Connection, journal_entry_id: int) -> None:
    if conn.execute(
        f"SELECT 1 FROM {journal_repository.TABLE_NAME} WHERE id = ?",
        (journal_entry_id,),
    ).fetchone() is None:
        raise AssignmentJournalNotFound("Journal entry not found")


def _require_version(conn: sqlite3.Connection, strategy_version_id: int) -> None:
    if conn.execute(
        f"SELECT 1 FROM {strategy_repository.VERSION_TABLE} WHERE id = ?",
        (strategy_version_id,),
    ).fetchone() is None:
        raise AssignmentVersionNotFound("StrategyVersion not found")


def get_assignment(
    journal_entry_id: int, *, db_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with _connect(db_path) as conn:
        _require_journal(conn, journal_entry_id)
        return _fetch_assignment(conn, journal_entry_id)


def put_assignment(
    journal_entry_id: int,
    strategy_version_id: int,
    *,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _require_journal(conn, journal_entry_id)
            _require_version(conn, strategy_version_id)
            current = conn.execute(
                f"""SELECT strategy_version_id FROM {ASSIGNMENT_TABLE}
                WHERE journal_entry_id = ?""",
                (journal_entry_id,),
            ).fetchone()
            if current is None:
                timestamp = utc_now()
                conn.execute(
                    f"""INSERT INTO {ASSIGNMENT_TABLE}
                    (journal_entry_id, strategy_version_id, assigned_at, updated_at)
                    VALUES (?, ?, ?, ?)""",
                    (journal_entry_id, strategy_version_id, timestamp, timestamp),
                )
            elif int(current["strategy_version_id"]) != strategy_version_id:
                timestamp = utc_now()
                conn.execute(
                    f"""UPDATE {ASSIGNMENT_TABLE}
                    SET strategy_version_id = ?, assigned_at = ?, updated_at = ?
                    WHERE journal_entry_id = ?""",
                    (strategy_version_id, timestamp, timestamp, journal_entry_id),
                )
            result = _fetch_assignment(conn, journal_entry_id)
            if result is None:
                raise RuntimeError("Assignment could not be read after write")
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise


def delete_assignment(
    journal_entry_id: int, *, db_path: Optional[Path] = None,
) -> bool:
    with _connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _require_journal(conn, journal_entry_id)
            cursor = conn.execute(
                f"DELETE FROM {ASSIGNMENT_TABLE} WHERE journal_entry_id = ?",
                (journal_entry_id,),
            )
            conn.commit()
            return cursor.rowcount > 0
        except Exception:
            conn.rollback()
            raise


__all__ = [
    "ASSIGNMENT_TABLE",
    "ASSIGNMENT_VERSION_INDEX",
    "JOURNAL_DELETE_TRIGGER",
    "VERSION_DELETE_GUARD_TRIGGER",
    "AssignmentJournalNotFound",
    "AssignmentVersionNotFound",
    "delete_assignment",
    "get_assignment",
    "initialize_schema",
    "put_assignment",
]
