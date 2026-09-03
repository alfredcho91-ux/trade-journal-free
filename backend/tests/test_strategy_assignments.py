from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event, local

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.exchanges import execution_repository, sync_service
from backend.modules.exchanges.models import TradeFetchResult
from backend.modules.journal import daily_repository
from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.strategies import repository as strategy_repository
from backend.modules.strategy_assignments import repository as assignment_repository


@pytest.fixture
def assignment_db(monkeypatch, tmp_path):
    root = tmp_path / "strategy-assignment"
    db_path = root / "trade_journal.db"
    csv_path = root / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path
    journal_repository.INITIALIZED_DATABASES.clear()


def _rules(suffix: str = "base"):
    return {
        "schema_version": 1,
        "entry_rules": [{"id": f"entry-{suffix}", "text": "Wait for close"}],
        "risk_rules": [{"id": f"risk-{suffix}", "text": "Risk one percent"}],
        "exit_rules": [{"id": f"exit-{suffix}", "text": "Exit on invalidation"}],
    }


def _strategy(db_path, name: str = "Breakout Momentum"):
    return strategy_repository.create_strategy(
        name=name,
        name_key=name.casefold(),
        description="Reusable setup",
        version_label="v1.0",
        version_label_key="v1.0",
        version_description="Initial definition",
        rules=_rules(),
        db_path=db_path,
    )


def _new_version(db_path, strategy_id: int, label: str = "v1.1"):
    return strategy_repository.create_version(
        strategy_id,
        version_label=label,
        version_label_key=label.casefold(),
        description=f"Definition {label}",
        rules=_rules(label),
        db_path=db_path,
    )


def _journal_entry(
    db_path,
    identifier: str,
    *,
    source: str = "binance_position",
    setup_tags=None,
):
    normalized_setup_tags = (
        ["Breakout Momentum", "High volume"] if setup_tags is None else setup_tags
    )
    entry, created = journal_repository.add_entry_if_new_external_id(
        {
            "source": source,
            "external_id": identifier,
            "lifecycle_id": f"lifecycle:{identifier}",
            "datetime": "2026-09-01T12:00:00+00:00",
            "entry_datetime": "2026-09-01T10:00:00+00:00",
            "symbol": "BTC/USDT",
            "timeframe": "4h",
            "direction": "Long",
            "size": 1.0,
            "entry_price": 100.0,
            "exit_price": 110.0,
            "pnl_pct": 10.0,
            "r_multiple": 2.0,
            "outcome": "Win",
            "emotion": "Disciplined",
            "emotion_before": "Calm",
            "emotion_during": "Focused",
            "emotion_after": "Satisfied",
            "confidence_score": 4,
            "focus_score": 5,
            "fomo": False,
            "revenge_trade": False,
            "tags": "exchange,position,reviewed",
            "mistakes": "Entered slightly early",
            "planned_stop_pct": 2.5,
            "planned_target_pct": 5.0,
            "planned_entry_reason": "Confirmed breakout close",
            "setup_tags": normalized_setup_tags,
            "mistake_tags": ["Early entry"],
            "plan_recorded_at": "2026-09-01T09:55:00+00:00",
            "notes": "User note",
            "exchange": "Binance",
            "order_id": f"order:{identifier}",
            "fee": 1.25,
            "fee_currency": "USDT",
            "funding_fee": -0.35,
            "realized_pnl": 10.0,
            "leverage": 3.0,
            "invested_amount": 100.0,
            "pnl_calculation_version": 2,
            "created_at": "2026-09-01T12:01:00+00:00",
        },
        db_path=db_path,
    )
    assert created
    return entry


def _count(db_path, table: str) -> int:
    with sqlite3.connect(db_path) as conn:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def _snapshot(db_path, tables):
    with sqlite3.connect(db_path) as conn:
        return {
            table: conn.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in tables
        }


