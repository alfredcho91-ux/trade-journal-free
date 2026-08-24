"""Shared market-frame loading for journal analyses."""

from __future__ import annotations

import math
from typing import Any, Dict, List

import numpy as np

from backend.modules.journal.quality_market import TREND_INTERVALS, finite_timestamp, prepare_quality_frame
from backend.modules.journal.market_data import load_journal_ohlcv, market_source

INTERVAL_MS = {"4h": 4 * 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000, "1w": 7 * 24 * 60 * 60 * 1000}
WARMUP_CANDLES = 230
MAX_MARKET_CANDLES = 5_000


def requested_candles(positions: List[Dict[str, Any]], interval: str) -> int:
    entry_times = [finite_timestamp(item.get("entry_datetime")) for item in positions]
    close_times = [finite_timestamp(item.get("datetime")) for item in positions]
    valid_entries = [value for value in entry_times if value is not None]
    valid_closes = [value for value in close_times if value is not None]
    if not valid_entries or not valid_closes:
        return WARMUP_CANDLES
    span = max(valid_closes) + 10 * INTERVAL_MS["4h"] - min(valid_entries)
    return min(MAX_MARKET_CANDLES, WARMUP_CANDLES + math.ceil(max(0, span) / INTERVAL_MS[interval]))


def load_market_frames(symbol: str, positions: List[Dict[str, Any]], warnings: List[str], instrument_type: str = "SWAP") -> Dict[str, Any]:
    frames: Dict[str, Any] = {}
    latest_close = max(finite_timestamp(item.get("datetime")) or 0 for item in positions)
    analysis_end = min(
        int(np.datetime64("now", "ms").astype("int64")),
        latest_close + 10 * INTERVAL_MS["4h"],
    )
    for interval in TREND_INTERVALS:
        frame = load_journal_ohlcv(
            symbol,
            interval,
            total_candles=requested_candles(positions, interval),
            end_time=analysis_end,
            exchange=positions[0].get("exchange"),
            instrument_type=instrument_type,
        )
        if frame is None or frame.empty:
            warnings.append(f"{symbol} {interval}: market data unavailable")
            continue
        frames[interval] = prepare_quality_frame(frame)
        frames[interval].attrs["market_source"] = market_source(frame)
        frames[interval].attrs["market_source_fallback"] = False
    return frames
