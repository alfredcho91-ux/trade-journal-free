# utils/data_service.py
"""
Data service functions for fetching market data
This is a standalone version without Streamlit dependencies
"""

import pandas as pd
import numpy as np
from pathlib import Path
import re
import ccxt
import time
import requests
import logging
import hashlib
import json
from functools import wraps
from typing import Any, Optional, Sequence

from backend.utils.cache import DataCache

# 로깅 설정
logger = logging.getLogger(__name__)

# ───────────────── Constants ─────────────────
BINANCE_TFS = [
    "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "8h",
    "12h", "1d", "3d", "1w", "1M"
]
MARKET_TICKER_SYMBOLS = ("BTC/USDT", "ETH/USDT", "SOL/USDT")

# Binance USDT-M kline payload indexes.  ``volume`` is the canonical OHLCV
# volume field; the remaining volume fields stay available for consumers that
# need exchange-specific context such as VPVR.
BINANCE_USDT_M_KLINE_COLUMNS = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trade_count",
    "taker_buy_base_volume",
    "taker_buy_quote_volume",
    "ignore",
)

BASE_DIR = Path(__file__).parent.parent.parent / "binance_klines"


def _tf_weight(tf: str) -> int:
    """Calculate weight for timeframe sorting"""
    try:
        num = int(tf[:-1])
        unit = tf[-1]
        mult = {"m": 1, "h": 60, "d": 1440, "w": 10080, "M": 43200}
        return num * mult[unit]
    except (ValueError, KeyError, TypeError):
        return 10**9


# Data service cache directory and marker for cached None values
_CACHE_BASE_DIR = Path(__file__).parent.parent.parent / ".cache" / "data_service"
_CACHE_WRAPPER_MARK = "__cache_wrapper_v2__"


def cached(ttl_seconds: int):
    """TTL cache decorator backed by DataCache (diskcache or memory fallback)."""
    def decorator(func):
        cache = DataCache(
            ttl_seconds=ttl_seconds,
            cache_dir=str(_CACHE_BASE_DIR / func.__name__),
        )

        @wraps(func)
        def wrapper(*args, **kwargs):
            payload = json.dumps(
                {"args": args, "kwargs": kwargs},
                sort_keys=True,
                default=str,
            )
            cache_key = f"{func.__name__}:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"

            cached_entry = cache.get(cache_key)
            if isinstance(cached_entry, dict) and cached_entry.get(_CACHE_WRAPPER_MARK):
                return cached_entry.get("value")

            result = func(*args, **kwargs)
            cache.set(cache_key, {_CACHE_WRAPPER_MARK: True, "value": result})
            return result

        return wrapper

    return decorator


@cached(ttl_seconds=5)
def discover_timeframes(coin_name: str, base_dir: Path = BASE_DIR):
    """Discover available timeframes from CSV files"""
    csv_tfs = set()
    try:
        if base_dir.exists():
            for p in base_dir.glob(f"{coin_name}USDT-*-merged.csv"):
                m = re.match(rf"^{coin_name}USDT-(.+?)-merged\.csv$", p.name, re.I)
                if m:
                    csv_tfs.add(m.group(1))
    except OSError as exc:
        logger.warning("Failed to scan timeframe CSV files for %s: %s", coin_name, exc)

    all_tfs = sorted(set(BINANCE_TFS) | csv_tfs, key=_tf_weight)
    return all_tfs, set(BINANCE_TFS), sorted(csv_tfs, key=_tf_weight)


@cached(ttl_seconds=300)
def get_fear_and_greed_index():
    """Get Fear & Greed Index from alternative.me API"""
    try:
        r = requests.get("https://api.alternative.me/fng/", timeout=5)
        r.raise_for_status()
        payload = r.json()
        return payload["data"][0]
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
        logger.debug("Fear & Greed API unavailable: %s", exc)
        return None


@cached(ttl_seconds=30)
def get_market_prices():
    """Get market prices from Binance"""
    try:
        ex = ccxt.binance()
        return ex.fetch_tickers(list(MARKET_TICKER_SYMBOLS))
    except ccxt.BaseError as exc:
        logger.debug("Binance ticker API unavailable: %s", exc)
        return None


def fetch_live_data(symbol: str, timeframe: str, limit: int = 1000, total_candles: int = 3000):
    """Compatibility wrapper for the single Binance REST OHLCV source.

    ``limit`` used to control CCXT page sizes. Binance REST pagination is
    bounded internally, so it remains only to avoid breaking existing callers.
    """
    _ = limit
    effective_candles = min(total_candles, 300) if timeframe == "1w" else total_candles
    return fetch_binance_klines(symbol, timeframe, total_candles=effective_candles)


