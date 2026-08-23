from backend.modules.exchanges import sync_service
from backend.modules.exchanges.models import NormalizedTrade, TradeFetchResult


def test_ccxt_resync_updates_existing_positions_without_deleting_them(monkeypatch):
    class FakeClient:
        name = "Binance"
        markets = {}

        def load_markets(self):
            return None

        def close(self):
            return None

    trade = NormalizedTrade(
        external_id="binance:fill:1",
        timestamp_ms=1_700_000_000_000,
        symbol="BTC/USDT",
        coin="BTC",
        side="buy",
        amount=0.01,
        price=60_000,
        fee=1,
        fee_currency="USDT",
        order_id="order-1",
        position_side="long",
        contract_size=1,
    )
    position = {
        "external_id": "binance:position:1",
        "entry_external_id": trade.external_id,
        "entry_timestamp_ms": trade.timestamp_ms,
        "timestamp_ms": trade.timestamp_ms + 3_600_000,
        "coin": "BTC",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 0.01,
        "entry_price": 60_000,
        "exit_price": 61_000,
        "realized_pnl": 10,
        "fee": 1,
        "fee_currency": "USDT",
        "order_id": "order-1",
        "invested_amount": 600,
        "fee_complete": True,
    }
    updated_rows = []

    monkeypatch.setattr(sync_service, "requested_symbols", lambda *_: ["BTC/USDT"])
    monkeypatch.setattr(sync_service, "fetch_trades", lambda *_: TradeFetchResult([{}], []))
    monkeypatch.setattr(sync_service, "normalize_trades", lambda *_: ([trade], 0))
    monkeypatch.setattr(sync_service, "add_executions_if_new", lambda *_: {trade.external_id})
    monkeypatch.setattr(sync_service, "list_executions", lambda **_: [])
    monkeypatch.setattr(sync_service, "fetch_binance_funding_income", lambda *_: ([], 0, False))
    monkeypatch.setattr(sync_service, "reconstruct_positions", lambda *_, **__: ([position], 0))
    monkeypatch.setattr(sync_service, "build_indicator_snapshots", lambda *_: {})
    monkeypatch.setattr(sync_service, "add_entries_if_new_external_ids", lambda *_: set())
    monkeypatch.setattr(
        sync_service,
        "update_imported_entries_by_external_id",
        lambda rows: updated_rows.extend(rows) or len(rows),
    )

    response = sync_service.sync_ccxt("binance", "SWAP", 30, ["BTC/USDT"], FakeClient())

    assert response["data"]["positions_imported"] == 0
    assert response["data"]["positions_updated"] == 1
    assert [row["external_id"] for row in updated_rows] == ["binance:position:1"]


def test_binance_funding_is_added_only_when_history_and_fee_are_complete():
    position = {
        "entry_timestamp_ms": 1_000,
        "timestamp_ms": 3_000,
        "symbol": "BTC/USDT",
        "fee_complete": True,
        "realized_pnl": 10.0,
        "funding_complete": True,
    }

    ambiguous = sync_service._attach_binance_funding(
        [position],
        [{"timestamp_ms": 2_000, "symbol": "BTC/USDT", "income": -0.5, "asset": "USDT"}],
        coverage_start=500,
        history_complete=True,
    )

    assert ambiguous == 0
    assert position["funding_complete"] is True
    assert position["funding_fee"] == -0.5


def test_incomplete_fee_or_funding_removes_net_pnl_from_position_row():
    position = {
        "external_id": "binance:position:1",
        "entry_timestamp_ms": 1_000,
        "timestamp_ms": 2_000,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 1,
        "entry_price": 100,
        "exit_price": 110,
        "fee": 0,
        "fee_currency": None,
        "fee_complete": False,
        "funding_fee": None,
        "funding_complete": True,
        "realized_pnl": 10,
        "invested_amount": None,
        "order_id": "order-1",
    }

    row = sync_service._position_row("binance", "Binance", position, {}, "SWAP")

    assert row["realized_pnl"] is None
    assert row["outcome"] is None
    assert "fee could not be converted" in row["notes"]


def test_complete_binance_fee_and_funding_produce_net_pnl_but_not_margin_return():
    position = {
        "external_id": "binance:position:net",
        "entry_timestamp_ms": 1_000,
        "timestamp_ms": 2_000,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 1,
        "entry_price": 100,
        "exit_price": 110,
        "fee": 1,
        "fee_currency": "USDT",
        "fee_complete": True,
        "funding_fee": -0.5,
        "funding_complete": True,
        "realized_pnl": 9,
        "invested_amount": None,
        "order_id": "order-net",
    }

    row = sync_service._position_row("binance", "Binance", position, {}, "SWAP")

    assert row["realized_pnl"] == 8.5
    assert row["fee"] == 1
    assert row["funding_fee"] == -0.5
    assert row["leverage"] is None
    assert row["invested_amount"] is None
    assert row["outcome"] == "Win"
