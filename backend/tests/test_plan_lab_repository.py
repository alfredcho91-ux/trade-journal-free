import sqlite3

import pytest
from pydantic import ValidationError

from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository
from backend.modules.plan_lab.schemas import PlanRevisionInput, RetrospectivePlanCreate


def _revision(entry_price=100.0):
    return {
        "entry_price": entry_price,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 98.0,
        "take_profit": 104.0,
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


def test_retrospective_save_is_atomic_and_keeps_planned_entry_empty(tmp_path):
    db_path = tmp_path / "journal.db"
    entry = _closed_entry(db_path)

    plan = repository.create_retrospective_plan(
        _retrospective_payload(), entry["id"], db_path=db_path,
    )

    assert _table_counts(db_path) == (1, 1, 1)
    assert plan["source"] == "RETROSPECTIVE"
    assert plan["link"]["journal_entry_id"] == entry["id"]
    assert plan["latest_revision"]["entry_price"] is None


def test_retrospective_duplicate_link_does_not_leave_orphans(tmp_path):
    db_path = tmp_path / "journal.db"
    entry = _closed_entry(db_path)
    first = repository.create_retrospective_plan(
        _retrospective_payload(), entry["id"], db_path=db_path,
    )
    before = _table_counts(db_path)

    with pytest.raises(ValueError, match="already linked"):
        repository.create_retrospective_plan(
            _retrospective_payload(), entry["id"], db_path=db_path,
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
            _retrospective_payload(), entry["id"], db_path=db_path,
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