REPRESENTATIVE_JOURNAL_COLUMNS = (
    "fee",
    "fee_currency",
    "funding_fee",
    "tags",
    "setup_tags",
    "mistake_tags",
    "notes",
    "emotion",
    "emotion_before",
    "emotion_during",
    "emotion_after",
    "confidence_score",
    "focus_score",
    "fomo",
    "revenge_trade",
    "planned_stop_pct",
    "planned_target_pct",
    "planned_entry_reason",
    "realized_pnl",
    "pnl_pct",
    "r_multiple",
    "datetime",
    "entry_datetime",
    "created_at",
    "plan_recorded_at",
)


def _raw_journal_values(db_path, journal_entry_id):
    with sqlite3.connect(db_path) as conn:
        return conn.execute(
            f"SELECT {', '.join(REPRESENTATIVE_JOURNAL_COLUMNS)} "
            f"FROM {journal_repository.TABLE_NAME} WHERE id = ?",
            (journal_entry_id,),
        ).fetchone()


class _ObservedConnection:
    """Delegate SQLite work while exposing deterministic BEGIN IMMEDIATE gates."""

    def __init__(self, connection, *, before_begin=None, after_begin=None):
        self._connection = connection
        self._before_begin = before_begin
        self._after_begin = after_begin

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return self._connection.__exit__(exc_type, exc_value, traceback)

    def __getattr__(self, name):
        return getattr(self._connection, name)

    def execute(self, statement, parameters=()):
        is_begin = str(statement).strip().upper() == "BEGIN IMMEDIATE"
        if is_begin and self._before_begin is not None:
            self._before_begin()
        result = self._connection.execute(statement, parameters)
        if is_begin and self._after_begin is not None:
            self._after_begin()
        return result


def _patch_assignment_begin(monkeypatch, *, before_begin=None, after_begin=None):
    original_connect = assignment_repository._connect

    def observed_connect(*args, **kwargs):
        return _ObservedConnection(
            original_connect(*args, **kwargs),
            before_begin=before_begin,
            after_begin=after_begin,
        )

    monkeypatch.setattr(assignment_repository, "_connect", observed_connect)


def _patch_assignment_connect_attempt(monkeypatch, attempting: Event):
    original_connect = assignment_repository._connect

    def observed_connect(*args, **kwargs):
        attempting.set()
        return original_connect(*args, **kwargs)

    monkeypatch.setattr(assignment_repository, "_connect", observed_connect)


def _delete_journal_in_transaction(db_path, journal_entry_id, attempting: Event):
    with sqlite3.connect(db_path, timeout=30) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        attempting.set()
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            f"DELETE FROM {journal_repository.TABLE_NAME} WHERE id = ?",
            (journal_entry_id,),
        )
        conn.commit()


