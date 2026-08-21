"""Point-in-time indicator snapshots for imported Deepcoin events."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol

import pandas as pd
import requests

from backend.config.settings import TIMEFRAME_TO_MINUTES
from backend.utils.data_service import fetch_binance_klines
from core.indicator_pipelines import compute_trend_judgment_indicators
from core.vpvr import calculate_vpvr

SNAPSHOT_INTERVALS = ("1h", "2h", "4h", "1d")
SNAPSHOT_VPVR_CANDLES = {
    "1h": 240,
    "2h": 240,
    "4h": 240,
    "1d": 180,
}
SNAPSHOT_BIN_COUNT = 24


class SnapshotEvent(Protocol):
    external_id: str
    timestamp_ms: int
    coin: str
    event_type: str


def _timestamp_to_iso(timestamp_ms: int) -> str:
    return (
        datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _json_number(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def snapshot_candle_count(events: List[SnapshotEvent], interval: str) -> int:
    if not events:
        return SNAPSHOT_VPVR_CANDLES[interval]
    span_ms = max(item.timestamp_ms for item in events) - min(item.timestamp_ms for item in events)
    interval_ms = TIMEFRAME_TO_MINUTES[interval] * 60 * 1000
    return SNAPSHOT_VPVR_CANDLES[interval] + math.ceil(span_ms / interval_ms) + 4


def _cross_label(
    current: Optional[float],
    signal: Optional[float],
    previous: Optional[float],
    previous_signal: Optional[float],
) -> str:
    if None in (current, signal, previous, previous_signal):
        return "none"
    if previous <= previous_signal and current > signal:
        return "golden"
    if previous >= previous_signal and current < signal:
        return "dead"
    return "none"


def indicator_snapshot_for_event(
    candles: pd.DataFrame,
    event: SnapshotEvent,
    interval: str,
) -> Dict[str, Any]:
    completed = candles.loc[candles["close_time"] < event.timestamp_ms].copy()
    required = SNAPSHOT_VPVR_CANDLES[interval]
    if len(completed) < required:
        return {"status": "unavailable", "reason": "insufficient_completed_candles"}

    indicators = compute_trend_judgment_indicators(completed)
    row = indicators.iloc[-1]
    previous = indicators.iloc[-2] if len(indicators) > 1 else None
    macd = _json_number(row.get("macd"))
    macd_signal = _json_number(row.get("macd_signal"))
    previous_macd = _json_number(previous.get("macd")) if previous is not None else None
    previous_signal = _json_number(previous.get("macd_signal")) if previous is not None else None
    vpvr = calculate_vpvr(completed.tail(required), bin_count=SNAPSHOT_BIN_COUNT, price_range=None)
    poc_low = _json_number(vpvr.get("poc_price_low"))
    poc_high = _json_number(vpvr.get("poc_price_high"))

    return {
        "status": "complete",
        "candle_close_time": _timestamp_to_iso(int(row["close_time"])),
        "close": _json_number(row.get("close")),
        "rsi": _json_number(row.get("rsi")),
        "macd": {
            "line": macd,
            "signal": macd_signal,
            "histogram": _json_number(row.get("macd_hist")),
            "cross": _cross_label(macd, macd_signal, previous_macd, previous_signal),
        },
        "slow_stochastic": {
            "5-3-3": {"k": _json_number(row.get("slow_stoch_5k")), "d": _json_number(row.get("slow_stoch_5d"))},
            "10-6-6": {"k": _json_number(row.get("slow_stoch_10k")), "d": _json_number(row.get("slow_stoch_10d"))},
            "20-12-12": {"k": _json_number(row.get("slow_stoch_20k")), "d": _json_number(row.get("slow_stoch_20d"))},
        },
        "stoch_rsi": {
            "k": _json_number(row.get("stoch_rsi_k")),
            "d": _json_number(row.get("stoch_rsi_d")),
        },
        "vpvr": {
            "candles": required,
            "bin_count": SNAPSHOT_BIN_COUNT,
            "poc_low": poc_low,
            "poc_high": poc_high,
            "poc_mid": (poc_low + poc_high) / 2 if poc_low is not None and poc_high is not None else None,
            "value_area_low": _json_number(vpvr.get("value_area_low")),
            "value_area_high": _json_number(vpvr.get("value_area_high")),
            "vwap": _json_number(vpvr.get("vwap")),
        },
    }


def build_indicator_snapshots(events: List[SnapshotEvent]) -> Dict[str, Dict[str, Any]]:
    snapshots: Dict[str, Dict[str, Any]] = {}
    events_by_coin: Dict[str, List[SnapshotEvent]] = {}
    for event in events:
        events_by_coin.setdefault(event.coin, []).append(event)

    for coin, coin_events in events_by_coin.items():
        frames: Dict[str, Optional[pd.DataFrame]] = {}
        latest_event_time = max(item.timestamp_ms for item in coin_events)
        for interval in SNAPSHOT_INTERVALS:
            try:
                frames[interval] = fetch_binance_klines(
                    f"{coin}USDT",
                    interval,
                    total_candles=snapshot_candle_count(coin_events, interval),
                    end_time=latest_event_time,
                )
            except (ValueError, requests.RequestException):
                frames[interval] = None

        for event in coin_events:
            timeframes: Dict[str, Any] = {}
            for interval in SNAPSHOT_INTERVALS:
                frame = frames.get(interval)
                if frame is None or frame.empty:
                    timeframes[interval] = {"status": "unavailable", "reason": "market_data_unavailable"}
                    continue
                try:
                    timeframes[interval] = indicator_snapshot_for_event(frame, event, interval)
                except (KeyError, TypeError, ValueError):
                    timeframes[interval] = {"status": "unavailable", "reason": "calculation_failed"}

            snapshots[event.external_id] = {
                "version": 1,
                "market_source": "binance_spot_klines",
                "reference": f"last_completed_candle_before_deepcoin_{event.event_type}",
                "event_type": event.event_type,
                "event_time": _timestamp_to_iso(event.timestamp_ms),
                "timeframes": timeframes,
            }
            time_key = "fill_time" if event.event_type == "fill" else "position_close_time"
            snapshots[event.external_id][time_key] = _timestamp_to_iso(event.timestamp_ms)
    return snapshots


__all__ = [
    "SNAPSHOT_BIN_COUNT",
    "SNAPSHOT_INTERVALS",
    "SNAPSHOT_VPVR_CANDLES",
    "build_indicator_snapshots",
    "indicator_snapshot_for_event",
    "snapshot_candle_count",
]
