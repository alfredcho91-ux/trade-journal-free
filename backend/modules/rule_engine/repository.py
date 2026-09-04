"""Coherent read snapshots for per-trade Strategy rule evaluation."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.strategies import repository as strategy_repository
from backend.modules.strategy_assignments import repository as assignment_repository


@dataclass(frozen=True)
class EvaluationSnapshot:
    journal_entry: Optional[Dict[str, Any]]
    assignment: Optional[Dict[str, Any]]
    linked_plan: Optional[Dict[str, Any]]


def _connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Bootstrap existing schemas, then return one shared SQLite connection."""
    conn = assignment_repository._connect(db_path)
    try:
        plan_repository._ensure_schema(conn)
        conn.commit()
        return conn
    except Exception:
        conn.close()
        raise


def _fetch_journal_entry(
    conn: sqlite3.Connection, journal_entry_id: int,
) -> Optional[Dict[str, Any]]:
    return journal_repository._fetch_entry_by_id(conn, journal_entry_id)


def _fetch_assignment_version(
    conn: sqlite3.Connection, journal_entry_id: int,
) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        f"""
        SELECT assignment.journal_entry_id,
               assignment.strategy_version_id,
               assignment.assigned_at,
               assignment.updated_at AS assignment_updated_at,
               version.strategy_id,
               version.sequence,
               version.version_label,
               version.description AS version_description,
               version.rules_json,
               version.is_active,
               version.retired_at,
               version.created_at AS version_created_at,
               strategy.name AS strategy_name,
               strategy.archived_at AS strategy_archived_at
        FROM {assignment_repository.ASSIGNMENT_TABLE} assignment
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
        "assigned_at": str(row["assigned_at"]),
        "assignment_updated_at": str(row["assignment_updated_at"]),
        "strategy_id": int(row["strategy_id"]),
        "strategy_name": str(row["strategy_name"]),
        "strategy_archived_at": row["strategy_archived_at"],
        "version_sequence": int(row["sequence"]),
        "version_label": str(row["version_label"]),
        "version_description": row["version_description"],
        "version_rules": strategy_repository._decode_rules(row["rules_json"]),
        "version_is_active": bool(row["is_active"]),
        "version_retired_at": row["retired_at"],
        "version_created_at": str(row["version_created_at"]),
    }


def _fetch_linked_plan(
    conn: sqlite3.Connection,
    journal_entry: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    journal_entry_id = int(journal_entry["id"])
    external_id = str(journal_entry.get("external_id") or "").strip() or None
    rows = conn.execute(
        f"""
        SELECT plan.*,
               link.id AS _link_id,
               link.journal_entry_id AS _link_journal_entry_id,
               link.journal_external_id AS _link_journal_external_id,
               link.link_status AS _link_status,
               link.linked_at AS _link_linked_at,
               link.updated_at AS _link_updated_at
        FROM {plan_repository.LINK_TABLE} link
        JOIN {plan_repository.PLAN_TABLE} plan ON plan.id = link.plan_id
        WHERE link.journal_entry_id = ?
           OR (? IS NOT NULL AND link.journal_external_id = ?)
        ORDER BY CASE WHEN link.journal_entry_id = ? THEN 0 ELSE 1 END,
                 plan.id ASC
        """,
        (journal_entry_id, external_id, external_id, journal_entry_id),
    ).fetchall()
    if not rows:
        return None
    if len(rows) != 1:
        raise RuntimeError("Journal entry has multiple linked Plan candidates")

    row = rows[0]
    plan = {
        key: row[key]
        for key in row.keys()
        if not str(key).startswith("_link_")
    }
    plan_id = int(plan["id"])
    revision_rows = conn.execute(
        f"""SELECT * FROM {plan_repository.REVISION_TABLE}
        WHERE plan_id = ? ORDER BY version ASC""",
        (plan_id,),
    ).fetchall()
    revisions = [dict(revision) for revision in revision_rows]
    plan["revisions"] = revisions
    plan["latest_revision"] = revisions[-1] if revisions else None
    plan["link"] = {
        "id": int(row["_link_id"]),
        "plan_id": plan_id,
        "journal_entry_id": row["_link_journal_entry_id"],
        "journal_external_id": row["_link_journal_external_id"],
        "link_status": row["_link_status"],
        "linked_at": row["_link_linked_at"],
        "updated_at": row["_link_updated_at"],
    }
    return plan


def load_evaluation_snapshot(
    journal_entry_id: int,
    *,
    db_path: Optional[Path] = None,
) -> EvaluationSnapshot:
    """Read every evaluation fact from one request-scoped SQLite snapshot."""
    with _connect(db_path) as conn:
        conn.execute("BEGIN")
        journal_entry = _fetch_journal_entry(conn, journal_entry_id)
        if journal_entry is None:
            return EvaluationSnapshot(None, None, None)

        assignment = _fetch_assignment_version(conn, journal_entry_id)
        if assignment is None:
            return EvaluationSnapshot(journal_entry, None, None)

        linked_plan = _fetch_linked_plan(conn, journal_entry)
        return EvaluationSnapshot(journal_entry, assignment, linked_plan)


__all__ = ["EvaluationSnapshot", "load_evaluation_snapshot"]
