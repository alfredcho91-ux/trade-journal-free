"""Presentation reads preserve every row, schema object and analytical contract."""
import sqlite3
from contextlib import closing
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.journal import repository as journal
from backend.modules.journal.planning_context import get_planning_context
from backend.modules.plan_lab import repository as plans
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.tests.test_plan_lab_repository import _closed_entry, _plan_payload, _retrospective_payload
from backend.utils.error_handler import APIError


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / 'context.db'
    monkeypatch.setattr(journal, 'JOURNAL_DB_PATH', path)
    monkeypatch.setattr(journal, 'JOURNAL_CSV_PATH', tmp_path / 'absent.csv')
    _closed_entry(path)
    return path


def read(db):
    before = db.read_bytes()
    with sqlite3.connect(db) as conn:
        dump = list(conn.iterdump())
    result = get_planning_context(1, db_path=db).data
    assert db.read_bytes() == before
    with sqlite3.connect(db) as conn:
        assert list(conn.iterdump()) == dump
    return result


def test_journal_only_no_schema_bootstrap_or_writes(db, monkeypatch):
    journal.update_entry_behavior(1, {'planned_stop_pct': 1, 'planned_entry_reason': 'original', 'plan_recorded_at': '2020-01-01'}, db_path=db)
    for module, names in [(plans, ['list_plans', 'reconcile_links', '_connect', '_ensure_schema']),
                          (journal, ['list_entries', '_connect', '_ensure_schema', '_migrate_legacy_csv_if_needed', '_migrate_signed_pnl'])]:
        for name in names:
            monkeypatch.setattr(module, name, Mock(side_effect=AssertionError(f'{name} must not run')))
    context = read(db)
    assert context.link_state == 'NO_LINKED_PLAN'
    assert context.journal_notes.planned_stop_pct == 1
    assert context.journal_notes.has_notes and not context.journal_notes.timing_verified
    assert context.linked_plan is None


@pytest.mark.parametrize('notes', [False, True])
def test_plan_only_and_conflicting_sources_stay_separate(db, notes):
    if notes:
        journal.update_entry_behavior(1, {'planned_stop_pct': 9, 'planned_target_pct': 20, 'planned_entry_reason': 'journal'}, db_path=db)
    plan = plans.create_retrospective_plan(_retrospective_payload(), 1, db_path=db)
    context = read(db)
    assert context.link_state == 'LINKED'
    assert context.journal_notes.has_notes is notes
    assert context.journal_notes.planned_stop_pct == (9 if notes else None)
    assert context.linked_plan.plan['latest_revision']['stop_loss'] == 98
    assert context.linked_plan.plan['id'] == plan['id']
    assert context.linked_plan.analysis_basis == 'RETROSPECTIVE'
    assert context.linked_plan.entry_time_revision is None


def test_latest_revision_is_not_entry_time_revision(db, monkeypatch):
    monkeypatch.setattr(plans, 'utc_now', lambda: '2026-01-01T09:00:00Z')
    plan = plans.create_plan(_plan_payload(), db_path=db)
    plans.link_plan(plan['id'], 1, db_path=db)
    monkeypatch.setattr(plans, 'utc_now', lambda: '2026-01-02T09:00:00Z')
    plans.add_revision(plan['id'], {**_plan_payload()['revision'], 'stop_loss': 97}, db_path=db)
    context = read(db)
    assert context.linked_plan.plan['source'] == 'VERIFIED_PRETRADE'
    assert context.linked_plan.plan['latest_revision']['version'] == 2
    assert context.linked_plan.entry_time_revision['version'] == 1
    assert context.linked_plan.analysis_revision['version'] == 1
    assert context.linked_plan.plan['revisions'][1]['phase'] == 'POST_TRADE_INPUT'


def test_candidates_are_explicit_and_never_nearest_or_latest(db):
    first = plans.create_plan(_plan_payload(), db_path=db)
    second = plans.create_plan(_plan_payload(), db_path=db)
    plans.create_plan({**_plan_payload(), 'symbol': 'ETH/USDT'}, db_path=db)
    cancelled = plans.create_plan(_plan_payload(), db_path=db)
    plans.update_status(cancelled['id'], 'cancelled', db_path=db)
    context = read(db)
    assert context.link_state == 'CANDIDATES'
    assert [plan['id'] for plan in context.candidate_plans] == [first['id'], second['id']]
    assert context.linked_plan is None


def test_stale_or_ambiguous_link_is_not_repaired(db):
    plan = plans.create_retrospective_plan(_retrospective_payload(), 1, db_path=db)
    with sqlite3.connect(db) as conn:
        conn.execute('UPDATE trading_plan_links SET journal_entry_id=999 WHERE plan_id=?', (plan['id'],))
    context = read(db)
    assert context.link_state == 'AMBIGUOUS'
    assert context.linked_plan.plan['link']['journal_entry_id'] == 999
    assert context.linked_plan.analysis_revision is None