def test_assignment_bootstrap_is_additive_idempotent_and_defines_integrity_schema(assignment_db):
    entry = _journal_entry(assignment_db, "binance:position:migration")
    strategy = _strategy(assignment_db)
    _new_version(assignment_db, strategy["id"])
    daily_repository.upsert_daily_journal(
        "2026-09-01", {"market_bias": "Bullish", "session_plan": "Wait"},
        db_path=assignment_db,
    )
    plan_repository.create_plan(
        {
            "exchange": "binance",
            "symbol": "BTC/USDT",
            "side": "Long",
            "client_created_at": None,
            "revision": {
                "entry_price": 100.0,
                "entry_min": None,
                "entry_max": None,
                "stop_loss": 95.0,
                "take_profit": 110.0,
                "take_profit_2": None,
                "setup": "breakout",
                "entry_note": "Wait",
                "exit_note": None,
                "memo": "Preserve",
                "max_hold_hours": None,
                "client_created_at": None,
            },
        },
        db_path=assignment_db,
    )
    execution_repository.add_executions_if_new(
        [{
            "external_id": "binance:fill:migration",
            "datetime": "2026-09-01T10:00:00+00:00",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "size": 1.0,
            "entry_price": 100.0,
            "source": "binance_fill",
            "exchange": "Binance",
        }],
        db_path=assignment_db,
    )
    existing_tables = (
        journal_repository.TABLE_NAME,
        journal_repository.DAILY_TABLE_NAME,
        strategy_repository.STRATEGY_TABLE,
        strategy_repository.VERSION_TABLE,
        plan_repository.PLAN_TABLE,
        plan_repository.REVISION_TABLE,
        execution_repository.TABLE_NAME,
    )
    before = _snapshot(assignment_db, existing_tables)
    representative_before = _raw_journal_values(assignment_db, entry["id"])

    assert representative_before is not None
    assert representative_before[0] == 1.25
    assert representative_before[2] == -0.35
    assert representative_before[3] == "exchange,position,reviewed"
    assert representative_before[4] == '["Breakout Momentum","High volume"]'
    assert representative_before[5] == '["Early entry"]'

    assignment_repository.initialize_schema(db_path=assignment_db)
    journal_repository.INITIALIZED_DATABASES.clear()
    assignment_repository.initialize_schema(db_path=assignment_db)

    assert _snapshot(assignment_db, existing_tables) == before
    assert _raw_journal_values(assignment_db, entry["id"]) == representative_before
    assert assignment_repository.get_assignment(entry["id"], db_path=assignment_db) is None
    with sqlite3.connect(assignment_db) as conn:
        columns = [row[1] for row in conn.execute(
            f"PRAGMA table_info({assignment_repository.ASSIGNMENT_TABLE})"
        )]
        foreign_keys = conn.execute(
            f"PRAGMA foreign_key_list({assignment_repository.ASSIGNMENT_TABLE})"
        ).fetchall()
        objects = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger')"
            )
        }

    assert columns == ["journal_entry_id", "strategy_version_id", "assigned_at", "updated_at"]
    assert {(row[2], row[3], row[6]) for row in foreign_keys} == {
        (strategy_repository.VERSION_TABLE, "strategy_version_id", "RESTRICT"),
        (journal_repository.TABLE_NAME, "journal_entry_id", "CASCADE"),
    }
    assert assignment_repository.ASSIGNMENT_VERSION_INDEX in objects
    assert "AFTER DELETE" in objects[assignment_repository.JOURNAL_DELETE_TRIGGER].upper()
    assert "BEFORE DELETE" in objects[assignment_repository.VERSION_DELETE_GUARD_TRIGGER].upper()


def test_api_create_replace_same_version_noop_get_and_delete(assignment_db, monkeypatch):
    entry = _journal_entry(assignment_db, "binance:position:api")
    strategy = _strategy(assignment_db)
    first_version_id = strategy["active_version_id"]
    second = _new_version(assignment_db, strategy["id"])
    timestamps = iter(("2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00"))
    monkeypatch.setattr(assignment_repository, "utc_now", lambda: next(timestamps))

    with TestClient(app) as client:
        empty = client.get(f"/api/journal/{entry['id']}/strategy-version")
        created = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": first_version_id},
        )
        unchanged = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": first_version_id},
        )
        replaced = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": second["id"]},
        )
        fetched = client.get(f"/api/journal/{entry['id']}/strategy-version")
        cleared = client.delete(f"/api/journal/{entry['id']}/strategy-version")
        cleared_again = client.delete(f"/api/journal/{entry['id']}/strategy-version")

    assert empty.status_code == 200 and empty.json() == {"success": True, "data": None}
    assert created.status_code == unchanged.status_code == replaced.status_code == 200
    assert created.json()["data"]["assigned_at"] == created.json()["data"]["updated_at"]
    assert unchanged.json()["data"] == created.json()["data"]
    assert replaced.json()["data"]["strategy_version_id"] == second["id"]
    assert replaced.json()["data"]["strategy_id"] == strategy["id"]
    assert replaced.json()["data"]["strategy_name"] == strategy["name"]
    assert replaced.json()["data"]["assigned_at"] == "2026-09-02T00:00:00+00:00"
    assert fetched.json()["data"] == replaced.json()["data"]
    assert cleared.json() == cleared_again.json() == {"success": True, "data": None}


