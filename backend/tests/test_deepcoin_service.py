from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from backend.config.settings import DeepcoinCredentials
from backend.modules.deepcoin import service as deepcoin_service
from backend.modules.deepcoin import snapshot as deepcoin_snapshot
from backend.modules.journal import repository as journal_repository
from backend.modules.journal.service import get_journal_service


@pytest.fixture
def isolated_journal_store(monkeypatch, tmp_path):
    journal_dir = tmp_path / "journal-store"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", journal_dir / "trade_journal.db")
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", journal_dir / "trade_journal.csv")


def test_deepcoin_headers_follow_the_documented_hmac_prehash():
    credentials = DeepcoinCredentials(
        api_key="key",
        secret_key="secret",
        passphrase="passphrase",
    )
    request_path = "/deepcoin/trade/fills?instType=SWAP&limit=100"
    timestamp = "2026-08-04T10:30:00.000Z"

    headers = deepcoin_service.DeepcoinClient(credentials).build_headers(
        "GET",
        request_path,
        timestamp=timestamp,
    )

    expected = base64.b64encode(
        hmac.new(
            b"secret",
            f"{timestamp}GET{request_path}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("ascii")
    assert headers["DC-ACCESS-SIGN"] == expected
    assert headers["DC-ACCESS-KEY"] == "key"
    assert headers["DC-ACCESS-PASSPHRASE"] == "passphrase"


def test_open_positions_service_returns_only_normalized_live_positions(monkeypatch):
    credentials = DeepcoinCredentials("key", "secret", "passphrase")
    monkeypatch.setattr(deepcoin_service, "get_deepcoin_credentials", lambda: credentials)
    monkeypatch.setattr(deepcoin_service.DeepcoinClient, "get_open_positions", lambda *_args: [{
        "posId": "position-1",
        "instId": "BTC-USDT-SWAP",
        "posSide": "long",
        "pos": "0.25",
        "avgPx": "64000.5",
        "lastPx": "64500.0",
        "unrealizedProfit": "124.5",
        "lever": "10",
        "cTime": "1722761000000",
        "uTime": "1722762000000",
    }])

    result = deepcoin_service.get_deepcoin_open_positions_service()

    assert result["success"] is True
    assert result["data"] == [{
        "position_id": "position-1",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 0.25,
        "average_price": 64000.5,
        "last_price": 64500.0,
        "unrealized_pnl": 124.5,
        "leverage": 10.0,
        "opened_at": "2024-08-04T08:43:20Z",
        "updated_at": "2024-08-04T09:00:00Z",
    }]


def test_closed_position_snapshot_uses_the_recorded_entry_time():
    position = deepcoin_service._PreparedFill(
        raw={"cTime": "1722761000000"},
        external_id="deepcoin:position:entry-time",
        timestamp_ms=1722762000000,
        coin="BTC",
        event_type="position_close",
    )

    snapshot_event = deepcoin_service._snapshot_event_for_position(position)

    assert snapshot_event.event_type == "position_entry"
    assert snapshot_event.timestamp_ms == 1722761000000


def test_stale_closed_position_snapshot_refresh_uses_only_entry_time(monkeypatch):
    entry_time = datetime.now(timezone.utc) - timedelta(days=1)
    monkeypatch.setattr(deepcoin_service, "list_entries", lambda: [{
        "source": "deepcoin_position",
        "external_id": "deepcoin:position:stale",
        "symbol": "BTC/USDT",
        "entry_datetime": entry_time.isoformat().replace("+00:00", "Z"),
        "indicator_snapshot": {
            "version": 2,
            "timeframes": {"2h": {"status": "complete"}},
        },
    }, {
        "source": "deepcoin_position",
        "external_id": "deepcoin:position:missing-entry",
        "symbol": "BTC/USDT",
        "entry_datetime": None,
        "indicator_snapshot": {"version": 2},
    }])

    events = deepcoin_service._stale_closed_position_snapshot_events(7)

    assert len(events) == 1
    assert events[0].external_id == "deepcoin:position:stale"
    assert events[0].timestamp_ms == int(entry_time.timestamp() * 1000)
    assert events[0].event_type == "position_entry"


def test_entry_snapshot_records_entry_time_not_close_time(monkeypatch):
    event = deepcoin_service._PreparedFill(
        raw={},
        external_id="deepcoin:position:entry-time",
        timestamp_ms=1722761000000,
        coin="BTC",
        event_type="position_entry",
    )
    monkeypatch.setattr(
        deepcoin_snapshot,
        "load_journal_ohlcv",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("no market data")),
    )

    payload = deepcoin_snapshot.build_indicator_snapshots([event])[event.external_id]

    assert payload["event_type"] == "position_entry"
    assert payload["entry_time"] == payload["event_time"]
    assert "position_close_time" not in payload


def test_deepcoin_fills_split_saturated_time_windows(monkeypatch):
    credentials = DeepcoinCredentials("key", "secret", "passphrase")
    client = deepcoin_service.DeepcoinClient(credentials)
    received_params = []

    def get_page(params):
        received_params.append(dict(params))
        span_ms = int(params["end"]) - int(params["begin"])
        if span_ms > 86_400_000:
            return [{"billId": f"saturated-{index}"} for index in range(100)]
        return [{"billId": f"fill-{params['begin']}"}]

    monkeypatch.setattr(client, "_get_fill_page", get_page)
    monkeypatch.setattr(deepcoin_service.time, "sleep", lambda _seconds: None)

    fills = client.get_fills(inst_type="SWAP", lookback_days=7)

    assert len(fills) > 1
    assert len(received_params) > 2
    assert all("before" not in params for params in received_params)
    assert all(int(params["end"]) > int(params["begin"]) for params in received_params)
    assert client.truncated is False


def test_deepcoin_marks_fills_truncated_when_minimum_window_is_saturated(monkeypatch):
    client = deepcoin_service.DeepcoinClient(DeepcoinCredentials("key", "secret", "passphrase"))
    saturated_page = [{"billId": str(200 - index)} for index in range(100)]
    calls = 0

    def get_page(_params):
        nonlocal calls
        calls += 1
        return saturated_page

    monkeypatch.setattr(client, "_get_fill_page", get_page)
    monkeypatch.setattr(deepcoin_service.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(deepcoin_service, "DEEPCOIN_FILL_HISTORY_MIN_WINDOW_MINUTES", 20_000)

    fills = client.get_fills(inst_type="SWAP", lookback_days=7)

    assert len(fills) == 100
    assert calls == 1
    assert client.truncated is True


def test_deepcoin_sync_is_idempotent_and_persists_snapshot(isolated_journal_store, monkeypatch):
    credentials = DeepcoinCredentials("key", "secret", "passphrase")
    fill = {
        "billId": "bill-1",
        "tradeId": "trade-1",
        "ordId": "order-1",
        "instId": "BTC-USDT-SWAP",
        "fillPx": "64000.5",
        "fillSz": "0.01",
        "side": "buy",
        "posSide": "long",
        "execType": "taker",
        "fee": "0.8",
        "feeCcy": "USDT",
        "ts": "1722762000000",
    }
    snapshot = {
        "version": 1,
        "market_source": "Binance USDT-M Futures",
        "reference": "last_completed_candle_before_deepcoin_fill",
        "fill_time": "2024-08-04T10:20:00Z",
        "timeframes": {interval: {"status": "complete"} for interval in ("1h", "2h", "4h", "1d")},
    }
    monkeypatch.setattr(deepcoin_service, "get_deepcoin_credentials", lambda: credentials)
    monkeypatch.setattr(deepcoin_service.DeepcoinClient, "get_fills", lambda *_args, **_kwargs: [fill])
    monkeypatch.setattr(
        deepcoin_service.DeepcoinClient,
        "get_positions_history",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        deepcoin_service,
        "_build_indicator_snapshots",
        lambda fills: {fills[0].external_id: snapshot},
    )

    first = deepcoin_service.sync_deepcoin_fills_service("SWAP", 7)
    second = deepcoin_service.sync_deepcoin_fills_service("SWAP", 7)

    assert first["data"]["imported"] == 1
    assert first["data"]["complete_snapshots"] == 1
    assert second["data"]["imported"] == 0
    assert second["data"]["skipped"] == 1

    stored = get_journal_service()["data"]
    assert len(stored) == 1
    assert stored[0]["external_id"] == "deepcoin:bill-1"
    assert stored[0]["source"] == "deepcoin"
    assert stored[0]["symbol"] == "BTC/USDT"
    assert stored[0]["indicator_snapshot"] == snapshot


def test_deepcoin_sync_imports_closed_positions_with_net_realized_pnl(
    isolated_journal_store,
    monkeypatch,
):
    credentials = DeepcoinCredentials("key", "secret", "passphrase")
    position = {
        "instId": "ETH-USDT-SWAP",
        "posId": "position-1",
        "posSide": "short",
        "avgPx": "3500",
        "closeAvgPx": "3400",
        "closePos": "0.5",
        "pnl": "50",
        "fee": "1.2",
        "fundingFee": "0.5",
        "lever": "10",
        "ccy": "USDT",
        "cTime": "1722761000000",
        "uTime": "1722762000000",
    }
    snapshot = {
        "version": 1,
        "market_source": "Binance USDT-M Futures",
        "reference": "last_completed_candle_before_deepcoin_position_close",
        "event_type": "position_close",
        "event_time": "2024-08-04T10:20:00Z",
        "timeframes": {interval: {"status": "complete"} for interval in ("1h", "2h", "4h", "1d")},
    }
    monkeypatch.setattr(deepcoin_service, "get_deepcoin_credentials", lambda: credentials)
    monkeypatch.setattr(deepcoin_service.DeepcoinClient, "get_fills", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        deepcoin_service.DeepcoinClient,
        "get_positions_history",
        lambda *_args, **_kwargs: [position],
    )
    monkeypatch.setattr(
        deepcoin_service,
        "_build_indicator_snapshots",
        lambda events: {event.external_id: snapshot for event in events},
    )

    first = deepcoin_service.sync_deepcoin_fills_service("SWAP", 7)
    position["pnl"] = "60"
    second = deepcoin_service.sync_deepcoin_fills_service("SWAP", 7)

    assert first["data"]["positions_fetched"] == 1
    assert first["data"]["positions_imported"] == 1
    assert first["data"]["complete_snapshots"] == 1
    assert second["data"]["positions_imported"] == 0
    assert second["data"]["positions_updated"] == 1
    assert second["data"]["positions_skipped"] == 0

    stored = get_journal_service()["data"]
    assert len(stored) == 1
    assert stored[0]["external_id"] == "deepcoin:position:position-1"
    assert stored[0]["source"] == "deepcoin_position"
    assert stored[0]["symbol"] == "ETH/USDT"
    assert stored[0]["direction"] == "Short"
    assert stored[0]["entry_datetime"] == "2024-08-04T08:43:20Z"
    assert stored[0]["entry_price"] == 3500.0
    assert stored[0]["exit_price"] == 3400.0
    assert stored[0]["fee"] == 1.2
    assert stored[0]["funding_fee"] == 0.5
    assert stored[0]["realized_pnl"] == pytest.approx(59.3)
    assert stored[0]["leverage"] == pytest.approx(10)
    assert stored[0]["invested_amount"] == pytest.approx(210)
    assert stored[0]["outcome"] == "Win"
    assert stored[0]["indicator_snapshot"] == snapshot


def test_net_position_pnl_preserves_funding_fee_sign():
    base = {"pnl": "50", "fee": "1.2"}

    assert deepcoin_service._net_position_pnl({**base, "fundingFee": "0.5"}) == pytest.approx(49.3)
    assert deepcoin_service._net_position_pnl({**base, "fundingFee": "-0.5"}) == pytest.approx(48.3)
    assert deepcoin_service._net_position_pnl({**base, "fee": "-1.2", "fundingFee": "0.5"}) == pytest.approx(49.3)


def test_position_invested_amount_uses_recorded_leverage():
    position = {
        "posSide": "long",
        "avgPx": "100",
        "closeAvgPx": "102",
        "pnl": "20",
        "lever": "10",
    }

    assert deepcoin_service._position_invested_amount(position) == pytest.approx(100)
    assert deepcoin_service._position_invested_amount({**position, "lever": ""}) is None


def test_trade_markers_use_only_confirmed_take_profit_triggers(monkeypatch):
    credentials = DeepcoinCredentials("key", "secret", "passphrase")
    entry_time = "2026-08-04T10:00:00Z"
    exit_time = "2026-08-04T12:00:00Z"

    def trigger_ms(value):
        return str(deepcoin_service._iso_to_timestamp_ms(value))

    orders = [
        {
            "ordId": "tp-2",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": trigger_ms("2026-08-04T11:00:00Z"),
            "triggerPx": "110",
            "tpTriggerPrice": "110",
            "slTriggerPrice": "0",
            "sz": "2",
            "errorCode": "0",
        },
        {
            "ordId": "tp-1",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": trigger_ms("2026-08-04T11:30:00Z"),
            "triggerPx": "105",
            "tpTriggerPrice": "105",
            "slTriggerPrice": "0",
            "sz": "1",
            "errorCode": "0",
        },
        {
            "ordId": "stop-loss",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": trigger_ms("2026-08-04T11:40:00Z"),
            "triggerPx": "90",
            "tpTriggerPrice": "115",
            "slTriggerPrice": "90",
            "errorCode": "0",
        },
        {
            "ordId": "failed-tp",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": trigger_ms("2026-08-04T11:50:00Z"),
            "triggerPx": "115",
            "errorCode": "4",
        },
        {
            "ordId": "manual-trigger",
            "ordType": "Conditional",
            "posSide": "long",
            "triggerTime": trigger_ms("2026-08-04T11:55:00Z"),
            "triggerPx": "120",
            "errorCode": "0",
        },
    ]
    monkeypatch.setattr(deepcoin_service, "get_deepcoin_credentials", lambda: credentials)
    requested_instruments = []

    def get_trigger_orders_history(_client, *, inst_id):
        requested_instruments.append(inst_id)
        return orders

    monkeypatch.setattr(
        deepcoin_service.DeepcoinClient,
        "get_trigger_orders_history",
        get_trigger_orders_history,
    )

    result = deepcoin_service.get_deepcoin_trade_markers_service(
        "BTC/USDT",
        "Long",
        entry_time,
        exit_time,
        100,
    )

    markers = result["data"]["take_profits"]
    assert [marker["order_id"] for marker in markers] == ["tp-2", "tp-1"]
    assert [marker["label"] for marker in markers] == ["TP2", "TP1"]
    assert [marker["price"] for marker in markers] == [110.0, 105.0]
    assert requested_instruments == ["BTC-USDT-SWAP"]
    assert result["data"]["source"] == "deepcoin_trigger_order_history"


def test_indicator_snapshot_uses_only_completed_candles():
    periods = 300
    open_times = pd.date_range("2025-01-01", periods=periods, freq="h", tz="UTC")
    close_times = open_times + pd.Timedelta(hours=1) - pd.Timedelta(milliseconds=1)
    close = pd.Series([60_000.0 + index * 10 for index in range(periods)])
    candles = pd.DataFrame(
        {
            "open_time": (open_times.astype("int64") // 1_000_000).astype("int64"),
            "open_dt": open_times,
            "open": close - 5,
            "high": close + 15,
            "low": close - 15,
            "close": close,
            "volume": 100.0,
            "close_time": (close_times.astype("int64") // 1_000_000).astype("int64"),
            "quote_volume": close * 100,
            "trade_count": 10,
            "taker_buy_base_volume": 50.0,
            "taker_buy_quote_volume": close * 50,
        }
    )
    fill = deepcoin_service._PreparedFill(
        raw={},
        external_id="deepcoin:test",
        timestamp_ms=int(close_times[-1].timestamp() * 1000) + 1,
        coin="BTC",
    )

    snapshot = deepcoin_service._indicator_snapshot_for_fill(candles, fill, "1h")

    assert snapshot["status"] == "complete"
    assert snapshot["candle_close_time"] == close_times[-1].isoformat().replace("+00:00", "Z")
    assert snapshot["rsi"] == pytest.approx(100.0)
    assert snapshot["vpvr"]["candles"] == 240
    assert snapshot["vpvr"]["poc_low"] is not None
