import sqlite3

import pytest
from pydantic import ValidationError

from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository
from backend.modules.plan_lab.schemas import InTradePlanCreate, PlanRevisionInput, RetrospectivePlanCreate


def _revision(entry_price=100.0):
    return {
        "entry_price": entry_price,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 98.0,
        "take_profit": 104.0,
        "take_profit_2": None,
        "setup": "pullback",
        "entry_note": None,
        "exit_note": None,
        "memo": None,
        "client_created_at": "1999-01-01T00:00:00Z",
    }


def _plan_payload():
    return {
        "exchange": "binance",
        "symbol": "BTC/USDT",
        "side": "Long",
        "client_created_at": "1999-01-01T00:00:00Z",
        "revision": _revision(),
    }


def _retrospective_payload():
    revision = _revision(None)
    return {
        "exchange": "binance",
        "symbol": "BTC/USDT",
        "side": "Long",
        "revision": revision,
    }


def _closed_entry(db_path, external_id="binance:position:retrospective"):
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": external_id,
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2026-01-01T10:00:00+00:00",
            "datetime": "2026-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    return entry


def _table_counts(db_path):
    with sqlite3.connect(db_path) as conn:
        return tuple(
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (repository.PLAN_TABLE, repository.REVISION_TABLE, repository.LINK_TABLE)
        )


def test_retrospective_schema_allows_missing_plan_entry_only():
    retrospective = RetrospectivePlanCreate.model_validate({
        "journal_entry_id": 1,
        "revision": _revision(None),
    })

    assert retrospective.revision.entry_price is None
    with pytest.raises(ValidationError, match="Retrospective plan entry must be empty"):
        RetrospectivePlanCreate.model_validate({
            "journal_entry_id": 1,
            "revision": _revision(100.0),
        })
    with pytest.raises(ValidationError, match="Plan entry is required"):
        PlanRevisionInput.model_validate(_revision(None))


def test_secondary_target_is_optional_and_uses_primary_target_validation():
    assert PlanRevisionInput.model_validate(_revision()).take_profit_2 is None
    assert PlanRevisionInput.model_validate({**_revision(), "take_profit_2": 108.0}).take_profit_2 == 108.0
    with pytest.raises(ValidationError):
        PlanRevisionInput.model_validate({**_revision(), "take_profit_2": 0})


def _live_position(position_id="deepcoin-live-1"):
    return {
        "exchange": "deepcoin",
        "position_id": position_id,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "average_price": 100.0,
        "last_price": 101.0,
        "opened_at": "2026-01-01T10:00:00+00:00",
    }


def test_in_trade_plan_never_persists_actual_entry_as_user_plan(tmp_path):
    db_path = tmp_path / "journal.db"
    position = _live_position()
    payload = {
        "exchange": "deepcoin",
        "position_id": position["position_id"],
        "symbol": position["symbol"],
        "side": position["direction"],
        "revision": _revision(None),
    }

    created = repository.create_in_trade_plan(payload, position, db_path=db_path)
    annotated = repository.annotate_revisions(
        created, position["opened_at"], "2026-01-01T12:00:00+00:00",
    )

    assert created["source"] == "IN_TRADE"
    assert created["live_position_id"] == position["position_id"]
    assert created["latest_revision"]["entry_price"] is None
    assert annotated["plan_effective_at_entry"] is None
    assert InTradePlanCreate.model_validate({
        "exchange": "deepcoin", "position_id": position["position_id"], "revision": _revision(None),
    }).revision.entry_price is None


def test_in_trade_plan_reuses_same_open_position_and_requires_a_match(tmp_path):
    db_path = tmp_path / "journal.db"
    position = _live_position()
    payload = {
        "exchange": "deepcoin", "position_id": position["position_id"],
        "symbol": position["symbol"], "side": position["direction"], "revision": _revision(None),
    }
    first = repository.create_in_trade_plan(payload, position, db_path=db_path)
    duplicate = repository.create_in_trade_plan(payload, position, db_path=db_path)

    assert duplicate["id"] == first["id"]
    assert _table_counts(db_path) == (1, 1, 0)
    with pytest.raises(ValueError, match="does not match"):
        repository.create_in_trade_plan({**payload, "position_id": "other"}, position, db_path=db_path)


