"""Definition ownership, production migration, lifecycle and official measurement."""
from concurrent.futures import ThreadPoolExecutor
from decimal import localcontext
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as SchemaError

from backend.main import app
from backend.modules.analytics.service import query_analytics
from backend.modules.experiments import repository as repo, service
from backend.modules.experiments.schemas import ExperimentDefinition
from backend.modules.journal import repository as journal
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_assignments import repository as assignments
from backend.tests.test_review_engine import START, DAY, save, save_strategy, document
from backend.utils.error_handler import APIError


def definition(**changes):
    return ExperimentDefinition.model_validate({
        'name': 'Entry process observation', 'hypothesis': 'User-defined historical comparison',
        'query': {'metric': 'average_r', 'dimension': 'all', 'filters': {'start_time': START, 'end_time': START + DAY - 1}},
        'baseline': {'start_time': START - DAY, 'end_time': START - 1},
        'criterion': {'operator': 'gte', 'basis': 'DELTA', 'target': '0.2'}, **changes,
    })


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / 'experiments.db'
    monkeypatch.setattr(journal, 'JOURNAL_DB_PATH', path)
    monkeypatch.setattr(journal, 'JOURNAL_CSV_PATH', tmp_path / 'absent.csv')
    journal.INITIALIZED_DATABASES.clear()
    assignments.initialize_schema(db_path=path)
    yield path
    journal.INITIALIZED_DATABASES.clear()


def populate(db, current=2, baseline=1):
    for index in range(5):
        save(db, index + 1, r_multiple=current)
        save(db, index + 6, r_multiple=baseline, datetime='2025-12-31T23:59:59.999Z', entry_datetime='2025-12-31T22:00:00Z')


def active(db, spec=None):
    draft = repo.create_experiment(spec or definition(), db_path=db)
    return repo.mutate(draft.id, draft.revision, status='ACTIVE', db_path=db)


def test_create_edit_lifecycle_and_no_terminal_rewrite(db):
    draft = repo.create_experiment(definition(), db_path=db)
    assert draft.status == 'DRAFT' and draft.ownership == 'USER_OWNED'
    updated = repo.mutate(draft.id, 1, definition=definition(name='Edited'), db_path=db)
    assert updated.definition.name == 'Edited' and updated.revision == 2
    started = repo.mutate(draft.id, 2, status='ACTIVE', db_path=db)
    assert started.started_at and started.definition == updated.definition
    completed = repo.mutate(draft.id, 3, status='COMPLETED', db_path=db)
    assert completed.completed_at and completed.started_at == started.started_at
    for kwargs in [{'status': 'ACTIVE'}, {'status': 'CANCELLED'}, {'definition': definition()}]:
        with pytest.raises(APIError) as error:
            repo.mutate(draft.id, 4, db_path=db, **kwargs)
        assert error.value.status_code == 409
    assert repo.get_experiment(draft.id, db_path=db) == completed


@pytest.mark.parametrize('source,target', [('DRAFT','COMPLETED'), ('ACTIVE','ACTIVE'), ('CANCELLED','ACTIVE')])
def test_invalid_transition(db, source, target):
    row = repo.create_experiment(definition(), db_path=db)
    if source != 'DRAFT':
        row = repo.mutate(row.id, row.revision, status=source, db_path=db)
    with pytest.raises(APIError) as error:
        repo.mutate(row.id, row.revision, status=target, db_path=db)
    assert error.value.status_code == 409


def test_stale_revision_and_simultaneous_transition(db):
    row = repo.create_experiment(definition(), db_path=db)
    def start():
        try:
            return repo.mutate(row.id, 1, status='ACTIVE', db_path=db).status
        except APIError as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: start(), range(2)))
    assert sorted(outcomes, key=str) == [409, 'ACTIVE']


