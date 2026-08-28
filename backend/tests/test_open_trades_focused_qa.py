"""Focused lifecycle QA for live positions and in-trade plans."""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from fastapi import HTTPException

from backend.modules.exchanges import service as exchange_service
from backend.modules.journal import behavior_analysis, quality_analysis
from backend.modules.journal import repository as journal_repository
from backend.modules.journal.trade_selection import closed_positions
from backend.modules.plan_lab import analysis as plan_analysis
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.plan_lab import router as plan_router
from backend.modules.plan_lab.schemas import InTradePlanCreate


def _revision():
    return {
        "entry_price": None,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 98.0,
        "take_profit": 104.0,
        "take_profit_2": None,
        "setup": "pullback",
        "entry_note": None,
        "exit_note": None,
        "memo": None,
        "max_hold_hours": None,
        "client_created_at": None,
    }


def _live_position(*, size=1.0, average_price=100.0):
    return {
        "exchange": "deepcoin",
        "position_id": "stable-live-position",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": size,
        "average_price": average_price,
        "last_price": 101.0,
        "opened_at": "2026-01-01T10:00:00Z",
    }


def _plan_payload():
    position = _live_position()
    return {
        "exchange": position["exchange"],
        "position_id": position["position_id"],
        "symbol": position["symbol"],
        "side": position["direction"],
        "revision": _revision(),
    }


def _table_counts(db_path):
    with sqlite3.connect(db_path) as conn:
        return tuple(
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                plan_repository.PLAN_TABLE,
                plan_repository.REVISION_TABLE,
                plan_repository.LINK_TABLE,
            )
        )


def _trade(identifier, timestamp_ms, side, amount, price):
    return exchange_service._Trade(
        external_id=f"deepcoin:fill:{identifier}",
        timestamp_ms=timestamp_ms,
        symbol="BTC/USDT",
        coin="BTC",
        side=side,
        amount=amount,
        price=price,
        fee=0.0,
        fee_currency="USDT",
        order_id=identifier,
        position_side="LONG",
        contract_size=1.0,
    )


def test_scale_in_keeps_one_live_identity_and_refreshes_size_and_average(monkeypatch):
    snapshots = iter([
        [{
            "posId": "stable-live-position", "instId": "BTC-USDT-SWAP", "posSide": "long",
            "pos": "1", "avgPx": "100", "lastPx": "101", "cTime": "1767261600000",
        }],
        [{
            "posId": "stable-live-position", "instId": "BTC-USDT-SWAP", "posSide": "long",
            "pos": "2", "avgPx": "105", "lastPx": "106", "cTime": "1767261600000",
        }],
    ])
    credentials = exchange_service._Credentials("key", "secret", "passphrase")

    class Client:
        def __init__(self, _credentials):
            pass

        def get_open_positions(self):
            return next(snapshots)

    monkeypatch.setattr(exchange_service, "DeepcoinClient", Client)

    before = exchange_service._deepcoin_open_positions(credentials)
    after = exchange_service._deepcoin_open_positions(credentials)

    assert len(before) == len(after) == 1
    assert before[0]["position_id"] == after[0]["position_id"] == "stable-live-position"
    assert (before[0]["size"], before[0]["average_price"]) == (1.0, 100.0)
    assert (after[0]["size"], after[0]["average_price"]) == (2.0, 105.0)


def test_partial_close_does_not_publish_closed_trade_until_remaining_size_is_zero():
    entry = _trade("entry", 1_000, "buy", 2.0, 100.0)
    partial = _trade("partial", 2_000, "sell", 1.25, 110.0)
    final = _trade("final", 3_000, "sell", 0.75, 120.0)

    still_open, ignored = exchange_service._reconstruct_positions(
        "deepcoin", [entry, partial], "SWAP",
    )
    closed, final_ignored = exchange_service._reconstruct_positions(
        "deepcoin", [entry, partial, final], "SWAP",
    )

    assert ignored == final_ignored == 0
    assert still_open == []
    assert len(closed) == 1
    assert closed[0]["size"] == 2.0
    assert closed[0]["entry_price"] == 100.0
    assert closed[0]["exit_price"] == pytest.approx(113.75)


def test_open_plan_links_once_after_close_without_duplicate_or_orphan_rows(tmp_path):
    db_path = tmp_path / "journal.db"
    position = _live_position()
    first = plan_repository.create_in_trade_plan(_plan_payload(), position, db_path=db_path)
    duplicate = plan_repository.create_in_trade_plan(_plan_payload(), position, db_path=db_path)
    assert duplicate["id"] == first["id"]
    assert _table_counts(db_path) == (1, 1, 0)

    entry, created = journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "deepcoin:position:stable-live-position",
            "exchange": "deepcoin",
            "source": "deepcoin_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": position["opened_at"],
            "datetime": "2026-01-01T12:00:00Z",
            "entry_price": 100.0,
            "exit_price": 104.0,
            "realized_pnl": 40.0,
        },
        db_path=db_path,
    )
    assert created is True

    plan_repository.reconcile_links(db_path=db_path)
    plan_repository.reconcile_links(db_path=db_path)
    linked = plan_repository.get_plan(first["id"], db_path=db_path)

    assert linked["status"] == "linked"
    assert linked["source"] == "IN_TRADE"
    assert linked["link"]["journal_entry_id"] == entry["id"]
    assert _table_counts(db_path) == (1, 1, 1)