def test_deepcoin_in_trade_plan_links_after_a_stable_closed_position_sync(tmp_path):
    db_path = tmp_path / "journal.db"
    position = _live_position("stable-live")
    payload = {
        "exchange": "deepcoin", "position_id": position["position_id"],
        "symbol": position["symbol"], "side": position["direction"], "revision": _revision(None),
    }
    plan = repository.create_in_trade_plan(payload, position, db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "deepcoin:position:stable-live", "exchange": "deepcoin",
            "source": "deepcoin_position", "symbol": "BTC/USDT", "direction": "Long",
            "entry_datetime": position["opened_at"], "datetime": "2026-01-01T12:00:00+00:00",
            "entry_price": 100.0, "exit_price": 104.0,
        }, db_path=db_path,
    )

    repository.reconcile_links(db_path=db_path)
    linked = repository.get_plan(plan["id"], db_path=db_path)

    assert linked["source"] == "IN_TRADE"
    assert linked["status"] == "linked"
    assert linked["link"]["journal_entry_id"] == entry["id"]


def test_secondary_target_persists_across_create_and_immutable_revisions(tmp_path):
    db_path = tmp_path / "journal.db"
    payload = _plan_payload()
    payload["revision"]["take_profit_2"] = 108.0

    created = repository.create_plan(payload, db_path=db_path)
    updated = repository.add_revision(
        created["id"], {**_revision(101.0), "take_profit_2": 110.0}, db_path=db_path,
    )

    assert [item["take_profit_2"] for item in updated["revisions"]] == [108.0, 110.0]
    assert updated["latest_revision"]["take_profit_2"] == 110.0


def test_split_target_order_is_validated_for_long_short_and_retrospective(tmp_path):
    db_path = tmp_path / "journal.db"
    invalid_long = _plan_payload()
    invalid_long["revision"]["take_profit_2"] = 103.0
    with pytest.raises(ValueError, match="SL < Entry < TP1 < TP2"):
        repository.create_plan(invalid_long, db_path=db_path)

    short_payload = _plan_payload()
    short_payload["side"] = "Short"
    short_payload["revision"] = {
        **_revision(), "stop_loss": 102.0, "take_profit": 98.0, "take_profit_2": 94.0,
    }
    short_plan = repository.create_plan(short_payload, db_path=db_path)
    assert short_plan["latest_revision"]["take_profit_2"] == 94.0

    entry = _closed_entry(db_path, external_id="binance:position:split-order")
    bad_retrospective = _retrospective_payload()
    bad_retrospective["revision"]["take_profit_2"] = 103.0
    with pytest.raises(ValueError, match="SL < Entry < TP1 < TP2"):
        repository.create_retrospective_plan(bad_retrospective, entry["id"], db_path=db_path)


