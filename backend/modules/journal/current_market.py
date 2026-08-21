"""Current point-in-time market snapshot for journal similarity analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import pandas as pd

from backend.config.settings import PROJECT_ROOT
from backend.modules.deepcoin.snapshot import (
    SNAPSHOT_INTERVALS,
    indicator_snapshot_for_event,
)
from backend.modules.journal.quality_market import (
    TREND_INTERVALS,
    classify_market_regime,
    point_in_time_trend_state,
    prepare_quality_frame,
)
from backend.utils.cache import DataCache
from backend.utils.data_service import fetch_binance_klines
from backend.utils.error_handler import DataLoadError
from backend.utils.validators import validate_coin_symbol

CURRENT_MARKET_CACHE = DataCache(
    ttl_minutes=65,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_current_market"),
)
CURRENT_FRAME_CANDLES = {
    "1h": 245,
    "2h": 245,
    "4h": 245,
    "1d": 245,
    "1w": 205,
}


@dataclass(frozen=True)
class _CurrentMarketEvent:
    external_id: str
    timestamp_ms: int
    coin: str
    event_type: str = "current_market"


def _timestamp_to_iso(timestamp_ms: int) -> str:
    return (
        datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _current_hour_key(coin: str, as_of_ms: int) -> str:
    hour = pd.Timestamp(as_of_ms, unit="ms", tz="UTC").floor("h").isoformat()
    return f"v1:{coin}:{hour}"


def build_current_market_snapshot(coin: str, as_of_ms: int) -> Dict[str, Any]:
    """Build indicators and trend states using candles completed before ``as_of_ms``."""
    normalized_coin = validate_coin_symbol(coin)
    symbol = f"{normalized_coin}USDT"
    event = _CurrentMarketEvent(
        external_id=f"current:{normalized_coin}:{as_of_ms}",
        timestamp_ms=as_of_ms,
        coin=normalized_coin,
    )
    frames: Dict[str, pd.DataFrame] = {}
    warnings = []

    for interval, candle_count in CURRENT_FRAME_CANDLES.items():
        frame = fetch_binance_klines(
            symbol,
            interval,
            total_candles=candle_count,
            end_time=as_of_ms,
        )
        if frame is None or frame.empty:
            warnings.append(f"{normalized_coin} {interval}: market data unavailable")
            continue
        frames[interval] = frame

    indicator_timeframes: Dict[str, Dict[str, Any]] = {}
    for interval in SNAPSHOT_INTERVALS:
        frame = frames.get(interval)
        if frame is None:
            indicator_timeframes[interval] = {
                "status": "unavailable",
                "reason": "market_data_unavailable",
            }
            continue
        try:
            indicator_timeframes[interval] = indicator_snapshot_for_event(frame, event, interval)
        except (KeyError, TypeError, ValueError):
            indicator_timeframes[interval] = {
                "status": "unavailable",
                "reason": "calculation_failed",
            }

    trend_states: Dict[str, Dict[str, Any]] = {}
    previous_4h_direction = "unavailable"
    for interval in TREND_INTERVALS:
        frame = frames.get(interval)
        if frame is None:
            trend_states[interval] = {
                "status": "unavailable",
                "reason": "market_data_unavailable",
            }
            continue
        try:
            state, previous_direction = point_in_time_trend_state(
                prepare_quality_frame(frame),
                as_of_ms,
            )
            trend_states[interval] = state
            if interval == "4h":
                previous_4h_direction = previous_direction
        except (KeyError, TypeError, ValueError):
            trend_states[interval] = {
                "status": "unavailable",
                "reason": "calculation_failed",
            }

    if not any(state.get("status") == "complete" for state in indicator_timeframes.values()):
        raise DataLoadError("Current Binance indicator data is temporarily unavailable")

    return {
        "success": True,
        "data": {
            "symbol": f"{normalized_coin}/USDT",
            "as_of": _timestamp_to_iso(as_of_ms),
            "indicator_snapshot": {
                "version": 1,
                "market_source": "binance_spot_klines",
                "reference": "last_completed_candle_before_current_hour_refresh",
                "event_type": "current_market",
                "event_time": _timestamp_to_iso(as_of_ms),
                "timeframes": indicator_timeframes,
            },
            "trend_states": trend_states,
            "market_regime": classify_market_regime(trend_states, previous_4h_direction),
            "warnings": sorted(set(warnings)),
        },
    }


def run_current_market_snapshot_service(
    coin: str,
    as_of_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """Return one hourly-cached snapshot for the selected market."""
    normalized_coin = validate_coin_symbol(coin)
    effective_as_of = as_of_ms or int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    cache_key = _current_hour_key(normalized_coin, effective_as_of)
    cached = CURRENT_MARKET_CACHE.get(cache_key)
    if cached is not None:
        return cached

    result = build_current_market_snapshot(normalized_coin, effective_as_of)
    CURRENT_MARKET_CACHE.set(cache_key, result)
    return result


__all__ = ["build_current_market_snapshot", "run_current_market_snapshot_service"]
