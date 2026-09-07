"""Cross-system contracts on actual persisted history, never the user's DB."""

import sqlite3

import pytest

from backend.modules.analytics import core, repository as analytics
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.analytics.service import query_analytics
from backend.modules.journal import repository as journal
from backend.modules.journal.behavior_analysis import _behavior_item
from backend.modules.journal.schemas import JournalRecord
from backend.modules.review.context import load_context
from backend.modules.review.schemas import ReviewRequest
from backend.modules.rule_engine.service import get_strategy_evaluation_service
from backend.tests.test_rule_engine_service import _assign, _document, _journal, _linked_plan, _rule, _strategy

START, END = 1767225600000, 1798761599999


@pytest.fixture
def history_db(tmp_path, monkeypatch):
    path = tmp_path / "history.db"
    monkeypatch.setattr(journal, "JOURNAL_DB_PATH", path)
    monkeypatch.setattr(journal, "JOURNAL_CSV_PATH", tmp_path / "absent.csv")
    journal.INITIALIZED_DATABASES.clear()
    yield path
    journal.INITIALIZED_DATABASES.clear()


@pytest.mark.parametrize("field", ["fomo", "revenge_trade"])
@pytest.mark.parametrize("raw,state,status", [
    (0, "FALSE", "FOLLOWED"), (1, "TRUE", "VIOLATED"),
    (None, "UNRECORDED", "NOT_EVALUABLE"), (2, "INVALID", "NOT_EVALUABLE"),
    (-1, "INVALID", "NOT_EVALUABLE"), ("malformed", "INVALID", "NOT_EVALUABLE"),
])
def test_same_persisted_psychology_fact_across_journal_rule_analytics_review(history_db, field, raw, state, status):
    entry = _journal(history_db)
    _, version = _strategy(history_db, "History", _document(entry=[_rule("flag", f"journal.{field}", "eq", False)]))
    _assign(history_db, entry["id"], version["id"])
    # Models reject malformed new writes; SQLite legacy tables can contain them.
    with sqlite3.connect(history_db) as conn:
        conn.execute("PRAGMA ignore_check_constraints=ON")
        conn.execute(f"UPDATE journal_entries SET {field}=? WHERE id=?", (raw, entry["id"]))
    row = journal.list_entries()[0]
    assert core.psychology_state(row, field) == state
    expected_raw = bool(raw) if type(raw) is int and raw in (0, 1) else raw
    assert row[field] == expected_raw
    assert type(row[field]) is type(expected_raw)
    assert JournalRecord.model_validate(row).model_dump()[field] == expected_raw
    per_trade = get_strategy_evaluation_service(entry["id"], db_path=history_db)["data"]["rules"][0]
    assert per_trade["status"] == status
    filters = {"start_time": START, "end_time": END, field: [state]}
    query = AnalyticsQuery(metric="trade_count", dimension=field, filters=filters)
    snapshot = analytics.load_snapshot(query, db_path=history_db)
    assert len(snapshot.entries) == 1
    assert snapshot.entries[0][field] == expected_raw
    grouped = query_analytics(query, db_path=history_db).model_dump(mode="json")
    assert grouped["data"]["groups"][0]["identity"]["label"] == state
    context = load_context(ReviewRequest(filters=filters, compare_previous=False), db_path=history_db)
    assert len(context.current) == 1
    assert context.current[0].rules[0].model_dump(mode="json") == per_trade
    assert core.psychology_state(context.current[0].entry, field) == state
    # Reads and an unrelated explicit edit never silently repair raw history.
    journal.update_entry_behavior(entry["id"], {"notes": "unrelated edit"}, db_path=history_db)
    with sqlite3.connect(history_db) as conn:
        assert conn.execute(f"SELECT {field} FROM journal_entries WHERE id=?", (entry["id"],)).fetchone()[0] == raw


@pytest.mark.parametrize("recorded", [None, "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z", "2026-01-01T10:30:00Z", "2026-01-01T12:00:00Z"])
@pytest.mark.parametrize("edited", [False, True])
def test_mutable_legacy_values_remain_descriptive_not_verified_history(history_db, recorded, edited):
    entry = _journal(history_db, planned_stop_pct=1, planned_target_pct=2, plan_recorded_at=recorded)
    if edited:
        entry = journal.update_entry_behavior(entry["id"], {"planned_stop_pct": 4, "plan_recorded_at": "2026-01-02T00:00:00Z"}, db_path=history_db)
        if recorded:
            assert entry["plan_recorded_at"] == recorded
    item = _behavior_item(entry, {"excursion": {"realized_move_pct": -5, "mae_pct": 6, "mfe_pct": 3}}, [
        {"id": 1, "is_enabled": True, "rule_type": "max_stop_pct", "parameters": {"max_stop_pct": 2}},
        {"id": 2, "is_enabled": True, "rule_type": "min_rr", "parameters": {"min_rr": 1}},
    ])
    assert item["plan"]["planned_stop_pct"] == (4 if edited else 1)
    assert item["plan"]["planned_rr"] == (0.5 if edited else 2)
    assert not item["plan"]["eligible_for_entry_rule_review"]
    assert not item["plan"]["eligible_for_exit_plan_review"]
    assert all(check["status"] == "unknown" for check in item["rule_checks"])
    assert item["issues"] == []


def test_immutable_plan_revision_remains_verified_despite_mutable_legacy_edits(history_db, monkeypatch):
    entry = _journal(history_db, planned_stop_pct=1, plan_recorded_at="2026-01-01T09:00:00Z")
    _, version = _strategy(history_db, "Plan", _document(entry=[_rule("plan", "plan.recorded_before_entry", "eq", True)]))
    _assign(history_db, entry["id"], version["id"])
    _linked_plan(history_db, entry, monkeypatch, received_at="2026-01-01T09:30:00Z")
    before = get_strategy_evaluation_service(entry["id"], db_path=history_db)
    journal.update_entry_behavior(entry["id"], {"planned_stop_pct": 10}, db_path=history_db)
    after = get_strategy_evaluation_service(entry["id"], db_path=history_db)
    assert after == before
    assert after["data"]["rules"][0]["status"] == "FOLLOWED"
