import pandas as pd

from backend.modules.journal import market_data


def _frame():
    return pd.DataFrame([{
        "open_time": 1_000,
        "open": 100.0,
        "high": 110.0,
        "low": 90.0,
        "close": 105.0,
        "volume": 1.0,
        "quote_volume": 105.0,
        "close_time": 1_999,
        "trade_count": 0,
    }])


def test_ccxt_exchange_ohlcv_is_preferred_over_binance_fallback(monkeypatch):
    monkeypatch.setattr(market_data, "fetch_exchange_klines", lambda *args: _frame())
    monkeypatch.setattr(market_data, "fetch_binance_klines", lambda *_args: (_ for _ in ()).throw(AssertionError("fallback used")))

    frame = market_data.load_journal_ohlcv(
        "BTC/USDT", "4h", total_candles=100, exchange="bybit", instrument_type="SWAP"
    )

    assert frame is not None
    assert market_data.market_source(frame) == "Bybit SWAP API"
    assert market_data.is_market_fallback(frame) is False


def test_binance_fallback_is_labeled_when_exchange_data_is_unavailable(monkeypatch):
    monkeypatch.setattr(market_data, "fetch_exchange_klines", lambda *args: None)
    monkeypatch.setattr(market_data, "fetch_binance_klines", lambda *_args: _frame())

    frame = market_data.load_journal_ohlcv(
        "BTC/USDT", "4h", total_candles=100, exchange="okx", instrument_type="SPOT"
    )

    assert frame is not None
    assert market_data.market_source(frame) == "Binance Spot fallback"
    assert market_data.is_market_fallback(frame) is True


def test_monthly_close_time_uses_calendar_month_boundary():
    february_open = int(pd.Timestamp("2026-02-01T00:00:00Z").timestamp() * 1000)
    expected_close = int(pd.Timestamp("2026-03-01T00:00:00Z").timestamp() * 1000) - 1

    actual = market_data._candle_close_time(
        february_open,
        "1M",
        market_data._interval_ms("1M"),
    )

    assert actual == expected_close


def test_close_times_do_not_stretch_across_a_missing_candle():
    opens = pd.Series([0, 30 * 60 * 1000], dtype="int64")
    frame = pd.DataFrame({"open_time": opens})

    market_data._set_close_times(frame, "15m", 15 * 60 * 1000)

    assert frame["close_time"].tolist() == [15 * 60 * 1000 - 1, 45 * 60 * 1000 - 1]
