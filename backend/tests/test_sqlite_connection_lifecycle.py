"""Production SQLite operations release their temporary database handles."""

from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest

from backend.modules.exchanges import encrypted_store, execution_repository
from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.strategies import repository as strategy_repository


@pytest.fixture
def opened_connections(monkeypatch):
    original_connect = sqlite3.connect
    connections = []

    def capture(*args, **kwargs):
        connection = original_connect(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr(sqlite3, "connect", capture)
    yield connections
    for connection in connections:
        connection.close()


def assert_closed(connection):
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")


@pytest.mark.parametrize(
    "read_operation",
    [
        lambda db, temp: journal_repository.list_entries(db_path=db, csv_path=temp / "absent.csv"),
        lambda db, temp: execution_repository.list_executions(db_path=db),
        lambda db, temp: encrypted_store.load_encrypted_credentials("synthetic", db_path=db),
    ],
    ids=["journal", "executions", "encrypted-store-empty-read"],
)
def test_production_read_closes_before_immediate_windows_rename(tmp_path, opened_connections, read_operation):
    db = tmp_path / "synthetic.db"
    result = read_operation(db, tmp_path)

    assert result in ([], None)
    assert len(opened_connections) == 1
    assert_closed(opened_connections[0])
    db.rename(tmp_path / "renamed.db")


def test_exception_rolls_back_closes_and_allows_immediate_rename(tmp_path, monkeypatch, opened_connections):
    db = tmp_path / "synthetic.db"
    assert journal_repository.list_entries(db_path=db, csv_path=tmp_path / "absent.csv") == []
    opened_connections.clear()

    def fail_after_write(connection):
        connection.execute("INSERT INTO journal_entries (symbol) VALUES ('rollback-marker')")
        raise RuntimeError("synthetic read failure")

    monkeypatch.setattr(journal_repository, "_migrate_signed_pnl", fail_after_write)
    with pytest.raises(RuntimeError, match="synthetic read failure"):
        journal_repository.list_entries(db_path=db, csv_path=tmp_path / "absent.csv")

    assert len(opened_connections) == 1
    assert_closed(opened_connections[0])
    renamed = tmp_path / "renamed.db"
    db.rename(renamed)
    with closing(sqlite3.connect(renamed)) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM journal_entries WHERE symbol = 'rollback-marker'"
        ).fetchone()[0] == 0


def test_repeated_journal_reads_leave_no_handles(tmp_path, opened_connections):
    db = tmp_path / "synthetic.db"
    for _ in range(100):
        assert journal_repository.list_entries(db_path=db, csv_path=tmp_path / "absent.csv") == []

    assert len(opened_connections) == 100
    for connection in opened_connections:
        assert_closed(connection)
    db.rename(tmp_path / "renamed.db")


@pytest.mark.parametrize(
    "repository,operation",
    [
        (plan_repository, lambda db: plan_repository.get_plan(1, db_path=db)),
        (strategy_repository, lambda db: strategy_repository.initialize_schema(db_path=db)),
    ],
    ids=["plan-schema", "strategy-schema"],
)
def test_schema_setup_failure_closes_connection(
    tmp_path, monkeypatch, opened_connections, repository, operation
):
    db = tmp_path / "synthetic.db"

    def fail_schema(_connection):
        raise RuntimeError("synthetic schema failure")

    monkeypatch.setattr(repository, "_ensure_schema", fail_schema)
    with pytest.raises(RuntimeError, match="synthetic schema failure"):
        operation(db)

    assert len(opened_connections) == 1
    assert_closed(opened_connections[0])
    db.rename(tmp_path / "renamed.db")
