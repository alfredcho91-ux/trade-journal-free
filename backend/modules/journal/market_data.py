"""Market data source selection for journal analysis.

Each connected exchange uses its own public OHLCV endpoint first. Binance Spot
is a labelled fallback so historical analysis never silently mixes sources.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import ccxt
import pandas as pd
import requests

from backend.config.settings import TIMEFRAME_TO_MINUTES, get_deepcoin_api_base_url
from backend.utils.data_service import cached, fetch_binance_klines

logger = logging.getLogger(__name__)

_BARS = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "12h": "12H", "1d": "1D", "1w": "1W", "1M": "1M"}
_PATH = "/deepcoin/v2/market/candles"
_LIMIT = 300
_CCXT_PAGE_LIMIT = 1_000
_SUPPORTED_CCXT_EXCHANGES = {"binance", "bybit", "okx"}


def _interval_ms(interval: str) -> Optional[int]:
    minutes = TIMEFRAME_TO_MINUTES.get(interval)
    if minutes is not None:
        return minutes * 60 * 1000
    return {"1w": 7 * 24 * 60 * 60 * 1000, "1M": 31 * 24 * 60 * 60 * 1000}.get(interval)


def _candle_close_time(open_time: int, interval: str, interval_ms: int) -> int:
    if interval == "1M":
        opened = pd.Timestamp(open_time, unit="ms", tz="UTC")
        return int((opened + pd.offsets.MonthBegin(1)).timestamp() * 1000) - 1
    return open_time + interval_ms - 1


def _set_close_times(frame: pd.DataFrame, interval: str, interval_ms: int) -> None:
    close_times = frame["open_time"].shift(-1).sub(1)
    if not frame.empty:
        close_times.iloc[-1] = _candle_close_time(int(frame["open_time"].iloc[-1]), interval, interval_ms)
    frame["close_time"] = close_times.astype("int64")


def _instrument(symbol: str, instrument_type: str) -> Optional[str]:
    base, separator, quote = symbol.replace("/", "-").upper().strip().partition("-")
    if not separator or not base or not quote:
        return None
    return f"{base}-{quote}-SWAP" if instrument_type == "SWAP" else f"{base}-{quote}"


def _with_source(frame: pd.DataFrame, source: str, fallback: bool) -> pd.DataFrame:
    output = frame.copy()
    output.attrs["market_source"] = source
    output.attrs["market_source_fallback"] = fallback
    return output


@cached(ttl_seconds=30)
def fetch_deepcoin_klines(symbol: str, interval: str, total_candles: int, end_time: Optional[int] = None, instrument_type: str = "SWAP") -> Optional[pd.DataFrame]:
    bar = _BARS.get(interval)
    instrument = _instrument(symbol, instrument_type)
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
            normalized.append({"open_time": open_time, "open": float(row[1]), "high": float(row[2]), "low": float(row[3]), "close": float(row[4]), "volume": float(row[5]), "quote_volume": float(row[6]), "close_time": _candle_close_time(open_time, interval, interval_ms), "trade_count": 0})
        except (TypeError, ValueError):
            continue
    if not normalized:
        return None
    frame = pd.DataFrame(normalized).drop_duplicates(subset=["open_time"]).sort_values("open_time").reset_index(drop=True)
    _set_close_times(frame, interval, interval_ms)
    frame["open_dt"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    return frame.tail(max(1, int(total_candles))).reset_index(drop=True)


def _ccxt_client(exchange_id: str, instrument_type: str):
    class_name = "binanceusdm" if exchange_id == "binance" and instrument_type == "SWAP" else exchange_id
    exchange_class = getattr(ccxt, class_name, None)
    if exchange_class is None:
        return None
    return exchange_class({"enableRateLimit": True, "options": {"defaultType": "swap" if instrument_type == "SWAP" else "spot"}})


def _ccxt_symbol(client, symbol: str, instrument_type: str) -> Optional[str]:
    base, separator, quote = symbol.replace("-", "/").upper().partition("/")
    if not separator or not base or not quote:
        return None
    for market in client.markets.values():
        if str(market.get("base") or "").upper() != base or str(market.get("quote") or "").upper() != quote:
            continue
        if instrument_type == "SWAP" and market.get("swap") and market.get("linear", True):
            return str(market.get("symbol"))
        if instrument_type == "SPOT" and market.get("spot"):
            return str(market.get("symbol"))
    return None


@cached(ttl_seconds=30)
def fetch_exchange_klines(exchange_id: str, symbol: str, interval: str, total_candles: int, end_time: Optional[int] = None, instrument_type: str = "SWAP") -> Optional[pd.DataFrame]:
    if exchange_id not in _SUPPORTED_CCXT_EXCHANGES or interval not in TIMEFRAME_TO_MINUTES:
        return None
    client = _ccxt_client(exchange_id, instrument_type)
    if client is None:
        return None
    try:
        client.load_markets()
        market_symbol = _ccxt_symbol(client, symbol, instrument_type)
        interval_ms = _interval_ms(interval)
        if market_symbol is None or interval_ms is None:
            return None
        target = max(1, int(total_candles))
        cursor = (int(end_time) if end_time is not None else int(time.time() * 1000)) - target * interval_ms
        rows = []
        while len(rows) < target:
            limit = min(_CCXT_PAGE_LIMIT, target - len(rows))
            page = client.fetch_ohlcv(market_symbol, timeframe=interval, since=cursor, limit=limit)
            if not page:
                break
            rows.extend(page)
            next_cursor = int(page[-1][0]) + interval_ms
            if next_cursor <= cursor or len(page) < limit:
                break
            cursor = next_cursor
        if not rows:
            return None
        frame = pd.DataFrame(rows, columns=["open_time", "open", "high", "low", "close", "volume"])
        frame = frame.drop_duplicates(subset=["open_time"]).sort_values("open_time").tail(target).reset_index(drop=True)
        frame["quote_volume"] = frame["close"] * frame["volume"]
        _set_close_times(frame, interval, interval_ms)
        frame["open_dt"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
        frame["trade_count"] = 0
        return frame
    except (ccxt.BaseError, TypeError, ValueError) as exc:
        logger.info("%s candle request failed for %s %s: %s", exchange_id, symbol, interval, exc)
        return None
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def load_journal_ohlcv(symbol: str, interval: str, *, total_candles: int, end_time: Optional[int] = None, exchange: Optional[str] = None, instrument_type: str = "SWAP") -> Optional[pd.DataFrame]:
    exchange_id = str(exchange or "").strip().lower()
    normalized_type = "SPOT" if str(instrument_type).upper() == "SPOT" else "SWAP"
    if exchange_id == "deepcoin":
        native = fetch_deepcoin_klines(symbol, interval, total_candles, end_time, normalized_type)
        if native is not None and not native.empty:
            return _with_source(native, f"Deepcoin {normalized_type} API", False)
    elif exchange_id in _SUPPORTED_CCXT_EXCHANGES:
        native = fetch_exchange_klines(exchange_id, symbol, interval, total_candles, end_time, normalized_type)
        if native is not None and not native.empty:
            return _with_source(native, f"{exchange_id.title()} {normalized_type} API", False)
    fallback = fetch_binance_klines(symbol.replace("/", ""), interval, total_candles, end_time)
    return _with_source(fallback, "Binance Spot fallback", True) if fallback is not None and not fallback.empty else None


def market_source(frame: Optional[pd.DataFrame]) -> str:
    return str(frame.attrs.get("market_source") or "Unknown market data") if frame is not None else "Unknown market data"


def is_market_fallback(frame: Optional[pd.DataFrame]) -> bool:
    return bool(frame is not None and frame.attrs.get("market_source_fallback"))