def test_binance_close_is_not_guessed_when_open_and_closed_ids_are_not_stable(tmp_path):
    """Guard against reintroducing symbol/side/time fallback around exact lifecycle linking."""
    db_path = tmp_path / "journal.db"
    position = {
        **_live_position(),
        "exchange": "binance",
        "position_id": "binance:BTC/USDT:long",
    }
    payload = {
        **_plan_payload(),
        "exchange": "binance",
        "position_id": position["position_id"],
    }
    plan = plan_repository.create_in_trade_plan(payload, position, db_path=db_path)
    journal_repository.add_entry_if_new_external_id(
        {
            "external_id": "binance:position:reconstructed-lifecycle-hash",
            "exchange": "binance",
            "source": "binance_position",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "entry_datetime": position["opened_at"],
            "datetime": "2026-01-01T12:00:00Z",
            "entry_price": 100.0,
            "exit_price": 104.0,
        },
        db_path=db_path,
    )

    plan_repository.reconcile_links(db_path=db_path)
    unresolved = plan_repository.get_plan(plan["id"], db_path=db_path)

    assert unresolved["status"] == "active"
    assert unresolved["link"] is None
    assert _table_counts(db_path) == (1, 1, 0)


def test_save_race_rechecks_server_and_rejects_closed_position_before_any_write(monkeypatch):
    called = False

    def create_spy(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("repository write must not run after the server reports CLOSED")

    monkeypatch.setattr(
        plan_router,
        "exchange_open_positions_service",
        lambda: {"success": True, "data": {"positions": [], "unavailable_exchanges": []}},
    )
    monkeypatch.setattr(plan_router, "create_in_trade_plan", create_spy)
    payload = InTradePlanCreate.model_validate({
        "exchange": "deepcoin",
        "position_id": "stable-live-position",
        "revision": _revision(),
    })

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(plan_router.api_create_in_trade_plan(payload))

    assert exc_info.value.status_code == 409
    assert "no longer open" in str(exc_info.value.detail)
    assert "retrospective" in str(exc_info.value.detail)
    assert called is False


def test_binance_plan_save_rejects_unverified_lifecycle_before_any_write(monkeypatch):
    called = False

    def create_spy(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("repository write must not run without an exact lifecycle")

    monkeypatch.setattr(
        plan_router,
        "exchange_open_positions_service",
        lambda: {"success": True, "data": {"positions": [{
            "exchange": "binance",
            "position_id": "binance-live-raw",
            "lifecycle_id": None,
            "lifecycle_available": False,
            "symbol": "BTC/USDT",
            "direction": "Long",
            "size": 1.0,
            "average_price": 100.0,
        }], "unavailable_exchanges": []}},
    )
    monkeypatch.setattr(plan_router, "create_in_trade_plan", create_spy)
    payload = InTradePlanCreate.model_validate({
        "exchange": "binance",
        "position_id": "binance-live-raw",
        "revision": _revision(),
    })

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(plan_router.api_create_in_trade_plan(payload))

    assert exc_info.value.status_code == 409
    assert "Synchronize fills" in str(exc_info.value.detail)
    assert called is False


def test_open_trade_and_unlinked_in_trade_plan_are_isolated_from_closed_quant(monkeypatch):
    open_entry = {
        "id": 999,
        "source": "deepcoin_open_position",
        "exchange": "deepcoin",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_datetime": "2026-01-01T10:00:00Z",
        "datetime": None,
        "entry_price": 100.0,
        "exit_price": None,
    }
    active_plan = {
        "id": 77,
        "source": "IN_TRADE",
        "status": "active",
        "live_position_id": "stable-live-position",
        "link": None,
        "revisions": [],
        "latest_revision": _revision(),
    }
    assert closed_positions([open_entry], 0, 9_999_999_999_999) == []

    monkeypatch.setattr(plan_analysis.journal_repository, "list_entries", lambda: [open_entry])
    monkeypatch.setattr(plan_analysis.repository, "list_plans", lambda: [active_plan])
    monkeypatch.setattr(
        plan_analysis,
        "load_trade_path_items",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("OPEN trades must not trigger post-exit price-path analysis")
        ),
    )

    data = plan_analysis.run_plan_lab_service(0, 9_999_999_999_999)["data"]

    assert data["summary"]["closed_trade_count"] == 0
    assert data["summary"]["plan_recorded_count"] == 0
    assert data["summary"]["trade_count"] == 0
    assert data["coverage"]["official_r"] == 0
    assert data["primary_attribution"] == []
    assert data["early_exit_analysis"] == []
    assert data["evaluations"] == []
    assert data["optimizer"]["variants"]
    for variant in data["optimizer"]["variants"]:
        assert variant["journal_ids"] == []
        assert variant["overall"]["trade_count"] == 0
        assert variant["discovery"]["trade_count"] == 0
        assert variant["validation"]["trade_count"] == 0

    quality_analysis.QUALITY_ANALYSIS_CACHE.clear()
    monkeypatch.setattr(quality_analysis.repository, "list_entries", lambda: [open_entry])
    monkeypatch.setattr(
        quality_analysis,
        "run_journal_excursions_service",
        lambda *_args: {"success": True, "data": {"items": [], "warnings": []}},
    )
    quality = quality_analysis.run_journal_quality_analysis_service(0, 9_999_999_999_999)
    assert quality["data"]["items"] == []
    assert quality["data"]["summary"]["trade_count"] == 0

    monkeypatch.setattr(
        behavior_analysis,
        "run_journal_quality_analysis_service",
        lambda *_args, **_kwargs: quality,
    )
    monkeypatch.setattr(behavior_analysis.repository, "list_entries", lambda: [open_entry])
    monkeypatch.setattr(behavior_analysis.repository, "list_behavior_rules", lambda: [])
    behavior = behavior_analysis.run_journal_behavior_analysis_service(0, 9_999_999_999_999)["data"]
    assert behavior["items"] == []
    assert behavior["coverage"] == {
        "selected_closed_positions": 0,
        "behavior_items": 0,
        "missing_quality_items": 0,
    }
    assert behavior["biggest_leaks"] == []