def test_api_not_found_validation_and_envelope_semantics(assignment_db):
    entry = _journal_entry(assignment_db, "binance:position:errors")
    strategy = _strategy(assignment_db)
    with TestClient(app) as client:
        get_missing = client.get("/api/journal/999/strategy-version")
        put_missing_journal = client.put(
            "/api/journal/999/strategy-version",
            json={"strategy_version_id": strategy["active_version_id"]},
        )
        put_missing_version = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": 999999},
        )
        invalid = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": 0, "strategy_id": strategy["id"]},
        )
        delete_missing = client.delete("/api/journal/999/strategy-version")
        delete_unassigned = client.delete(
            f"/api/journal/{entry['id']}/strategy-version"
        )

    assert get_missing.status_code == put_missing_journal.status_code == 404
    assert put_missing_version.status_code == delete_missing.status_code == 404
    assert invalid.status_code == 422
    assert delete_unassigned.status_code == 200
    assert delete_unassigned.json() == {"success": True, "data": None}
    assert get_missing.json()["error_code"] == "NOT_FOUND"


def test_unexpected_integrity_error_is_not_reported_as_assignment_conflict(
    assignment_db, monkeypatch,
):
    entry = _journal_entry(assignment_db, "binance:position:unexpected-integrity")
    strategy = _strategy(assignment_db, "Unexpected Integrity")

    def fail_unexpectedly(*_args, **_kwargs):
        raise sqlite3.IntegrityError("artificial unexpected integrity failure")

    monkeypatch.setattr(assignment_repository, "put_assignment", fail_unexpectedly)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.put(
            f"/api/journal/{entry['id']}/strategy-version",
            json={"strategy_version_id": strategy["active_version_id"]},
        )

    assert response.status_code == 500
    assert response.json()["error_code"] == "INTERNAL_ERROR"
    assert response.json().get("error_code") != "ASSIGNMENT_CONFLICT"


def test_retired_inactive_and_archived_versions_remain_valid_historical_targets(assignment_db):
    entry = _journal_entry(assignment_db, "binance:position:history")
    strategy = _strategy(assignment_db)
    assigned_version_id = strategy["active_version_id"]
    replacement_active = _new_version(assignment_db, strategy["id"])
    assigned = assignment_repository.put_assignment(
        entry["id"], assigned_version_id, db_path=assignment_db
    )
    stable_times = (assigned["assigned_at"], assigned["updated_at"])

    strategy_repository.activate_version(
        strategy["id"], replacement_active["id"], db_path=assignment_db
    )
    strategy_repository.retire_version(
        strategy["id"], assigned_version_id, db_path=assignment_db
    )
    strategy_repository.set_strategy_archived(strategy["id"], True, db_path=assignment_db)
    archived = assignment_repository.put_assignment(
        entry["id"], assigned_version_id, db_path=assignment_db
    )
    strategy_repository.set_strategy_archived(strategy["id"], False, db_path=assignment_db)
    restored = assignment_repository.get_assignment(entry["id"], db_path=assignment_db)

    assert archived["strategy_version_id"] == assigned_version_id
    assert archived["version_is_active"] is False
    assert archived["version_retired_at"] is not None
    assert archived["strategy_archived_at"] is not None
    assert (archived["assigned_at"], archived["updated_at"]) == stable_times
    assert restored is not None
    assert restored["strategy_version_id"] == assigned_version_id
    assert (restored["assigned_at"], restored["updated_at"]) == stable_times