def test_production_bootstrap_twice_preserves_real_pre_experiment_data(db):
    entry = save(db)
    strategy = save_strategy(db)
    assignments.put_assignment(entry['id'], strategy['active_version_id'], db_path=db)
    with sqlite3.connect(db) as conn:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before = {table: conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall() for table in tables}
    for _ in range(2):
        with TestClient(app):
            pass
    with sqlite3.connect(db) as conn:
        after = {table: conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall() for table in tables}
        assert conn.execute('SELECT COUNT(*) FROM experiments').fetchone()[0] == 0
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert before == after


def test_definition_and_exact_version_survive_sync_and_raw_deletes_are_guarded(db):
    entry = save(db)
    strategy = save_strategy(db)
    version_id = strategy['active_version_id']
    spec = definition()
    spec.query.filters.strategy_version_ids = [version_id]
    row = active(db, spec)
    newer = strategies.create_version(strategy['id'], version_label='v2', version_label_key='v2', description=None, rules=document(), db_path=db)
    strategies.activate_version(strategy['id'], newer['id'], db_path=db)
    strategies.retire_version(strategy['id'], version_id, db_path=db)
    with sqlite3.connect(db) as conn:
        conn.execute('UPDATE journal_entries SET realized_pnl=99 WHERE id=?', (entry['id'],))
        for sql in ['DELETE FROM experiments', f'DELETE FROM strategy_versions WHERE id={version_id}']:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(sql)
    assert repo.get_experiment(row.id, db_path=db) == row


@pytest.mark.parametrize('changes', [
    {'query': {'metric': 'sql', 'filters': {'start_time': START, 'end_time': START+1}}},
    {'formula': 'arbitrary()'}, {'criterion': {'basis':'VALUE','operator':'eval','target':'1'}},
    {'criterion': {'basis':'VALUE','operator':'gte','target':'NaN'}},
    {'criterion': {'basis':'VALUE','operator':'gte','target':'1e9999'}},
    {'baseline': {'start_time':START,'end_time':START+1}}, {'minimum_sample': True},
    {'query': {'metric':'average_r','dimension':'fomo','filters':{'start_time':START,'end_time':START+1}}},
])
def test_bounded_contract_rejects_formulas_and_invalid_definitions(changes):
    with pytest.raises(SchemaError):
        definition(**changes)


@pytest.mark.parametrize('current,target,expected', [(2,'1','MET'),(2,'1.000000001','NOT_MET'),(None,'1','NOT_EVALUABLE')])
def test_measure_reuses_official_values_samples_and_exact_criterion(db, current, target, expected):
    populate(db, current=current)
    row = active(db, definition(criterion={'basis':'DELTA','operator':'gte','target':target}))
    result = service.measure(row.id, db_path=db)
    assert result.criterion_status == expected
    assert result.current.total_sample == result.baseline.total_sample == 5
    assert result.current.model_dump() == query_analytics(row.definition.query, db_path=db).data.groups[0].model_dump()
    assert result.baseline.model_dump() == query_analytics(result.baseline_query, db_path=db).data.groups[0].model_dump()
    if current is None:
        assert result.delta is None and result.current.unavailable_sample == 5
    else:
        assert result.delta == '1'


def test_measure_one_snapshot_no_cache_and_context_determinism(db, monkeypatch):
    populate(db)
    row = active(db)
    original = service.analytics_repository.load_snapshot
    calls = []
    def load(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)
    monkeypatch.setattr(service.analytics_repository, 'load_snapshot', load)
    outputs = []
    for precision in (6,12,28,50):
        with localcontext() as ctx:
            ctx.prec = precision
            outputs.append(service.measure(row.id, db_path=db).model_dump())
    assert len(calls) == 4 and all(item == outputs[0] for item in outputs)
    with sqlite3.connect(db) as conn:
        conn.execute('UPDATE journal_entries SET r_multiple=-1 WHERE id<=5')
    assert service.measure(row.id, db_path=db).criterion_status == 'NOT_MET'
    assert repo.get_experiment(row.id, db_path=db) == row


