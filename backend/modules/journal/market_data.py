"""Single OHLCV source for journal analysis: Binance USDT-M Futures."""

from __future__ import annotations

from typing import Optional

import pandas as pd

from backend.utils.data_service import fetch_binance_klines

BINANCE_USDT_M_FUTURES_SOURCE = "Binance USDT-M Futures"


def _with_source(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    output.attrs["market_source"] = BINANCE_USDT_M_FUTURES_SOURCE
    output.attrs["market_source_fallback"] = False
    return output


def load_journal_ohlcv(
    symbol: str,
    interval: str,
    *,
    total_candles: int,
    end_time: Optional[int] = None,
    exchange: Optional[str] = None,
    instrument_type: str = "SWAP",
) -> Optional[pd.DataFrame]:
    """Load Binance USDT-M Futures candles for every journal analysis.

    Exchange arguments remain accepted for compatibility with the multi-exchange
    journal, but they never alter the analysis candle source.
    """
    _ = exchange, instrument_type
    frame = fetch_binance_klines(symbol.replace("/", ""), interval, total_candles, end_time)
    if frame is None or frame.empty:
        return None
    return _with_source(frame)


def market_source(frame: Optional[pd.DataFrame]) -> str:
    return str(frame.attrs.get("market_source") or BINANCE_USDT_M_FUTURES_SOURCE) if frame is not None else "Unknown market data"


__all__ = [
    "BINANCE_USDT_M_FUTURES_SOURCE",
    "load_journal_ohlcv",
    "market_source",
]