def test_exchange_refresh_preserves_assignment_and_timestamps(assignment_db):
    entry = _journal_entry(assignment_db, "binance:position:refresh")
    strategy = _strategy(assignment_db, "Refresh Strategy")
    before = assignment_repository.put_assignment(
        entry["id"], strategy["active_version_id"], db_path=assignment_db
    )

    updated = journal_repository.update_imported_entry_by_external_id(
        {
            "external_id": entry["external_id"],
            "datetime": "2026-09-01T13:00:00+00:00",
            "entry_datetime": entry["entry_datetime"],
            "symbol": entry["symbol"],
            "timeframe": entry["timeframe"],
            "direction": entry["direction"],
            "size": entry["size"],
            "entry_price": entry["entry_price"],
            "exit_price": 112.0,
            "pnl_pct": 12.0,
            "outcome": "Win",
            "tags": entry["tags"],
            "exchange": entry["exchange"],
            "order_id": entry["order_id"],
            "fee": entry["fee"],
            "fee_currency": entry["fee_currency"],
            "funding_fee": entry["funding_fee"],
            "realized_pnl": 12.0,
            "leverage": entry["leverage"],
            "invested_amount": entry["invested_amount"],
            "pnl_calculation_version": 2,
            "lifecycle_id": entry["lifecycle_id"],
        },
        db_path=assignment_db,
    )
    after = assignment_repository.get_assignment(entry["id"], db_path=assignment_db)

    assert updated is not None and updated["exit_price"] == 112.0
    assert after is not None
    assert after["strategy_version_id"] == before["strategy_version_id"]
    assert (after["assigned_at"], after["updated_at"]) == (
        before["assigned_at"], before["updated_at"]
    )


def test_actual_production_sync_preserves_assignment_and_never_deletes(
    assignment_db, monkeypatch,
):
    class FakeClient:
        id = "okx"
        name = "OKX"
        apiKey = "assignment-sync-account"
        options = {"defaultType": "spot"}
        markets = {
            "BTC/USDT": {
                "base": "BTC",
                "quote": "USDT",
                "contractSize": 1.0,
            }
        }

        def load_markets(self):
            return self.markets

        def close(self):
            return None

    raw_trades = [
        {
            "id": "assignment-open",
            "timestamp": 1_700_000_000_000,
            "symbol": "BTC/USDT",
            "side": "buy",
            "amount": 1.0,
            "price": 100.0,
            "order": "assignment-order-open",
            "fee": {"cost": 0.1, "currency": "USDT"},
        },
        {
            "id": "assignment-close",
            "timestamp": 1_700_003_600_000,
            "symbol": "BTC/USDT",
            "side": "sell",
            "amount": 1.0,
            "price": 110.0,
            "order": "assignment-order-close",
            "fee": {"cost": 0.1, "currency": "USDT"},
        },
    ]

    def forbidden_delete(*_args, **_kwargs):
        raise AssertionError("Production sync must not delete imported positions")

    monkeypatch.setattr(execution_repository, "JOURNAL_DB_PATH", assignment_db)
    monkeypatch.setattr(
        sync_service,
        "fetch_trades",
        lambda *_args, **_kwargs: TradeFetchResult(raw_trades, []),
    )
    monkeypatch.setattr(sync_service, "build_indicator_snapshots", lambda *_args: {})
    monkeypatch.setattr(journal_repository, "delete_imported_positions", forbidden_delete)
    monkeypatch.setattr(
        sync_service, "delete_imported_positions", forbidden_delete, raising=False
    )

    created = sync_service.sync_ccxt(
        "okx", "SPOT", 30, ["BTC/USDT"], FakeClient()
    )
    assert created["data"]["positions_imported"] == 1
    journal_entry = next(
        entry
        for entry in journal_repository.list_entries(db_path=assignment_db)
        if entry["source"] == "okx_position"
    )
    strategy = _strategy(assignment_db, "Production Sync")
    before = assignment_repository.put_assignment(
        journal_entry["id"], strategy["active_version_id"], db_path=assignment_db
    )

    refreshed = sync_service.sync_ccxt(
        "okx", "SPOT", 30, ["BTC/USDT"], FakeClient()
    )
    after = assignment_repository.get_assignment(
        journal_entry["id"], db_path=assignment_db
    )

    assert refreshed["data"]["positions_updated"] == 1
    assert after is not None
    assert after["strategy_version_id"] == before["strategy_version_id"]
    assert (after["assigned_at"], after["updated_at"]) == (
        before["assigned_at"], before["updated_at"]
    )


