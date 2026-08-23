from __future__ import annotations

import numpy as np
import pandas as pd

from backend.modules.journal import current_market


def _frame(as_of_ms: int, count: int = 245) -> pd.DataFrame:
    interval_ms = 60 * 60 * 1000
    open_time = as_of_ms - np.arange(count, 0, -1) * interval_ms
    close = np.linspace(100.0, 180.0, count)
    volume = np.full(count, 100.0)
    return pd.DataFrame({
        "open_time": open_time,
        "open_dt": pd.to_datetime(open_time, unit="ms"),
        "close_time": open_time + interval_ms - 1,
        "open": close - 0.2,
        "high": close + 0.8,
        "low": close - 0.8,
        "close": close,
        "volume": volume,
        "quote_volume": volume * close,
        "trade_count": np.full(count, 10),
        "taker_buy_base_volume": volume * 0.55,
        "taker_buy_quote_volume": volume * close * 0.55,
    })


def test_current_market_snapshot_reuses_completed_indicator_and_trend_paths(monkeypatch):
    as_of_ms = 1_800_000_000_000
    requested = []

    def load_candles(symbol, interval, *, total_candles, end_time, exchange=None):
        requested.append((symbol, interval, total_candles, end_time, exchange))
        return _frame(as_of_ms, total_candles)

    monkeypatch.setattr(current_market, "load_journal_ohlcv", load_candles)

    result = current_market.build_current_market_snapshot("btc", as_of_ms)

    payload = result["data"]
    assert result["success"] is True
    assert payload["symbol"] == "BTC/USDT"
    assert payload["indicator_snapshot"]["version"] == 2
    assert set(payload["indicator_snapshot"]["timeframes"]) == {"1h", "2h", "4h", "1d", "1w", "1M"}
    assert all(
        value["status"] == "complete"
        for value in payload["indicator_snapshot"]["timeframes"].values()
    )
    assert set(payload["trend_states"]) == {"1w", "1d", "4h"}
    assert all(value["status"] == "complete" for value in payload["trend_states"].values())
    assert payload["market_regime"]["trade_bias"] == "up"
    anchored = payload["indicator_snapshot"]["timeframes"]["4h"]["anchored_vwap"]
    assert anchored["anchor"] == "month"
    assert anchored["sample_count"] <= anchored["length"] == 14
    assert set(anchored["bands"]) == {"-3", "-2", "-1", "1", "2", "3"}
    assert {item[1] for item in requested} == {"1h", "2h", "4h", "1d", "1w", "1M"}
    assert all(item[0] == "BTC/USDT" and item[3] == as_of_ms and item[4] == "Deepcoin" for item in requested)
