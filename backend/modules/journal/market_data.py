"""Market data source selection for journal analysis.

Deepcoin positions use its public SWAP candles when available.  Binance Spot is
kept as a labelled fallback so historical analysis never silently mixes sources.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import pandas as pd
import requests

from backend.config.settings import TIMEFRAME_TO_MINUTES, get_deepcoin_api_base_url
from backend.utils.data_service import cached, fetch_binance_klines

logger = logging.getLogger(__name__)

_BARS = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "12h": "12H", "1d": "1D", "1w": "1W", "1M": "1M"}
_PATH = "/deepcoin/v2/market/candles"
_LIMIT = 300


def _interval_ms(interval: str) -> Optional[int]:
    minutes = TIMEFRAME_TO_MINUTES.get(interval)
    if minutes is not None:
        return minutes * 60 * 1000
    return {"1w": 7 * 24 * 60 * 60 * 1000, "1M": 31 * 24 * 60 * 60 * 1000}.get(interval)


def _instrument(symbol: str) -> Optional[str]:
    base, separator, quote = symbol.replace("/", "-").upper().strip().partition("-")
    return f"{base}-{quote}-SWAP" if separator and base and quote else None


def _with_source(frame: pd.DataFrame, source: str, fallback: bool) -> pd.DataFrame:
    output = frame.copy()
    output.attrs["market_source"] = source
    output.attrs["market_source_fallback"] = fallback
    return output


@cached(ttl_seconds=30)
def fetch_deepcoin_swap_klines(symbol: str, interval: str, total_candles: int, end_time: Optional[int] = None) -> Optional[pd.DataFrame]:
    bar = _BARS.get(interval)
    instrument = _instrument(symbol)
    interval_ms = _interval_ms(interval)
    if bar is None or instrument is None or interval_ms is None:
        return None
    remaining = max(1, int(total_candles))
    cursor = int(end_time) if end_time is not None else None
    rows: list[object] = []
    try:
        while remaining > 0:
            params = {"instId": instrument, "bar": bar, "limit": min(_LIMIT, remaining)}
            if cursor is not None:
                params["endTime"] = cursor
            response = requests.get(f"{get_deepcoin_api_base_url()}{_PATH}", params=params, timeout=10)
            response.raise_for_status()
            payload = response.json()
            batch = payload.get("data") if isinstance(payload, dict) and str(payload.get("code", "0")) in {"0", "None"} else None
            if not isinstance(batch, list) or not batch:
                break
            rows.extend(batch)
            timestamps = [int(float(row[0])) for row in batch if isinstance(row, list) and row]
            if not timestamps:
                break
            remaining -= len(batch)
            cursor = min(timestamps) - 1
            if len(batch) < params["limit"]:
                break
            time.sleep(0.08)
    except (requests.RequestException, TypeError, ValueError) as exc:
        logger.info("Deepcoin candle request failed for %s %s: %s", symbol, interval, exc)
        return None
    normalized = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 7:
            continue
        try:
            open_time = int(float(row[0]))
            normalized.append({"open_time": open_time, "open": float(row[1]), "high": float(row[2]), "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]), "quote_volume": float(row[6]), "close_time": open_time + interval_ms - 1, "trade_count": 0})
        except (TypeError, ValueError):
            continue
    if not normalized:
        return None
    frame = pd.DataFrame(normalized).drop_duplicates(subset=["open_time"]).sort_values("open_time").reset_index(drop=True)
    frame["close_time"] = frame["open_time"].shift(-1).sub(1).fillna(frame["open_time"] + interval_ms - 1).astype("int64")
    frame["open_dt"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    return frame.tail(max(1, int(total_candles))).reset_index(drop=True)


def load_journal_ohlcv(symbol: str, interval: str, *, total_candles: int, end_time: Optional[int] = None, exchange: Optional[str] = None) -> Optional[pd.DataFrame]:
    if str(exchange or "").strip().lower() == "deepcoin":
        native = fetch_deepcoin_swap_klines(symbol, interval, total_candles, end_time)
        if native is not None and not native.empty:
            return _with_source(native, "Deepcoin SWAP API", False)
    fallback = fetch_binance_klines(symbol.replace("/", ""), interval, total_candles, end_time)
    return _with_source(fallback, "Binance Spot fallback", True) if fallback is not None and not fallback.empty else None


def market_source(frame: Optional[pd.DataFrame]) -> str:
    return str(frame.attrs.get("market_source") or "Unknown market data") if frame is not None else "Unknown market data"


def is_market_fallback(frame: Optional[pd.DataFrame]) -> bool:
    return bool(frame is not None and frame.attrs.get("market_source_fallback"))