def test_setup_tags_never_infer_assignment(assignment_db):
    entry = _journal_entry(
        assignment_db,
        "binance:position:tags",
        setup_tags=["Breakout Momentum", "v1.0"],
    )
    _strategy(assignment_db)
    assignment_repository.initialize_schema(db_path=assignment_db)

    assert assignment_repository.get_assignment(entry["id"], db_path=assignment_db) is None
    assert _count(assignment_db, assignment_repository.ASSIGNMENT_TABLE) == 0


def test_all_real_journal_delete_paths_remove_assignments(assignment_db):
    strategy = _strategy(assignment_db, "Delete Paths")
    version_id = strategy["active_version_id"]

    direct = _journal_entry(assignment_db, "binance:position:direct")
    assignment_repository.put_assignment(direct["id"], version_id, db_path=assignment_db)
    assert journal_repository.delete_entry(direct["id"], db_path=assignment_db)

    bulk = _journal_entry(assignment_db, "binance:position:bulk")
    assignment_repository.put_assignment(bulk["id"], version_id, db_path=assignment_db)
    assert journal_repository.delete_imported_positions(
        "binance", "Binance", ["BTC/USDT"]
    ) >= 1

    legacy = _journal_entry(assignment_db, "binance:fill:legacy", source="manual")
    assignment_repository.put_assignment(legacy["id"], version_id, db_path=assignment_db)
    with sqlite3.connect(assignment_db) as conn:
        conn.execute(
            f"UPDATE {journal_repository.TABLE_NAME} SET source = 'binance_fill' WHERE id = ?",
            (legacy["id"],),
        )
        conn.commit()
    execution_repository.list_executions(db_path=assignment_db)

    with sqlite3.connect(assignment_db) as conn:
        remaining_journals = conn.execute(
            f"SELECT id FROM {journal_repository.TABLE_NAME} WHERE id IN (?, ?, ?)",
            (direct["id"], bulk["id"], legacy["id"]),
        ).fetchall()
        remaining_assignments = conn.execute(
            f"SELECT journal_entry_id FROM {assignment_repository.ASSIGNMENT_TABLE}"
        ).fetchall()
        migrated = conn.execute(
            f"SELECT 1 FROM {execution_repository.TABLE_NAME} WHERE external_id = ?",
            (legacy["external_id"],),
        ).fetchone()

    assert remaining_journals == []
    assert remaining_assignments == []
    assert migrated is not None


def test_cleanup_and_version_guard_triggers_work_with_foreign_keys_off(assignment_db):
    first_entry = _journal_entry(assignment_db, "binance:position:fk-off-delete")
    second_entry = _journal_entry(assignment_db, "binance:position:fk-off-guard")
    strategy = _strategy(assignment_db, "FK Off")
    version_id = strategy["active_version_id"]
    assignment_repository.put_assignment(first_entry["id"], version_id, db_path=assignment_db)
    assignment_repository.put_assignment(second_entry["id"], version_id, db_path=assignment_db)

    with sqlite3.connect(assignment_db) as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 0
        conn.execute(
            f"DELETE FROM {journal_repository.TABLE_NAME} WHERE id = ?",
            (first_entry["id"],),
        )
        with pytest.raises(sqlite3.IntegrityError, match="Assigned StrategyVersion"):
            conn.execute(
                f"DELETE FROM {strategy_repository.VERSION_TABLE} WHERE id = ?",
                (version_id,),
            )
        conn.commit()

    assert assignment_repository.get_assignment(
        second_entry["id"], db_path=assignment_db
    ) is not None
    with sqlite3.connect(assignment_db) as conn:
        assert conn.execute(
            f"SELECT 1 FROM {assignment_repository.ASSIGNMENT_TABLE} WHERE journal_entry_id = ?",
            (first_entry["id"],),
        ).fetchone() is None
        assert conn.execute(
            f"SELECT 1 FROM {strategy_repository.VERSION_TABLE} WHERE id = ?",
            (version_id,),
        ).fetchone() is not None


