import pandas as pd
import pytest

from backend.modules.indicators import service as indicator_service
from backend.modules.indicators.reverse_calc import get_indicator_projections
from backend.modules.indicators.service import run_indicator_projection_service
from core.indicator_primitives import compute_rsi_wilder, compute_vwap_anchored


def _trade_report_frame(rows: int = 560) -> pd.DataFrame:
    open_dt = pd.date_range("2025-01-01", periods=rows, freq="h", tz="UTC")
    base = pd.Series(range(rows), dtype=float)
    close = 40_000 + base * 5 + (base % 11) * 8
    open_time = (open_dt.astype("int64") // 1_000_000).astype("int64")
    volume = 10 + (base % 7)
    return pd.DataFrame(
        {
            "open_dt": open_dt,
            "open_time": open_time,
            "close_time": open_time + 3_599_999,
            "open": close - 10,
            "high": close + 25,
            "low": close - 25,
            "close": close,
            "volume": volume,
            "quote_volume": volume * close,
            "trade_count": 100,
            "taker_buy_base_volume": volume * 0.55,
            "taker_buy_quote_volume": volume * close * 0.55,
        }
    )


def test_trade_report_uses_only_completed_candles_before_reference(monkeypatch):
    frame = _trade_report_frame()
    as_of = int(frame.iloc[-61]["close_time"]) + 1

    def _mock_fetch(symbol, interval, total_candles, end_time):
        assert symbol == "BTCUSDT"
        assert interval == "1h"
        assert total_candles == 550
        assert end_time == int(frame.iloc[-1]["close_time"])
        return frame

    monkeypatch.setattr(indicator_service, "fetch_binance_klines", _mock_fetch)

    result = indicator_service.run_trade_report_service(
        "BTC",
        "1h",
        limit=300,
        end_time=int(frame.iloc[-1]["close_time"]),
        as_of=as_of,
    )

    payload = result["data"]
    assert result["success"] is True
    assert payload["count"] == 300
    assert len(payload["candles"]) == 300
    assert payload["vpvr"]["candle_count"] == 300
    assert payload["vpvr"]["current_price"] == pytest.approx(frame.iloc[-61]["close"])
    assert payload["vwaps"]["vwaps"][0]["anchor"] == "day"
    assert payload["latest"]["rsi"] is not None
    assert len(payload["series"]["macd"]["v"]) > 0
    assert all(timestamp.endswith("Z") for timestamp in payload["series"]["macd"]["t"])


def test_indicator_projections_include_the_current_wilder_rsi():
    closes = pd.Series([100.0 + ((index % 5) - 2) * 2 + index for index in range(30)])
    frame = pd.DataFrame(
        {
            "close": closes,
            "high": closes + 3,
            "low": closes - 3,
            "volume": 1_000.0,
            "open_dt": pd.date_range("2025-01-01", periods=30, freq="h"),
        }
    )

    result = get_indicator_projections(frame)

    assert result["current_rsi"] == pytest.approx(compute_rsi_wilder(closes, 14).iloc[-1])
    assert result["vwaps"] == [{"anchor": "day", "value": pytest.approx(compute_vwap_anchored(frame, "day"))}]


def test_indicator_projection_service_uses_binance_klines(monkeypatch):
    closes = pd.Series([100.0 + index for index in range(220)])
    frame = pd.DataFrame(
        {
            "close": closes,
            "high": closes + 2,
            "low": closes - 2,
            "volume": 1_000.0,
            "open_dt": pd.date_range("2025-01-01", periods=220, freq="2h"),
        }
    )
    requested = {}

    def load_candles(symbol, interval, total_candles):
        requested.update(symbol=symbol, interval=interval, total_candles=total_candles)
        return frame

    monkeypatch.setattr("backend.modules.indicators.service.fetch_binance_klines", load_candles)

    result = run_indicator_projection_service("BTCUSDT", "2h")

    assert requested == {"symbol": "BTCUSDT", "interval": "2h", "total_candles": 101}
    assert result["current_price"] == 318.0
    assert result["current_rsi"] == pytest.approx(100.0)
    assert [vwap["anchor"] for vwap in result["vwaps"]] == ["day", "week"]


def test_indicator_projection_service_uses_monthly_vwap_for_daily_candles(monkeypatch):
    closes = pd.Series([100.0 + index for index in range(367)])
    frame = pd.DataFrame(
        {
            "close": closes,
            "high": closes + 2,
            "low": closes - 2,
            "volume": 1_000.0 + closes,
            "open_dt": pd.date_range("2025-08-16", periods=367, freq="D"),
        }
    )
    requested = {}

    def load_candles(symbol, interval, total_candles):
        requested.update(symbol=symbol, interval=interval, total_candles=total_candles)
        return frame

    monkeypatch.setattr(
        "backend.modules.indicators.service.fetch_binance_klines",
        load_candles,
    )

    result = run_indicator_projection_service("BTCUSDT", "1d")

    completed = frame.iloc[:-1]
    assert requested == {"symbol": "BTCUSDT", "interval": "1d", "total_candles": 367}
    assert [vwap["anchor"] for vwap in result["vwaps"]] == ["month"]
    assert result["vwaps"][0]["value"] == pytest.approx(compute_vwap_anchored(completed, "month"))
