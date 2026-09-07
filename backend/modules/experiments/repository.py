"""Append-only lifecycle, draft-only edits; same production Journal SQLite file."""
import json
from contextlib import closing

from backend.modules.journal import repository as journal
from backend.modules.strategies import repository as strategies
from backend.modules.experiments.schemas import Experiment, ExperimentDefinition
from backend.utils.error_handler import APIError, NotFoundError, ValidationError


def _ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
            ownership TEXT NOT NULL DEFAULT 'USER_OWNED' CHECK(ownership = 'USER_OWNED'),
            status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
            definition_json TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            started_at TEXT, completed_at TEXT, cancelled_at TEXT
        );
        CREATE TRIGGER IF NOT EXISTS experiments_no_delete BEFORE DELETE ON experiments
        BEGIN SELECT RAISE(ABORT, 'Experiment history cannot be deleted'); END;
        CREATE TRIGGER IF NOT EXISTS experiments_history_guard BEFORE UPDATE ON experiments
        WHEN OLD.status IN ('COMPLETED','CANCELLED')
          OR NEW.created_at != OLD.created_at OR NEW.id != OLD.id
          OR (OLD.status != 'DRAFT' AND NEW.definition_json != OLD.definition_json)
          OR (NEW.status != OLD.status AND NOT (
              (OLD.status='DRAFT' AND NEW.status IN ('ACTIVE','CANCELLED')) OR
              (OLD.status='ACTIVE' AND NEW.status IN ('COMPLETED','CANCELLED'))))
        BEGIN SELECT RAISE(ABORT, 'Experiment history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS experiments_guard_strategy_delete BEFORE DELETE ON strategies
        WHEN EXISTS (SELECT 1 FROM experiments e, json_each(e.definition_json, '$.query.filters.strategy_ids') j WHERE j.value=OLD.id)
        BEGIN SELECT RAISE(ABORT, 'Experiment references this Strategy'); END;
        CREATE TRIGGER IF NOT EXISTS experiments_guard_version_delete BEFORE DELETE ON strategy_versions
        WHEN EXISTS (SELECT 1 FROM experiments e, json_each(e.definition_json, '$.query.filters.strategy_version_ids') j WHERE j.value=OLD.id)
        BEGIN SELECT RAISE(ABORT, 'Experiment references this StrategyVersion'); END;
    """)


def initialize_schema(*, db_path=None):
    with closing(strategies._connect(db_path)) as conn:
        _ensure_schema(conn)
        conn.commit()


def _row(row):
    data = dict(row)
    data['definition'] = json.loads(data.pop('definition_json'))
    return Experiment.model_validate(data)


def _get(conn, identifier):
    row = conn.execute('SELECT * FROM experiments WHERE id=?', (identifier,)).fetchone()
    if row is None:
        raise NotFoundError('Experiment', str(identifier))
    return _row(row)


def _validate_references(conn, definition):
    filters = definition.query.filters
    for table, ids in [('strategies', filters.strategy_ids), ('strategy_versions', filters.strategy_version_ids)]:
        for identifier in ids or []:
            if conn.execute(f'SELECT id FROM {table} WHERE id=?', (identifier,)).fetchone() is None:
                raise ValidationError(f'Unknown {table} ID: {identifier}')
    if filters.strategy_ids and filters.strategy_version_ids:
        for identifier in filters.strategy_version_ids:
            parent = conn.execute('SELECT strategy_id FROM strategy_versions WHERE id=?', (identifier,)).fetchone()[0]
            if parent not in filters.strategy_ids:
                raise ValidationError('StrategyVersion does not belong to the selected Strategies')


def list_experiments(*, offset=0, limit=50, db_path=None):
    initialize_schema(db_path=db_path)
    with closing(journal._connect(db_path)) as conn:
        return [_row(row) for row in conn.execute('SELECT * FROM experiments ORDER BY id DESC LIMIT ? OFFSET ?', (limit, offset))]


def get_experiment(identifier, *, db_path=None):
    initialize_schema(db_path=db_path)
    with closing(journal._connect(db_path)) as conn:
        return _get(conn, identifier)


def create_experiment(definition: ExperimentDefinition, *, db_path=None):
    initialize_schema(db_path=db_path)
    with closing(journal._connect(db_path)) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        _validate_references(conn, definition)
        now = strategies.utc_now()
        identifier = conn.execute("INSERT INTO experiments(status,definition_json,created_at,updated_at) VALUES ('DRAFT',?,?,?)",
                                  (definition.model_dump_json(), now, now)).lastrowid
        return _get(conn, identifier)


def mutate(identifier, revision, *, definition=None, status=None, db_path=None):
    initialize_schema(db_path=db_path)
    with closing(journal._connect(db_path)) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        current = _get(conn, identifier)
        if current.revision != revision:
            raise APIError('Experiment changed; reload before saving', 'CONFLICT', 409)
        if definition is not None:
            if current.status != 'DRAFT':
                raise APIError('Only Draft definitions can be edited', 'CONFLICT', 409)
            _validate_references(conn, definition)
            conn.execute('UPDATE experiments SET definition_json=?,revision=revision+1,updated_at=? WHERE id=?',
                         (definition.model_dump_json(), strategies.utc_now(), identifier))
        else:
            allowed = {'DRAFT': {'ACTIVE', 'CANCELLED'}, 'ACTIVE': {'COMPLETED', 'CANCELLED'}}
            if status not in allowed.get(current.status, set()):
                raise APIError('Invalid experiment lifecycle transition', 'CONFLICT', 409)
            now = strategies.utc_now()
            field = {'ACTIVE': 'started_at', 'COMPLETED': 'completed_at', 'CANCELLED': 'cancelled_at'}[status]
            conn.execute(f'UPDATE experiments SET status=?,{field}=?,updated_at=?,revision=revision+1 WHERE id=?',
                         (status, now, now, identifier))
        return _get(conn, identifier)