@cached(ttl_seconds=30)
def fetch_binance_klines(
    symbol: str,
    timeframe: str,
    total_candles: int = 1000,
    end_time: Optional[int] = None,
):
    """Fetch Binance USDT-M Futures klines with bounded, backwards pagination.

    ``end_time`` is a Unix timestamp in milliseconds.  It permits historical
    point-in-time analyses without changing the recent-candle callers.
    """
    if timeframe not in BINANCE_TFS:
        raise ValueError(f"Unsupported Binance interval: {timeframe}")

    normalized_symbol = symbol.replace("/", "").upper()
    requested_candles = max(1, int(total_candles))
    remaining = requested_candles
    cursor_end_time = int(end_time) if end_time is not None else None
    rows = []

    try:
        while remaining > 0:
            params = {
                "symbol": normalized_symbol,
                "interval": timeframe,
                "limit": min(1000, remaining),
            }
            if cursor_end_time is not None:
                params["endTime"] = cursor_end_time

            response = requests.get(
                "https://fapi.binance.com/fapi/v1/klines",
                params=params,
                timeout=10,
            )
            response.raise_for_status()
            batch = response.json()
            if not isinstance(batch, list):
                logger.warning("Unexpected Binance Kline response for %s %s", normalized_symbol, timeframe)
                return None
            if not batch:
                break

            rows = batch + rows
            remaining -= len(batch)
            cursor_end_time = int(batch[0][0]) - 1
            if len(batch) < params["limit"]:
                break
            if remaining > 0:
                time.sleep(0.1)

        if not rows:
            return None

        return normalize_binance_usdt_m_klines(rows, requested_candles)
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning("Binance Kline request failed for %s %s: %s", normalized_symbol, timeframe, exc)
        return None


def normalize_binance_usdt_m_klines(
    rows: Sequence[Sequence[Any]],
    requested_candles: int,
) -> Optional[pd.DataFrame]:
    """Normalize raw Binance USDT-M klines without inventing volume values.

    Binance normally supplies all canonical OHLCV values.  If a malformed raw
    row has no numeric volume, the candle is unavailable and is excluded rather
    than being converted to a zero-volume candle.  A genuine numeric ``0``
    remains a valid value and is preserved.
    """
    if not rows:
        return None

    df = pd.DataFrame(rows, columns=BINANCE_USDT_M_KLINE_COLUMNS)
    df.drop_duplicates(subset=["open_time"], inplace=True)
    df.sort_values("open_time", inplace=True)
    df = df.tail(max(1, int(requested_candles))).reset_index(drop=True)

    int_columns = ["open_time", "close_time", "trade_count"]
    float_columns = [
        "open",
        "high",
        "low",
        "close",
        "volume",
        "quote_volume",
        "taker_buy_base_volume",
        "taker_buy_quote_volume",
    ]
    for column in int_columns + float_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    unavailable_volume = df["volume"].isna()
    missing_volume_close_times = [
        int(value)
        for value in df.loc[unavailable_volume, "close_time"].tolist()
        if pd.notna(value)
    ]
    if unavailable_volume.any():
        logger.warning(
            "Discarding %s Binance USDT-M kline(s) with unavailable volume",
            int(unavailable_volume.sum()),
        )
    df.dropna(subset=["open_time", "open", "high", "low", "close", "volume"], inplace=True)
    if df.empty:
        return None
    df["open_time"] = df["open_time"].astype("int64")
    df["close_time"] = df["close_time"].astype("int64")
    df["trade_count"] = df["trade_count"].astype("int64")
    df["open_dt"] = pd.to_datetime(df["open_time"], unit="ms")
    result = df.reset_index(drop=True)
    # Keep malformed-volume candle identities out of every existing indicator
    # input while retaining enough point-in-time metadata for RVOL20 to reject
    # an incomplete 20+1 volume window instead of silently shifting backwards.
    result.attrs["missing_volume_close_times"] = missing_volume_close_times
    return result


def load_csv_data(coin_name: str, interval: str, base_dir: Path = BASE_DIR):
    """Load historical data from local CSV files"""
    # coin_name에서 USDT 접미사 제거 (중복 방지)
    coin_name = coin_name.replace("USDT", "").replace("usdt", "")

    # interval 매핑 (API 표기 → CSV 파일명 표기)
    interval_map = {
        "1M": "1mo",  # 월봉: API는 1M, CSV는 1mo
    }
    csv_interval = interval_map.get(interval, interval)

    fp = base_dir / f"{coin_name}USDT-{csv_interval}-merged.csv"

    if not fp.exists():
        return None, str(fp)

    try:
        df = pd.read_csv(fp)
        df.columns = df.columns.str.strip().str.lower()

        ot = pd.to_numeric(df["open_time"], errors="coerce")
        if (ot > 2_000_000_000_000).any():
            ot = np.where(ot > 2_000_000_000_000, ot // 1000, ot)

        df["open_time"] = ot
        df["open_dt"] = pd.to_datetime(df["open_time"], unit="ms")
        df.sort_values("open_dt", inplace=True)
        df.reset_index(drop=True, inplace=True)
        return df, "CSV file"
    except (OSError, pd.errors.ParserError, ValueError, KeyError) as exc:
        logger.warning("Failed to load CSV data from %s: %s", fp, exc)
        return None, "Error"