@pytest.mark.parametrize("reverse_order", [False, True])
def test_two_public_puts_are_serialized_and_last_writer_wins(
    assignment_db, monkeypatch, reverse_order,
):
    entry = _journal_entry(assignment_db, "binance:position:concurrent-put")
    strategy = _strategy(assignment_db, "Concurrent PUT")
    version_ids = [
        strategy["active_version_id"],
        _new_version(assignment_db, strategy["id"])["id"],
    ]
    if reverse_order:
        version_ids.reverse()
    first_version_id, second_version_id = version_ids
    writer_state = local()
    first_acquired = Event()
    release_first = Event()
    second_attempting = Event()
    original_put = assignment_repository.put_assignment

    def tagged_put(journal_entry_id, strategy_version_id, **kwargs):
        writer_state.label = (
            "first" if strategy_version_id == first_version_id else "second"
        )
        if writer_state.label == "second":
            second_attempting.set()
        try:
            return original_put(journal_entry_id, strategy_version_id, **kwargs)
        finally:
            del writer_state.label

    def after_begin():
        if getattr(writer_state, "label", None) == "first":
            first_acquired.set()
            if not release_first.wait(timeout=5):
                raise AssertionError("First public PUT was not released")

    monkeypatch.setattr(assignment_repository, "put_assignment", tagged_put)
    _patch_assignment_begin(monkeypatch, after_begin=after_begin)

    url = f"/api/journal/{entry['id']}/strategy-version"
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(
            client.put, url, json={"strategy_version_id": first_version_id}
        )
        assert first_acquired.wait(timeout=5)
        second_future = executor.submit(
            client.put, url, json={"strategy_version_id": second_version_id}
        )
        try:
            assert second_attempting.wait(timeout=5)
        finally:
            release_first.set()
        first_response = first_future.result(timeout=10)
        second_response = second_future.result(timeout=10)

    assert first_response.status_code == second_response.status_code == 200
    final_assignment = assignment_repository.get_assignment(
        entry["id"], db_path=assignment_db
    )
    assert final_assignment is not None
    assert final_assignment["strategy_version_id"] == second_version_id
    assert final_assignment["assigned_at"] == final_assignment["updated_at"]
    assert _count(assignment_db, assignment_repository.ASSIGNMENT_TABLE) == 1