def test_empty_group_low_sample_draft_cancel_are_not_evaluable(db):
    draft = repo.create_experiment(definition(), db_path=db)
    assert service.measure(draft.id, db_path=db).criterion_status == 'NOT_EVALUABLE'
    save(db)
    row = repo.mutate(draft.id, 1, status='ACTIVE', db_path=db)
    assert 'CURRENT_INSUFFICIENT_SAMPLE' in service.measure(row.id, db_path=db).reasons
    repo.mutate(row.id, row.revision, status='CANCELLED', db_path=db)
    assert service.measure(row.id, db_path=db).criterion_status == 'NOT_EVALUABLE'


def test_api_surface_revision_errors_metadata_and_json(db):
    with TestClient(app) as client:
        assert client.get('/api/experiments/999').status_code == 404
        assert client.get('/api/experiments?limit=1000').status_code == 422
        created = client.post('/api/experiments', json=definition().model_dump()).json()['data']
        identifier = created['id']
        assert client.patch(f'/api/experiments/{identifier}', json={'revision':99,'definition':definition().model_dump()}).status_code == 409
        assert client.post(f'/api/experiments/{identifier}/transition', json={'revision':1,'status':'ACTIVE'}).status_code == 200
        assert client.patch(f'/api/experiments/{identifier}', json={'revision':2,'definition':definition().model_dump()}).status_code == 409
        assert client.get('/api/experiments').json()['data'][0]['ownership'] == 'USER_OWNED'
        measurement = client.get(f'/api/experiments/{identifier}/measurement')
        assert measurement.status_code == 200
        json.dumps(measurement.json(), allow_nan=False)


def test_unknown_and_mismatched_strategy_ids_and_group_refs_rejected(db):
    spec = definition()
    spec.query.filters.strategy_version_ids = [999]
    with pytest.raises(APIError) as error:
        repo.create_experiment(spec, db_path=db)
    assert error.value.status_code == 422
    first, second = save_strategy(db, 'First'), save_strategy(db, 'Second')
    spec.query.filters.strategy_ids = [second['id']]
    spec.query.filters.strategy_version_ids = [first['active_version_id']]
    with pytest.raises(APIError):
        repo.create_experiment(spec, db_path=db)
    payload = definition().model_dump()
    payload['query']['dimension'] = 'strategy_version'
    payload['group_key'] = f"strategy_version:{first['active_version_id']}"
    with pytest.raises(SchemaError):
        ExperimentDefinition.model_validate(payload)


def test_group_measurement_targets_exact_historical_version_and_is_read_only(db):
    populate(db)
    strategy = save_strategy(db)
    identifier = strategy['active_version_id']
    for entry_id in range(1, 11):
        assignments.put_assignment(entry_id, identifier, db_path=db)
    payload = definition().model_dump()
    payload['query']['dimension'] = 'strategy_version'
    payload['query']['filters']['strategy_version_ids'] = [identifier]
    payload['group_key'] = f'strategy_version:{identifier}'
    row = active(db, ExperimentDefinition.model_validate(payload))
    with sqlite3.connect(db) as conn:
        before = list(conn.iterdump())
    result = service.measure(row.id, db_path=db)
    assert result.current.identity.strategy_version_id == result.baseline.identity.strategy_version_id == identifier
    assert result.current.value == 2 and result.baseline.value == 1
    with sqlite3.connect(db) as conn:
        assert list(conn.iterdump()) == before


@pytest.mark.parametrize('operator,target,status', [('gte','2','MET'),('gte','2.00000001','NOT_MET'),('lte','2','MET'),('lte','1.99999999','NOT_MET')])
def test_value_criterion_exact_boundaries(db, operator, target, status):
    populate(db)
    row = active(db, definition(criterion={'basis':'VALUE','operator':operator,'target':target}))
    assert service.measure(row.id, db_path=db).criterion_status == status


def test_cancel_timestamp_and_definition_history_guard_with_foreign_keys_off(db):
    row = active(db)
    cancelled = repo.mutate(row.id, row.revision, status='CANCELLED', db_path=db)
    assert cancelled.cancelled_at and cancelled.started_at == row.started_at
    assert cancelled.definition == row.definition
    with sqlite3.connect(db) as conn:
        assert conn.execute('PRAGMA foreign_keys').fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE experiments SET definition_json='{}' WHERE id=?", (row.id,))
