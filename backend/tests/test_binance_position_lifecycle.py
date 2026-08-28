"""Deterministic Binance fill lifecycle and exact Plan-link fixtures."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

import pytest

from backend.modules.exchanges.models import NormalizedTrade
from backend.modules.exchanges.reconstruction import (
    exchange_account_scope,
    reconstruct_position_lifecycles,
)
from backend.modules.exchanges import service as exchange_service
from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository

ACCOUNT_SCOPE = "account-fixture"


def _trade(identifier, timestamp_ms, side, amount, price, position_side=None):
    return NormalizedTrade(
        external_id=f"binance:fill:{identifier}",
        timestamp_ms=timestamp_ms,
        symbol="BTC/USDT",
        coin="BTC",
        side=side,
        amount=amount,
        price=price,
        fee=0.0,
        fee_currency="USDT",
        order_id=identifier,
        position_side=position_side,
        contract_size=1.0,
    )


def _build(trades):
    return reconstruct_position_lifecycles(
        "binance", trades, "SWAP", account_scope=ACCOUNT_SCOPE,
    )


def _revision():
    return {
        "entry_price": None,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 90.0,
        "take_profit": 120.0,
        "take_profit_2": None,
        "setup": "trend",
        "entry_note": None,
        "exit_note": None,
        "memo": None,
        "max_hold_hours": None,
        "client_created_at": None,
    }


def _counts(db_path):
    with sqlite3.connect(db_path) as conn:
        return tuple(
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                plan_repository.PLAN_TABLE,
                plan_repository.REVISION_TABLE,
                plan_repository.LINK_TABLE,
            )
        )


def _execution_row(trade, account_scope):
    return {
        "external_id": trade.external_id,
        "datetime": datetime.fromtimestamp(
            trade.timestamp_ms / 1000,
            tz=timezone.utc,
        ).isoformat(),
        "symbol": trade.symbol,
        "size": trade.amount,
        "entry_price": trade.price,
        "actual_side": trade.side,
        "position_side": trade.position_side,
        "contract_size": trade.contract_size,
        "inst_type": "SWAP",
        "fee": trade.fee,
        "fee_currency": trade.fee_currency,
        "fee_complete": True,
        "order_id": trade.order_id,
        "account_scope": account_scope,
    }


@pytest.mark.parametrize("second_price", [90.0, 110.0])
def test_average_down_and_up_continue_the_opening_fill_lifecycle(second_price):
    first = [_trade("entry", 1_000, "buy", 1.0, 100.0)]
    scaled = [*first, _trade("scale", 2_000, "buy", 1.0, second_price)]

    _, first_open, _ = _build(first)
    _, scaled_open, _ = _build(scaled)

    assert len(first_open) == len(scaled_open) == 1
    assert first_open[0]["lifecycle_id"] == scaled_open[0]["lifecycle_id"]
    assert scaled_open[0]["size"] == 2.0
    assert scaled_open[0]["average_price"] == pytest.approx((100.0 + second_price) / 2)


def test_partial_close_stays_open_and_full_close_emits_the_same_lifecycle():
    entry = _trade("entry", 1_000, "buy", 3.0, 100.0)
    partial = _trade("partial", 2_000, "sell", 1.0, 110.0)
    final = _trade("final", 3_000, "sell", 2.0, 120.0)

    _, opened, _ = _build([entry])
    partial_closed, partial_open, _ = _build([entry, partial])
    fully_closed, final_open, _ = _build([entry, partial, final])

    lifecycle_id = opened[0]["lifecycle_id"]
    assert partial_closed == []
    assert len(partial_open) == 1
    assert partial_open[0]["size"] == 2.0
    assert partial_open[0]["lifecycle_id"] == lifecycle_id
    assert final_open == []
    assert len(fully_closed) == 1
    assert fully_closed[0]["lifecycle_id"] == lifecycle_id


def test_immediate_same_symbol_reentry_gets_a_new_lifecycle():
    trades = [
        _trade("entry-x", 1_000, "buy", 1.0, 100.0),
        _trade("close-x", 2_000, "sell", 1.0, 105.0),
        _trade("entry-y", 7_000, "buy", 1.0, 106.0),
    ]

    closed, opened, _ = _build(trades)

    assert len(closed) == len(opened) == 1
    assert closed[0]["lifecycle_id"] != opened[0]["lifecycle_id"]


def test_same_millisecond_numeric_fill_order_is_deterministic():
    fill_10 = _trade("10", 1_000, "buy", 1.0, 101.0)
    fill_9 = _trade("9", 1_000, "buy", 1.0, 100.0)

    _, forward, _ = _build([fill_9, fill_10])
    _, reversed_input, _ = _build([fill_10, fill_9])

    assert forward[0]["entry_external_id"] == "binance:fill:9"
    assert reversed_input[0]["entry_external_id"] == "binance:fill:9"
    assert forward[0]["lifecycle_id"] == reversed_input[0]["lifecycle_id"]


def test_hedge_mode_opposite_sides_have_separate_lifecycles():
    _, opened, _ = _build([
        _trade("long", 1_000, "buy", 1.0, 100.0, "LONG"),
        _trade("short", 2_000, "sell", 1.0, 101.0, "SHORT"),
    ])

    assert {item["direction"] for item in opened} == {"Long", "Short"}
    assert len({item["lifecycle_id"] for item in opened}) == 2


def test_one_way_reversal_closes_long_and_opens_new_short_lifecycle():
    closed, opened, _ = _build([
        _trade("long-entry", 1_000, "buy", 2.0, 100.0),
        _trade("reverse", 2_000, "sell", 3.0, 95.0),
    ])

    assert len(closed) == len(opened) == 1
    assert closed[0]["direction"] == "Long"
    assert opened[0]["direction"] == "Short"
    assert opened[0]["size"] == 1.0
    assert closed[0]["lifecycle_id"] != opened[0]["lifecycle_id"]


def test_open_to_closed_exact_lifecycle_links_plan_once_and_is_idempotent(tmp_path):
    db_path = tmp_path / "journal.db"
    opening = [_trade("entry-1", 1_000, "buy", 1.0, 100.0)]
    scaled = [*opening, _trade("entry-2", 2_000, "buy", 1.0, 110.0)]
    partial = [*scaled, _trade("partial", 3_000, "sell", 0.5, 115.0)]
    history = [*partial, _trade("final", 4_000, "sell", 1.5, 120.0)]
    _, open_rows, _ = _build(opening)
    _, scaled_rows, _ = _build(scaled)
    _, partial_rows, _ = _build(partial)
    closed_rows, final_rows, _ = _build(history)
    lifecycle_id = open_rows[0]["lifecycle_id"]

    assert scaled_rows[0]["lifecycle_id"] == partial_rows[0]["lifecycle_id"] == lifecycle_id
    assert final_rows == []
    assert closed_rows[0]["lifecycle_id"] == lifecycle_id

    position = {
        "exchange": "binance",
        "position_id": lifecycle_id,
        "lifecycle_id": lifecycle_id,
        "lifecycle_available": True,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "average_price": 100.0,
        "opened_at": "1970-01-01T00:00:01Z",
    }
    payload = {
        "exchange": "binance",
        "position_id": lifecycle_id,
        "symbol": "BTC/USDT",
        "side": "Long",
        "revision": _revision(),
    }
    plan = plan_repository.create_in_trade_plan(payload, position, db_path=db_path)
    plan_repository.add_in_trade_revision(plan["id"], {**_revision(), "take_profit": 125.0}, position, db_path=db_path)
    assert all(revision["entry_price"] is None for revision in plan_repository.get_plan(plan["id"], db_path=db_path)["revisions"])
    assert _counts(db_path) == (1, 2, 0)

    closed = closed_rows[0]
    entry_payload = {
        "external_id": closed["external_id"],
        "lifecycle_id": closed["lifecycle_id"],
        "exchange": "binance",
        "source": "binance_position",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_datetime": "1970-01-01T00:00:01Z",
        "datetime": "1970-01-01T00:00:04Z",
        "entry_price": closed["entry_price"],
        "exit_price": closed["exit_price"],
    }
    first, created = journal_repository.add_entry_if_new_external_id(entry_payload, db_path=db_path)
    second, duplicate = journal_repository.add_entry_if_new_external_id(entry_payload, db_path=db_path)
    assert created is True and duplicate is False and second["id"] == first["id"]

    for _ in range(10):
        plan_repository.reconcile_links(db_path=db_path)
    linked = plan_repository.get_plan(plan["id"], db_path=db_path)

    assert linked["status"] == "linked"
    assert linked["source"] == "IN_TRADE"
    assert linked["link"]["journal_entry_id"] == first["id"]
    assert len(linked["revisions"]) == 2
    assert _counts(db_path) == (1, 2, 1)


def test_historical_binance_external_id_is_preserved_while_lifecycle_is_backfilled(tmp_path):
    db_path = tmp_path / "journal.db"
    original = {
        "external_id": "binance:position:legacy-close-hash",
        "exchange": "binance",
        "source": "binance_position",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_datetime": "2026-01-01T10:00:00Z",
        "datetime": "2026-01-01T12:00:00Z",
        "entry_price": 100.0,
        "exit_price": 104.0,
    }
    entry, _ = journal_repository.add_entry_if_new_external_id(original, db_path=db_path)

    journal_repository.update_imported_entry_by_external_id(
        {**original, "lifecycle_id": "binance:lifecycle:backfilled"}, db_path=db_path,
    )
    refreshed = next(item for item in journal_repository.list_entries(db_path=db_path) if item["id"] == entry["id"])

    assert refreshed["external_id"] == original["external_id"]
    assert refreshed["lifecycle_id"] == "binance:lifecycle:backfilled"


def test_live_api_exposes_only_lifecycle_with_a_verified_flat_boundary(monkeypatch):
    credentials = exchange_service._Credentials("fixture-key", "fixture-secret")
    account_scope = exchange_account_scope("binance", credentials.api_key)
    first_entry = _trade("uncertain-entry", 1_700_000_001_000, "buy", 1.0, 100.0)

    monkeypatch.setattr(
        exchange_service,
        "list_executions",
        lambda **_kwargs: [_execution_row(first_entry, account_scope)],
    )
    uncertain = exchange_service._attach_binance_lifecycle_ids([{
        "position_id": "binance-live-raw",
        "exchange": "binance",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 1.0,
    }], credentials)

    assert uncertain[0]["position_id"] == "binance-live-raw"
    assert uncertain[0]["lifecycle_id"] is None
    assert uncertain[0]["lifecycle_available"] is False

    rows = [
        _execution_row(first_entry, account_scope),
        _execution_row(_trade("flat-boundary", 1_700_000_002_000, "sell", 1.0, 101.0), account_scope),
        _execution_row(_trade("verified-entry", 1_700_000_003_000, "buy", 2.0, 102.0), account_scope),
    ]
    monkeypatch.setattr(exchange_service, "list_executions", lambda **_kwargs: rows)
    verified = exchange_service._attach_binance_lifecycle_ids([{
        "position_id": "binance-live-raw",
        "exchange": "binance",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 2.0,
    }], credentials)

    expected = reconstruct_position_lifecycles(
        "binance",
        [
            first_entry,
            _trade("flat-boundary", 1_700_000_002_000, "sell", 1.0, 101.0),
            _trade("verified-entry", 1_700_000_003_000, "buy", 2.0, 102.0),
        ],
        "SWAP",
        account_scope=account_scope,
        skip_uncertain_initial_lifecycle=True,
    )[1][0]["lifecycle_id"]
    assert verified[0]["position_id"] == expected
    assert verified[0]["lifecycle_id"] == expected
    assert verified[0]["lifecycle_available"] is True
    assert verified[0]["opened_at"] == "2023-11-14T22:13:23Z"
