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


def test_journal_market_data_always_uses_binance_usdt_m_futures(monkeypatch):
    requested = {}

    def fetch(symbol, interval, total_candles, end_time):
        requested.update({
            "symbol": symbol,
            "interval": interval,
            "total_candles": total_candles,
            "end_time": end_time,
        })
        return _frame()

    monkeypatch.setattr(market_data, "fetch_binance_klines", fetch)

    frame = market_data.load_journal_ohlcv(
        "BTC/USDT", "4h", total_candles=100, end_time=2_000,
        exchange="bybit", instrument_type="SPOT",
    )

    assert requested == {
        "symbol": "BTCUSDT",
        "interval": "4h",
        "total_candles": 100,
        "end_time": 2_000,
    }
    assert frame is not None
    assert market_data.market_source(frame) == "Binance USDT-M Futures"
    assert frame.attrs["market_source_fallback"] is False


def test_journal_market_data_preserves_empty_result(monkeypatch):
    monkeypatch.setattr(market_data, "fetch_binance_klines", lambda *_args: None)

    assert market_data.load_journal_ohlcv(
        "BTC/USDT", "4h", total_candles=100, exchange="Deepcoin"
    ) is None