def test_multiple_linked_records_not_silently_selected(db):
    plans.create_retrospective_plan(_retrospective_payload(), 1, db_path=db)
    other = plans.create_plan(_plan_payload(), db_path=db)
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO trading_plan_links(plan_id,journal_entry_id,link_status,linked_at,updated_at) VALUES(?,1,'AMBIGUOUS_LINK','now','now')", (other['id'],))
    context = read(db)
    assert context.link_state == 'AMBIGUOUS'
    assert context.linked_plan is None and context.issues == ['MULTIPLE_LINKED_PLANS']


def test_missing_and_zero_are_not_fabricated(db):
    with sqlite3.connect(db) as conn:
        conn.execute('UPDATE journal_entries SET planned_stop_pct=0, entry_price=NULL, fomo=0')
    context = read(db)
    assert context.journal_notes.planned_stop_pct == 0
    assert context.journal_notes.planned_target_pct is None
    assert context.actual_execution['entry_price'] is None


def test_missing_database_is_error_without_creation(tmp_path):
    path = tmp_path / 'absent.db'
    with pytest.raises(APIError) as error:
        get_planning_context(1, db_path=path)
    assert error.value.status_code == 503 and not path.exists()


def test_partial_schema_is_unavailable_not_empty(db):
    with sqlite3.connect(db) as conn:
        conn.execute('CREATE TABLE trading_plans(id INTEGER)')
    before = db.read_bytes()
    with pytest.raises(APIError, match='Unable to load planning context'):
        get_planning_context(1, db_path=db)
    assert before == db.read_bytes()


def test_http_read_and_error_contract(db, monkeypatch):
    with TestClient(app) as client:
        # Application startup owns schema installation, outside the read operation.
        with closing(sqlite3.connect(db)) as checkpoint:
            checkpoint.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        before = db.read_bytes()
        monkeypatch.setattr(plans, 'reconcile_links', Mock(side_effect=AssertionError('no reconciliation')))
        monkeypatch.setattr(journal, '_connect', Mock(side_effect=AssertionError('no write connection')))
        assert client.get('/api/journal/1/planning-context').json()['data']['journal_entry_id'] == 1
        assert db.read_bytes() == before
        assert client.get('/api/journal/999/planning-context').status_code == 404
        monkeypatch.setattr(journal, 'JOURNAL_DB_PATH', db.parent / 'missing.db')
        assert client.get('/api/journal/1/planning-context').status_code == 503


def test_read_connection_is_read_only_and_one_transaction(db, monkeypatch):
    real_connect = sqlite3.connect
    statements = []
    def connect(database_uri, **kwargs):
        assert database_uri.endswith('?mode=ro') and kwargs['uri'] is True
        conn = real_connect(database_uri, **kwargs)
        conn.set_trace_callback(statements.append)
        return conn
    monkeypatch.setattr(sqlite3, 'connect', connect)
    get_planning_context(1, db_path=db)
    assert statements.count('BEGIN') == 1
    assert 'PRAGMA query_only = ON' in statements
    assert all(sql.lstrip().upper().startswith(('SELECT', 'PRAGMA', 'BEGIN')) for sql in statements)


def test_explicit_retrospective_save_never_promotes_note_timestamp(db):
    journal.update_entry_behavior(1, {'planned_stop_pct': 2, 'plan_recorded_at': '1999-01-01'}, db_path=db)
    read(db)
    plan = plans.create_retrospective_plan(_retrospective_payload(), 1, db_path=db)
    entry = journal.list_entries(db_path=db)[0]
    assert not extract_metric_observations(entry, linked_plan=plan)['plan.recorded_before_entry'].value
    assert read(db).linked_plan.entry_time_revision is None
    assert plan['received_at'] != entry['plan_recorded_at']


def test_all_analytical_outputs_and_version_assignment_unchanged(db):
    from backend.modules.analytics.registry import METRIC_REGISTRY
    from backend.modules.analytics.service import query_analytics
    from backend.modules.review import service as review
    from backend.modules.rule_engine.service import get_strategy_evaluation_service
    from backend.modules.experiments import repository as experiments, service as measurement
    from backend.modules.strategy_assignments import repository as assignments
    from backend.modules.strategies import repository as strategies
    from backend.tests.test_advanced_analytics import query, save_strategy
    from backend.tests.test_review_engine import request
    from backend.tests.test_experiments import definition
    strategy = save_strategy(db)
    assignments.put_assignment(1, strategy['active_version_id'], db_path=db)
    plans.create_retrospective_plan(_retrospective_payload(), 1, db_path=db)
    experiment = experiments.create_experiment(definition(), db_path=db)
    experiments.mutate(experiment.id, 1, status='ACTIVE', db_path=db)
    def outputs():
        return (
            [query_analytics(query(metric), db_path=db).model_dump() for metric in METRIC_REGISTRY],
            review.trading_review(request(), db_path=db).model_dump(),
            get_strategy_evaluation_service(1, db_path=db),
            assignments.get_assignment(1, db_path=db),
            strategies.get_strategy(strategy['id'], db_path=db),
            measurement.measure(experiment.id, db_path=db).model_dump(),
        )
    before = outputs()
    for _ in range(3):
        read(db)
    assert outputs() == before
