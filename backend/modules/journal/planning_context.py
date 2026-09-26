"""Presentation-only planning context. No bootstrap, migration, or reconciliation."""

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.utils.error_handler import APIError, NotFoundError


class JournalPlanningNotes(BaseModel):
    source: Literal["journal_entries"] = "journal_entries"
    journal_entry_id: int
    planned_stop_pct: Any = None
    planned_target_pct: Any = None
    planned_entry_reason: Any = None
    plan_recorded_at: Any = None
    has_notes: bool
    timing_verified: Literal[False] = False


class LinkedPlanningHistory(BaseModel):
    plan: dict[str, Any]
    entry_time_revision: dict[str, Any] | None = None
    analysis_revision: dict[str, Any] | None = None
    analysis_basis: Literal["VERIFIED_PRETRADE", "RETROSPECTIVE", "NOT_ELIGIBLE"]


class PlanningContext(BaseModel):
    journal_entry_id: int
    journal_notes: JournalPlanningNotes
    actual_execution: dict[str, Any]
    link_state: Literal["LINKED", "NO_LINKED_PLAN", "CANDIDATES", "AMBIGUOUS"]
    linked_plan: LinkedPlanningHistory | None = None
    candidate_plans: list[dict[str, Any]] = Field(default_factory=list)
    candidates_truncated: bool = False
    issues: list[str] = Field(default_factory=list)


class PlanningContextEnvelope(BaseModel):
    success: Literal[True] = True
    data: PlanningContext


def _plan(conn, row):
    plan = dict(row)
    revisions = [dict(item) for item in conn.execute(
        f"SELECT * FROM {plans.REVISION_TABLE} WHERE plan_id=? ORDER BY version", (plan["id"],),
    )]
    if not revisions:
        raise ValueError("Plan revision history is unavailable")
    link = conn.execute(f"SELECT * FROM {plans.LINK_TABLE} WHERE plan_id=?", (plan["id"],)).fetchone()
    return {**plan, "revisions": revisions, "latest_revision": revisions[-1], "link": dict(link) if link else None}


def _read(conn, entry_id):
    row = conn.execute(f"SELECT * FROM {journal.TABLE_NAME} WHERE id=?", (entry_id,)).fetchone()
    if row is None:
        raise NotFoundError("Journal entry", str(entry_id))
    entry = dict(row)
    note_fields = ("planned_stop_pct", "planned_target_pct", "planned_entry_reason", "plan_recorded_at")
    notes = {field: entry[field] for field in note_fields}
    context = PlanningContext(
        journal_entry_id=entry_id,
        journal_notes=JournalPlanningNotes(journal_entry_id=entry_id, **notes,
            has_notes=any(notes[field] not in (None, "") for field in note_fields[:3])),
        actual_execution={field: entry[field] for field in (
            "entry_price", "direction", "entry_datetime", "datetime", "symbol", "exchange", "source", "external_id",
        )},
        link_state="NO_LINKED_PLAN",
    )
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    required = {plans.PLAN_TABLE, plans.REVISION_TABLE, plans.LINK_TABLE}
    if not tables.intersection(required):
        return context
    if not required.issubset(tables):
        raise ValueError("Plan schema is unavailable")
    external = str(entry.get("external_id") or "").strip() or None
    rows = conn.execute(f"""
        SELECT DISTINCT p.* FROM {plans.PLAN_TABLE} p
        JOIN {plans.LINK_TABLE} l ON l.plan_id=p.id
        WHERE l.journal_entry_id=? OR (? IS NOT NULL AND l.journal_external_id=?) ORDER BY p.id
    """, (entry_id, external, external)).fetchall()
    if len(rows) > 1:
        context.link_state = "AMBIGUOUS"
        context.issues = ["MULTIPLE_LINKED_PLANS"]
        return context
    if rows:
        plan = _plan(conn, rows[0])
        link = plan["link"]
        scope_matches = (
            plans.normalize_symbol(entry.get("symbol")) == plan["symbol_key"]
            and entry.get("direction") == plan["side"]
            and str(entry.get("exchange") or "").lower() == plan["exchange"].lower()
        )
        linked = (link["link_status"] == "LINKED" and link["journal_entry_id"] == entry_id
                  and bool(external) and link["journal_external_id"] == external and scope_matches)
        annotated = plans.annotate_revisions(plan, entry.get("entry_datetime"), entry.get("datetime"))
        verified = linked and extract_metric_observations(entry, linked_plan=plan)["plan.recorded_before_entry"].value is True
        revision = annotated["plan_effective_at_entry"] if linked else None
        context.link_state = "LINKED" if linked else "AMBIGUOUS"
        context.linked_plan = LinkedPlanningHistory(
            plan={**plan, "revisions": annotated["revisions"]},
            entry_time_revision=revision if verified else None,
            analysis_revision=revision if verified or (linked and plan["source"] == "RETROSPECTIVE") else None,
            analysis_basis="VERIFIED_PRETRADE" if verified else "RETROSPECTIVE" if linked and plan["source"] == "RETROSPECTIVE" else "NOT_ELIGIBLE",
        )
        if not linked:
            context.issues = ["LINK_REQUIRES_REVIEW"]
        return context
    # Suggestions only: never infer a link from date proximity or list order.
    exchange = str(entry.get("exchange") or "").lower()
    symbol = plans.normalize_symbol(entry.get("symbol"))
    if external and exchange and symbol and entry.get("direction") in {"Long", "Short"}:
        candidates = conn.execute(f"""
            SELECT p.* FROM {plans.PLAN_TABLE} p
            WHERE lower(p.exchange)=? AND p.symbol_key=? AND p.side=? AND p.status='active'
              AND p.source='UNLINKED' AND p.live_position_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM {plans.LINK_TABLE} l WHERE l.plan_id=p.id)
            ORDER BY p.id LIMIT 51
        """, (exchange, symbol, entry["direction"])).fetchall()
        context.candidate_plans = [_plan(conn, row) for row in candidates[:50]]
        context.candidates_truncated = len(candidates) > 50
        if candidates:
            context.link_state = "CANDIDATES"
    return context


def get_planning_context(entry_id: int, *, db_path: Path | None = None) -> PlanningContextEnvelope:
    path = Path(db_path or journal.JOURNAL_DB_PATH).resolve()
    try:
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only = ON")
            conn.execute("BEGIN")
            return PlanningContextEnvelope(data=_read(conn, entry_id))
    except (sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        raise APIError("Unable to load planning context", status_code=503) from exc