def test_secondary_target_migrates_existing_tp1_only_rows_to_null(tmp_path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE trading_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT NOT NULL, symbol TEXT NOT NULL, symbol_key TEXT NOT NULL,
                side TEXT NOT NULL, status TEXT NOT NULL, client_created_at TEXT,
                received_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE trading_plan_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL, version INTEGER NOT NULL,
                entry_price REAL, entry_min REAL, entry_max REAL,
                stop_loss REAL NOT NULL, take_profit REAL NOT NULL,
                setup TEXT, entry_note TEXT, exit_note TEXT, memo TEXT,
                client_created_at TEXT, received_at TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(plan_id, version)
            );
        """)
        conn.execute(
            """INSERT INTO trading_plans
            (exchange, symbol, symbol_key, side, status, client_created_at, received_at, created_at, updated_at)
            VALUES ('binance', 'BTC/USDT', 'BTCUSDT', 'Long', 'active', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"""
        )
        conn.execute(
            """INSERT INTO trading_plan_revisions
            (plan_id, version, entry_price, entry_min, entry_max, stop_loss, take_profit, setup, entry_note, exit_note, memo, client_created_at, received_at, created_at)
            VALUES (1, 1, 100, NULL, NULL, 98, 104, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"""
        )

    migrated = repository.get_plan(1, db_path=db_path)

    assert migrated["latest_revision"]["take_profit"] == 104.0
    assert migrated["latest_revision"]["take_profit_2"] is None
    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(trading_plan_revisions)")}
    assert {"max_hold_hours", "take_profit_2"}.issubset(columns)


def test_secondary_target_is_present_on_fresh_database_when_omitted(tmp_path):
    plan = repository.create_plan(_plan_payload(), db_path=tmp_path / "journal.db")

    assert plan["latest_revision"]["take_profit_2"] is None


def test_retrospective_save_is_atomic_and_keeps_planned_entry_empty(tmp_path):
    db_path = tmp_path / "journal.db"
    entry = _closed_entry(db_path)
    payload = _retrospective_payload()
    payload["revision"]["take_profit_2"] = 108.0

    plan = repository.create_retrospective_plan(
        payload, entry["id"], db_path=db_path,
    )

    assert _table_counts(db_path) == (1, 1, 1)
    assert plan["source"] == "RETROSPECTIVE"
    assert plan["link"]["journal_entry_id"] == entry["id"]
    assert plan["latest_revision"]["entry_price"] is None
    assert plan["latest_revision"]["take_profit_2"] == 108.0


def test_retrospective_duplicate_link_does_not_leave_orphans(tmp_path):
    db_path = tmp_path / "journal.db"
    entry = _closed_entry(db_path)
    first = repository.create_retrospective_plan(
        _retrospective_payload(), entry["id"], db_path=db_path,
    )
    before = _table_counts(db_path)

    with pytest.raises(ValueError, match="already linked"):
        repository.create_retrospective_plan(
            {**_retrospective_payload(), "revision": {**_revision(None), "take_profit_2": 108.0}}, entry["id"], db_path=db_path,
        )

    assert _table_counts(db_path) == before == (1, 1, 1)
    assert repository.get_plan(first["id"], db_path=db_path)["link"]["journal_entry_id"] == entry["id"]


def test_retrospective_link_failure_rolls_back_plan_and_revision(tmp_path, monkeypatch):
    db_path = tmp_path / "journal.db"
    entry = _closed_entry(db_path)

    def fail_link(*_args, **_kwargs):
        raise RuntimeError("injected link failure")

    monkeypatch.setattr(repository, "_insert_link_row", fail_link)
    with pytest.raises(RuntimeError, match="injected link failure"):
        repository.create_retrospective_plan(
            {**_retrospective_payload(), "revision": {**_revision(None), "take_profit_2": 108.0}}, entry["id"], db_path=db_path,
        )

    assert _table_counts(db_path) == (0, 0, 0)


def test_server_received_time_controls_official_revision(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    repository.add_revision(plan["id"], _revision(101.0), db_path=db_path)
    repository.add_revision(plan["id"], _revision(102.0), db_path=db_path)

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE trading_plan_revisions SET received_at=? WHERE plan_id=? AND version=1",
            ("2026-01-01T09:00:00+00:00", plan["id"]),
        )
        conn.execute(
            "UPDATE trading_plan_revisions SET received_at=? WHERE plan_id=? AND version=2",
            ("2026-01-01T09:30:00+00:00", plan["id"]),
        )
        conn.execute(
            "UPDATE trading_plan_revisions SET received_at=? WHERE plan_id=? AND version=3",
            ("2026-01-01T11:30:00+00:00", plan["id"]),
        )

    annotated = repository.annotate_revisions(
        repository.get_plan(plan["id"], db_path=db_path),
        "2026-01-01T10:00:00+00:00",
        "2026-01-01T11:00:00+00:00",
    )

    assert annotated["plan_initial"]["version"] == 1
    assert annotated["plan_effective_at_entry"]["version"] == 2
    assert [item["phase"] for item in annotated["revisions"]] == [
        "PRE_TRADE",
        "PRE_TRADE",
        "POST_TRADE_INPUT",
    ]
    assert annotated["plan_effective_at_entry"]["client_created_at"] == "1999-01-01T00:00:00Z"


def test_trade_link_repairs_internal_id_from_external_id(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:stable-1",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2026-01-01T10:00:00+00:00",
            "datetime": "2026-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    linked = repository.link_plan(plan["id"], entry["id"], db_path=db_path)
    assert linked["link"]["journal_external_id"] == "binance:position:stable-1"

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE trading_plan_links SET journal_entry_id=? WHERE plan_id=?",
            (entry["id"] + 999, plan["id"]),
        )

    repository.reconcile_links(db_path=db_path)
    repaired = repository.get_plan(plan["id"], db_path=db_path)
    assert repaired["link"]["journal_entry_id"] == entry["id"]
    assert repaired["link"]["link_status"] == "LINKED"

    second_plan = repository.create_plan(_plan_payload(), db_path=db_path)
    with pytest.raises(ValueError, match="already linked"):
        repository.link_plan(second_plan["id"], entry["id"], db_path=db_path)


def test_plan_link_is_idempotent_but_cannot_move_to_another_trade(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    first, _ = journal_repository.add_entry_if_new_external_id({
        "external_id": "binance:position:first",
        "exchange": "binance", "source": "binance_position", "symbol": "BTC/USDT", "direction": "Long",
        "entry_datetime": "2099-01-01T10:00:00+00:00", "datetime": "2099-01-01T11:00:00+00:00",
        "entry_price": 100.0, "exit_price": 104.0,
    }, db_path=db_path)
    second, _ = journal_repository.add_entry_if_new_external_id({
        "external_id": "binance:position:second",
        "exchange": "binance", "source": "binance_position", "symbol": "BTC/USDT", "direction": "Long",
        "entry_datetime": "2099-01-02T10:00:00+00:00", "datetime": "2099-01-02T11:00:00+00:00",
        "entry_price": 100.0, "exit_price": 104.0,
    }, db_path=db_path)

    linked = repository.link_plan(plan["id"], first["id"], db_path=db_path)
    idempotent = repository.link_plan(plan["id"], first["id"], db_path=db_path)
    with pytest.raises(ValueError, match="different trade"):
        repository.link_plan(plan["id"], second["id"], db_path=db_path)
    stored = repository.get_plan(plan["id"], db_path=db_path)

    assert idempotent["link"] == linked["link"]
    assert stored["link"]["journal_entry_id"] == first["id"]
    assert stored["link"]["journal_external_id"] == "binance:position:first"
    assert stored["source"] == linked["source"] == "VERIFIED_PRETRADE"


def test_verified_pretrade_requires_server_receipt_before_actual_entry(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:future",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2099-01-01T10:00:00+00:00",
            "datetime": "2099-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    linked = repository.link_plan(plan["id"], entry["id"], db_path=db_path)
    assert linked["source"] == "VERIFIED_PRETRADE"


def test_spoofed_client_time_cannot_make_retrospective_plan_verified(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:past",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2020-01-01T10:00:00+00:00",
            "datetime": "2020-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    linked = repository.link_plan(plan["id"], entry["id"], db_path=db_path)
    assert linked["source"] == "RETROSPECTIVE"
    annotated = repository.annotate_revisions(linked, entry["entry_datetime"], entry["datetime"])
    assert annotated["plan_effective_at_entry"]["version"] == 1
    assert annotated["plan_effective_at_entry"]["client_created_at"] == "1999-01-01T00:00:00Z"


def test_server_receipt_equal_to_entry_is_not_verified(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:equal-time",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2026-01-01T10:00:00+00:00",
            "datetime": "2026-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE trading_plan_revisions SET received_at=? WHERE plan_id=?",
            ("2026-01-01T10:00:00+00:00", plan["id"]),
        )

    linked = repository.link_plan(plan["id"], entry["id"], db_path=db_path)
    assert linked["source"] == "RETROSPECTIVE"


def test_reconcile_reclassifies_legacy_link_from_server_time(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    entry, _ = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:legacy-source",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": "2099-01-01T10:00:00+00:00",
            "datetime": "2099-01-01T11:00:00+00:00",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )
    repository.link_plan(plan["id"], entry["id"], db_path=db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE trading_plans SET source='UNLINKED' WHERE id=?", (plan["id"],))

    repository.reconcile_links(db_path=db_path)

    assert repository.get_plan(plan["id"], db_path=db_path)["source"] == "VERIFIED_PRETRADE"


def test_setup_text_is_preserved_in_immutable_revisions(tmp_path):
    db_path = tmp_path / "journal.db"
    plan = repository.create_plan(_plan_payload(), db_path=db_path)
    renamed = _revision(101.0)
    renamed["setup"] = "renamed pullback"
    repository.add_revision(plan["id"], renamed, db_path=db_path)

    stored = repository.get_plan(plan["id"], db_path=db_path)

    assert [revision["setup"] for revision in stored["revisions"]] == [
        "pullback",
        "renamed pullback",
    ]
