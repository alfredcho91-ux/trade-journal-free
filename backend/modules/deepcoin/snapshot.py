"""Point-in-time indicator snapshots for imported Deepcoin events."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol, Tuple

import pandas as pd
import requests

from backend.config.settings import TIMEFRAME_TO_MINUTES
from backend.modules.journal.market_data import is_market_fallback, load_journal_ohlcv, market_source
from core.indicator_primitives import compute_vwap_standard_deviation
from core.indicator_pipelines import compute_trend_judgment_indicators
from core.vpvr import calculate_vpvr

SNAPSHOT_INTERVALS = ("1h", "2h", "4h", "1d", "1w", "1M")
SNAPSHOT_VPVR_CANDLES = {
    "1h": 240,
    "2h": 240,
    "4h": 240,
    "1d": 180,
    "1w": 180,
    "1M": 120,
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

    def stochastic_snapshot(key: str) -> Dict[str, Optional[float] | str]:
        current_k = _json_number(row.get(f"slow_stoch_{key}k"))
        current_d = _json_number(row.get(f"slow_stoch_{key}d"))
        previous_k = _json_number(previous.get(f"slow_stoch_{key}k")) if previous is not None else None
        previous_d = _json_number(previous.get(f"slow_stoch_{key}d")) if previous is not None else None
        return {
            "k": current_k,
            "d": current_d,
            "cross": _cross_label(current_k, current_d, previous_k, previous_d),
        }

    stoch_rsi_k = _json_number(row.get("stoch_rsi_k"))
    stoch_rsi_d = _json_number(row.get("stoch_rsi_d"))
    previous_stoch_rsi_k = _json_number(previous.get("stoch_rsi_k")) if previous is not None else None
    previous_stoch_rsi_d = _json_number(previous.get("stoch_rsi_d")) if previous is not None else None
    vpvr = calculate_vpvr(completed.tail(required), bin_count=SNAPSHOT_BIN_COUNT, price_range=None)
    anchored_vwap = compute_vwap_standard_deviation(completed, anchor="month", length=14)
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
            "5-3-3": stochastic_snapshot("5"),
            "10-6-6": stochastic_snapshot("10"),
            "20-12-12": stochastic_snapshot("20"),
        },
        "stoch_rsi": {
            "k": stoch_rsi_k,
            "d": stoch_rsi_d,
            "cross": _cross_label(stoch_rsi_k, stoch_rsi_d, previous_stoch_rsi_k, previous_stoch_rsi_d),
        },
        "vpvr": {
            "purpose": "volume_profile",
            "candles": required,
            "bin_count": SNAPSHOT_BIN_COUNT,
            "poc_low": poc_low,
            "poc_high": poc_high,
            "poc_mid": (poc_low + poc_high) / 2 if poc_low is not None and poc_high is not None else None,
            "value_area_low": _json_number(vpvr.get("value_area_low")),
            "value_area_high": _json_number(vpvr.get("value_area_high")),
            "vwap": _json_number(vpvr.get("vwap")),
        },
        "anchored_vwap": anchored_vwap,
    }


def build_indicator_snapshots(events: List[SnapshotEvent]) -> Dict[str, Dict[str, Any]]:
    snapshots: Dict[str, Dict[str, Any]] = {}
    events_by_market: Dict[Tuple[str, str, str], List[SnapshotEvent]] = {}
    for event in events:
        exchange = str(getattr(event, "exchange", "Deepcoin") or "Deepcoin")
        instrument_type = str(getattr(event, "instrument_type", "SWAP") or "SWAP").upper()
        events_by_market.setdefault((event.coin, exchange, instrument_type), []).append(event)

    for (coin, exchange, instrument_type), coin_events in events_by_market.items():
        frames: Dict[str, Optional[pd.DataFrame]] = {}
        latest_event_time = max(item.timestamp_ms for item in coin_events)
        for interval in SNAPSHOT_INTERVALS:
            try:
                frames[interval] = load_journal_ohlcv(
                    f"{coin}/USDT",
                    interval,
                    total_candles=snapshot_candle_count(coin_events, interval),
                    end_time=latest_event_time,
                    exchange=exchange,
                    instrument_type=instrument_type,
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
                "version": 2,
                "market_source": market_source(next((frame for frame in frames.values() if frame is not None), None)),
                "market_source_fallback": any(is_market_fallback(frame) for frame in frames.values() if frame is not None),
                "reference": f"last_completed_candle_before_{exchange.lower()}_{event.event_type}",
                "event_type": event.event_type,
                "event_time": _timestamp_to_iso(event.timestamp_ms),
                "timeframes": timeframes,
            }
            if event.event_type == "fill":
                time_key = "fill_time"
            elif event.event_type == "position_entry":
                time_key = "entry_time"
            else:
                time_key = "position_close_time"
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