def test_public_put_and_journal_delete_have_deterministic_safe_orders(
    assignment_db, monkeypatch,
):
    strategy = _strategy(assignment_db, "Delete Race")
    version_id = strategy["active_version_id"]
    deleted_first = _journal_entry(assignment_db, "binance:position:delete-first")

    with TestClient(app) as client:
        journal_lock = sqlite3.connect(assignment_db, timeout=30)
        journal_lock.execute("PRAGMA busy_timeout = 30000")
        journal_lock.execute("BEGIN IMMEDIATE")
        journal_lock.execute(
            f"DELETE FROM {journal_repository.TABLE_NAME} WHERE id = ?",
            (deleted_first["id"],),
        )
        put_attempting = Event()
        with monkeypatch.context() as patch:
            _patch_assignment_connect_attempt(patch, put_attempting)
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    client.put,
                    f"/api/journal/{deleted_first['id']}/strategy-version",
                    json={"strategy_version_id": version_id},
                )
                assert put_attempting.wait(timeout=5)
                journal_lock.commit()
                journal_lock.close()
                deleted_first_response = future.result(timeout=10)

        put_first = _journal_entry(assignment_db, "binance:position:put-first")
        put_acquired = Event()
        release_put = Event()
        journal_attempting = Event()

        def hold_put_after_begin():
            put_acquired.set()
            if not release_put.wait(timeout=5):
                raise AssertionError("Public PUT was not released")

        with monkeypatch.context() as patch:
            _patch_assignment_begin(patch, after_begin=hold_put_after_begin)
            with ThreadPoolExecutor(max_workers=2) as executor:
                put_future = executor.submit(
                    client.put,
                    f"/api/journal/{put_first['id']}/strategy-version",
                    json={"strategy_version_id": version_id},
                )
                assert put_acquired.wait(timeout=5)
                journal_future = executor.submit(
                    _delete_journal_in_transaction,
                    assignment_db,
                    put_first["id"],
                    journal_attempting,
                )
                try:
                    assert journal_attempting.wait(timeout=5)
                finally:
                    release_put.set()
                put_first_response = put_future.result(timeout=10)
                journal_future.result(timeout=10)

    assert deleted_first_response.status_code == 404
    assert put_first_response.status_code == 200
    assert _count(assignment_db, assignment_repository.ASSIGNMENT_TABLE) == 0


def test_public_assignment_delete_and_journal_delete_have_deterministic_safe_orders(
    assignment_db, monkeypatch,
):
    strategy = _strategy(assignment_db, "Assignment Delete Race")
    version_id = strategy["active_version_id"]
    assignment_first = _journal_entry(
        assignment_db, "binance:position:assignment-delete-first"
    )
    assignment_repository.put_assignment(
        assignment_first["id"], version_id, db_path=assignment_db
    )

    with TestClient(app) as client:
        assignment_delete_acquired = Event()
        release_assignment_delete = Event()
        journal_attempting = Event()

        def hold_assignment_delete_after_begin():
            assignment_delete_acquired.set()
            if not release_assignment_delete.wait(timeout=5):
                raise AssertionError("Public Assignment DELETE was not released")

        with monkeypatch.context() as patch:
            _patch_assignment_begin(
                patch, after_begin=hold_assignment_delete_after_begin
            )
            with ThreadPoolExecutor(max_workers=2) as executor:
                assignment_future = executor.submit(
                    client.delete,
                    f"/api/journal/{assignment_first['id']}/strategy-version",
                )
                assert assignment_delete_acquired.wait(timeout=5)
                journal_future = executor.submit(
                    _delete_journal_in_transaction,
                    assignment_db,
                    assignment_first["id"],
                    journal_attempting,
                )
                try:
                    assert journal_attempting.wait(timeout=5)
                finally:
                    release_assignment_delete.set()
                assignment_first_response = assignment_future.result(timeout=10)
                journal_future.result(timeout=10)

        journal_first = _journal_entry(
            assignment_db, "binance:position:journal-delete-first"
        )
        assignment_repository.put_assignment(
            journal_first["id"], version_id, db_path=assignment_db
        )
        journal_lock = sqlite3.connect(assignment_db, timeout=30)
        journal_lock.execute("PRAGMA busy_timeout = 30000")
        journal_lock.execute("BEGIN IMMEDIATE")
        journal_lock.execute(
            f"DELETE FROM {journal_repository.TABLE_NAME} WHERE id = ?",
            (journal_first["id"],),
        )
        assignment_delete_attempting = Event()
        with monkeypatch.context() as patch:
            _patch_assignment_connect_attempt(patch, assignment_delete_attempting)
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    client.delete,
                    f"/api/journal/{journal_first['id']}/strategy-version",
                )
                assert assignment_delete_attempting.wait(timeout=5)
                journal_lock.commit()
                journal_lock.close()
                journal_first_response = future.result(timeout=10)

    assert assignment_first_response.status_code == 200
    assert journal_first_response.status_code == 404
    assert _count(assignment_db, assignment_repository.ASSIGNMENT_TABLE) == 0
