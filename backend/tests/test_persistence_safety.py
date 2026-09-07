"""PR-A production-bootstrap preservation and deterministic SQLite writer gates."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier, Event, local

import pytest

from backend.modules.exchanges import execution_repository as executions
from backend.modules.experiments import repository as experiments
from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_assignments import repository as assignments
from backend.tests.test_experiments import definition
from backend.tests.test_plan_lab_repository import _plan_payload, _revision
from backend.tests.test_strategy_assignments import _strategy


def snapshot(path):
    """Unnormalized SQLite values, including unrelated tables and sqlite_sequence."""
    with closing(sqlite3.connect(path)) as conn:
        tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {table: sorted(conn.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr) for table in tables}


def seed(conn, external_id, **changes):
    payload = dict(external_id=external_id, datetime="2026-01-01T00:00:00Z", symbol="BTC/USDT",
                   direction="Long", entry_price=100.0, source="binance_fill", exchange="Binance",
                   notes="User note preserved verbatim", created_at="2026-01-01T00:00:00Z")
    payload.update(changes)
    return conn.execute(
        f"INSERT INTO journal_entries ({', '.join(payload)}) VALUES ({', '.join('?' for _ in payload)})",
        tuple(payload.values()),
    ).lastrowid


def copy_execution(conn, source_id, **changes):
    source = dict(conn.execute("SELECT * FROM journal_entries WHERE id=?", (source_id,)).fetchone())
    payload = {column: source.get(column) for column in executions.COLUMNS}
    payload["fee_complete"] = 1
    payload.update(changes)
    conn.execute(
        f"INSERT INTO exchange_executions ({', '.join(payload)}) VALUES ({', '.join('?' for _ in payload)})",
        tuple(payload.values()),
    )


@pytest.fixture
def legacy_db(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    monkeypatch.setattr(journal, "JOURNAL_DB_PATH", path)
    monkeypatch.setattr(journal, "JOURNAL_CSV_PATH", tmp_path / "absent.csv")
    journal.INITIALIZED_DATABASES.clear()
    assignments.initialize_schema(db_path=path)
    strategy = _strategy(path)
    version = strategies.list_versions(strategy["id"], db_path=path)[0]["id"]
    plan = plans.create_plan(_plan_payload(), db_path=path)
    experiments.create_experiment(definition(), db_path=path)
    with closing(sqlite3.connect(path)) as conn:
        conn.row_factory = sqlite3.Row
        ids = {name: seed(conn, name) for name in ("normal", "equivalent", "conflict", "protected")}
        ids["null"] = seed(conn, None)
        ids["unrelated"] = seed(conn, "unrelated", source="manual", notes="Do not touch", fomo=0)
        copy_execution(conn, ids["equivalent"])
        copy_execution(conn, ids["conflict"], entry_price=999.0)
        conn.execute("""UPDATE journal_entries SET setup_tags='["descriptive"]', mistake_tags='["early"]',
                     fomo=0, revenge_trade=1, confidence_score=4, focus_score=5,
                     emotion_before='calm', planned_stop_pct=1.5, mistakes='manual annotation'
                     WHERE id=?""", (ids["protected"],))
        conn.execute("INSERT INTO journal_strategy_assignments VALUES (?, ?, 't', 't')", (ids["protected"], version))
        conn.execute("""INSERT INTO trading_plan_links
                     (plan_id,journal_entry_id,journal_external_id,link_status,linked_at,updated_at)
                     VALUES (?, ?, 'protected', 'LINKED', 't', 't')""", (plan["id"], ids["protected"]))
        conn.execute("""INSERT INTO daily_journal_entries
                     (trade_date,pre_session_notes,post_session_notes,created_at,updated_at)
                     VALUES ('2026-01-01','Keep daily plan','Keep daily review','t','t')""")
        conn.execute("""INSERT INTO journal_behavior_rules(name,rule_type,parameters)
                     VALUES ('Keep rule','max_stop_pct','{"max_stop_pct":2}')""")
        conn.commit()
    yield path, ids, version, plan
    journal.INITIALIZED_DATABASES.clear()


def bootstrap(path):
    # Same functions/order as main.lifespan, with an isolated path. Clear the
    # process-local Journal cache to include the cold-start schema path too.
    journal.INITIALIZED_DATABASES.clear()
    assignments.initialize_schema(db_path=path)
    experiments.initialize_schema(db_path=path)


def test_production_bootstrap_preserves_raw_data_and_is_idempotent(legacy_db, monkeypatch):
    path, ids, version, plan = legacy_db
    before = snapshot(path)
    outcomes = []
    original = executions._migrate_legacy_rows

    def capture(conn):
        result = original(conn)
        outcomes.append(result)
        return result

    monkeypatch.setattr(executions, "_migrate_legacy_rows", capture)
    bootstrap(path)
    after = snapshot(path)
    assert outcomes[0] == {ids["normal"]: "MIGRATED", ids["equivalent"]: "ALREADY_EQUIVALENT",
                           ids["conflict"]: "CONFLICT", ids["protected"]: "NOT_MIGRATABLE",
                           ids["null"]: "NOT_MIGRATABLE"}
    assert after["journal_entries"] == [row for row in before["journal_entries"]
                                         if row[0] not in (ids["normal"], ids["equivalent"])]
    for table in before.keys() - {"journal_entries", "exchange_executions"}:
        assert after[table] == before[table], table
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("SELECT notes FROM exchange_executions WHERE external_id='normal'").fetchone() == ("User note preserved verbatim",)
        assert conn.execute("SELECT entry_price FROM exchange_executions WHERE external_id='conflict'").fetchone() == (999.0,)
        assert conn.execute("SELECT strategy_version_id FROM journal_strategy_assignments WHERE journal_entry_id=?", (ids["protected"],)).fetchone() == (version,)
        assert conn.execute("SELECT journal_entry_id FROM trading_plan_links WHERE plan_id=?", (plan["id"],)).fetchone() == (ids["protected"],)
    assert len(after["exchange_executions"]) == len(before["exchange_executions"]) + 1
    assert all(row in after["exchange_executions"] for row in before["exchange_executions"])
    bootstrap(path)
    assert snapshot(path) == after


@pytest.mark.parametrize("field,value", [
    ("fomo", 0), ("revenge_trade", 0), ("focus_score", 1), ("confidence_score", 5),
    ("setup_tags", '["not a strategy"]'), ("mistake_tags", '["late"]'),
    ("emotion", "calm"), ("emotion_before", "calm"), ("emotion_during", "tense"),
    ("emotion_after", "calm"), ("mistakes", "annotation"),
    ("planned_stop_pct", 1), ("planned_target_pct", 2), ("planned_entry_reason", "wait"),
    ("plan_recorded_at", "2026-01-01"), ("entry_reason_1", "manual reason"),
    ("r_multiple", 0), ("funding_fee", 0),
])
def test_each_nonrepresentable_recorded_fact_retains_source(legacy_db, field, value):
    path, *_ = legacy_db
    with closing(sqlite3.connect(path)) as conn:
        identifier = seed(conn, "single-fact", **{field: value})
        conn.commit()
        before = conn.execute("SELECT * FROM journal_entries WHERE id=?", (identifier,)).fetchone()
    bootstrap(path)
    with closing(sqlite3.connect(path)) as conn:
        assert conn.execute("SELECT * FROM journal_entries WHERE id=?", (identifier,)).fetchone() == before
        assert conn.execute("SELECT 1 FROM exchange_executions WHERE external_id='single-fact'").fetchone() is None


@pytest.mark.parametrize("relation", ["assignment", "plan_id", "plan_external"])
@pytest.mark.parametrize("foreign_keys", [0, 1])
def test_relationship_alone_prevents_migration_even_with_fk_off(legacy_db, relation, foreign_keys):
    path, _, version, _ = legacy_db
    plan = plans.create_plan(_plan_payload(), db_path=path)
    with closing(sqlite3.connect(path)) as conn:
        conn.execute(f"PRAGMA foreign_keys={foreign_keys}")
        identifier = seed(conn, "linked-only")
        if relation == "assignment":
            conn.execute("INSERT INTO journal_strategy_assignments VALUES (?, ?, 't', 't')", (identifier, version))
        else:
            conn.execute("""INSERT INTO trading_plan_links
                         (plan_id,journal_entry_id,journal_external_id,link_status,linked_at,updated_at)
                         VALUES (?, ?, ?, 'AMBIGUOUS_LINK', 't', 't')""",
                         (plan["id"], identifier if relation == "plan_id" else None,
                          "linked-only" if relation == "plan_external" else None))
        conn.commit()
        conn.row_factory = sqlite3.Row
        before = snapshot(path)
        executions._ensure_schema(conn)
    after = snapshot(path)
    assert any(row[0] == identifier for row in after["journal_entries"])
    for table in ("trading_plans", "trading_plan_revisions", "trading_plan_links", "journal_strategy_assignments"):
        assert after[table] == before[table]


@pytest.mark.parametrize("fault", ["insert", "delete", "ignore", "rewrite", "ignore_delete"])
def test_bootstrap_failure_rolls_back_entire_migration_unit(legacy_db, fault):
    path, *_ = legacy_db
    with closing(sqlite3.connect(path)) as conn:
        seed(conn, "last")
        triggers = {
            "insert": "BEFORE INSERT ON exchange_executions WHEN NEW.external_id='last' BEGIN SELECT RAISE(ABORT,'injected'); END",
            "delete": "BEFORE DELETE ON journal_entries WHEN OLD.external_id='last' BEGIN SELECT RAISE(ABORT,'injected'); END",
            "ignore": "BEFORE INSERT ON exchange_executions WHEN NEW.external_id='last' BEGIN SELECT RAISE(IGNORE); END",
            "rewrite": "AFTER INSERT ON exchange_executions WHEN NEW.external_id='last' BEGIN UPDATE exchange_executions SET notes='rewritten' WHERE external_id='last'; END",
            "ignore_delete": "BEFORE DELETE ON journal_entries WHEN OLD.external_id='last' BEGIN SELECT RAISE(IGNORE); END",
        }
        conn.execute("CREATE TRIGGER injected " + triggers[fault])
        conn.commit()
    before = snapshot(path)
    with pytest.raises((sqlite3.IntegrityError, RuntimeError)):
        bootstrap(path)
    assert snapshot(path) == before


def test_execution_bootstrap_never_commits_callers_transaction(legacy_db):
    path, *_ = legacy_db
    before = snapshot(path)
    with closing(sqlite3.connect(path)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN")
        seed(conn, "outer-transaction")
        executions._ensure_schema(conn)
        assert conn.in_transaction
        conn.rollback()
    assert snapshot(path) == before


@pytest.mark.parametrize("in_trade", [False, True])
def test_plan_appenders_serialize_before_reading_version(tmp_path, monkeypatch, in_trade):
    path = tmp_path / "plans.db"
    position = dict(exchange="binance", symbol="BTC/USDT", direction="Long", position_id="live-1", average_price=100)
    if in_trade:
        payload = {**_plan_payload(), "position_id": "live-1", "revision": _revision(None)}
        plan = plans.create_in_trade_plan(payload, position, db_path=path)
    else:
        plan = plans.create_plan(_plan_payload(), db_path=path)
    original = plans._connect
    first_locked, second_attempt = Event(), Event()
    thread = local()

    class Connection:
        def __init__(self):
            self.conn = original(path)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            try:
                return self.conn.__exit__(*args)
            finally:
                self.conn.close()

        def __getattr__(self, name):
            return getattr(self.conn, name)

        def execute(self, sql, args=()):
            if sql == "BEGIN IMMEDIATE":
                if thread.writer == 1:
                    assert first_locked.wait(10)
                    second_attempt.set()
                    return self.conn.execute(sql, args)
                result = self.conn.execute(sql, args)
                first_locked.set()
                assert second_attempt.wait(10)
                return result
            if "COALESCE(MAX(version)" in sql:
                assert self.conn.in_transaction
            return self.conn.execute(sql, args)

    # Both connections are initialized before writer 0 takes its lock. No
    # sleeps; events control only scheduling, SQLite controls serialization.
    connected = Barrier(2)

    def connect(*_args, **_kwargs):
        connection = Connection()
        if not getattr(thread, "connected", False):
            thread.connected = True
            connected.wait(10)
        return connection

    monkeypatch.setattr(plans, "_connect", connect)

    def append(writer):
        thread.writer = writer
        revision = {**_revision(None if in_trade else 100), "memo": f"writer-{writer}"}
        if in_trade:
            return plans.add_in_trade_revision(plan["id"], revision, position, db_path=path)
        return plans.add_revision(plan["id"], revision, db_path=path)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(append, writer) for writer in (0, 1)]
        for future in futures:
            future.result(timeout=15)
    monkeypatch.setattr(plans, "_connect", original)
    final = plans.get_plan(plan["id"], db_path=path)
    assert final["revisions"][0] == plan["revisions"][0]
    assert [(row["version"], row["memo"]) for row in final["revisions"]] == [(1, None), (2, "writer-0"), (3, "writer-1")]


@pytest.mark.parametrize("in_trade", [False, True])
def test_plan_failed_append_rolls_back_number_and_previous_history(tmp_path, in_trade):
    path = tmp_path / "rollback.db"
    position = dict(exchange="binance", symbol="BTC/USDT", direction="Long", position_id="live-1", average_price=100)
    plan = (plans.create_in_trade_plan({**_plan_payload(), "position_id": "live-1", "revision": _revision(None)}, position, db_path=path)
            if in_trade else plans.create_plan(_plan_payload(), db_path=path))
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("CREATE TRIGGER fail_parent BEFORE UPDATE ON trading_plans BEGIN SELECT RAISE(ABORT,'injected'); END")
        conn.commit()
    before = snapshot(path)
    revision = _revision(None if in_trade else 100)
    def append():
        return (plans.add_in_trade_revision(plan["id"], revision, position, db_path=path) if in_trade
                else plans.add_revision(plan["id"], revision, db_path=path))
    with pytest.raises(sqlite3.IntegrityError, match="injected"):
        append()
    assert snapshot(path) == before
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("DROP TRIGGER fail_parent")
        conn.commit()
    result = append()
    assert [row["version"] for row in result["revisions"]] == [1, 2]
    assert result["revisions"][0] == plan["revisions"][0]
