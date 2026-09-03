"""Interval-selectable, post-exit holding replay for the journal UI."""

from __future__ import annotations

import math
import threading
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

import numpy as np

from backend.config.settings import PROJECT_ROOT
from backend.modules.journal import repository
from backend.modules.journal.cache_keys import position_analysis_cache_key
from backend.modules.journal.market_data import load_journal_ohlcv, market_source
from backend.modules.journal.quality_analysis import _filter_positions_by_net_return
from backend.modules.journal.quality_market import HOLD_HORIZONS, analyze_exit_hold_results, finite, finite_timestamp
from backend.modules.journal.trade_selection import closed_positions, market_group_key
from backend.utils.cache import DataCache

EXIT_HOLD_INTERVALS = ("15m", "1h", "2h", "4h", "1d")
INTERVAL_MS = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
}
MAX_EXIT_HOLD_CANDLES = 20_000
EXIT_HOLD_CACHE_VERSION = 2
EXIT_HOLD_CACHE = DataCache(
    ttl_minutes=10,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_exit_hold"),
)
EXIT_HOLD_LOCK = threading.Lock()


def _mean(values: Iterable[Any]) -> Optional[float]:
    valid = [value for item in values if (value := finite(item)) is not None]
    return float(np.mean(valid)) if valid else None


def _hold_aggregates(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    output: Dict[str, Dict[str, Any]] = {}
    for key in ("actual", *(str(value) for value in HOLD_HORIZONS)):
        results = [
            item["hold_results"].get(key, {})
            for item in items
            if item.get("hold_results", {}).get(key, {}).get("available")
        ]
        returns = [
            value
            for result in results
            if (value := finite(result.get("return_pct"))) is not None
        ]
        losses = [value for value in returns if value < 0]
        output[key] = {
            "available_count": len(results),
            "return_sample_count": len(returns),
            "average_return_pct": _mean(returns),
            "average_r": _mean(result.get("r_multiple") for result in results),
            "r_sample_count": sum(finite(result.get("r_multiple")) is not None for result in results),
            "loss_count": len(losses),
            "loss_rate_pct": (len(losses) / len(returns) * 100) if returns else None,
            "average_loss_pct": _mean(losses),
        }
    return output


def _requested_candles(positions: List[Dict[str, Any]], interval: str) -> tuple[int, Optional[int], bool]:
    exit_times = [finite_timestamp(position.get("datetime")) for position in positions]
    valid_times = [timestamp for timestamp in exit_times if timestamp is not None]
    if not valid_times:
        return 0, None, False
    now_ms = int(np.datetime64("now", "ms").astype("int64"))
    interval_ms = INTERVAL_MS[interval]
    end_time = min(now_ms, max(valid_times) + max(HOLD_HORIZONS) * interval_ms)
    requested = math.ceil((end_time - min(valid_times)) / interval_ms) + 4
    capped = requested > MAX_EXIT_HOLD_CANDLES
    return min(MAX_EXIT_HOLD_CANDLES, max(1, requested)), end_time, capped


def _cache_key(
    start_time: int,
    end_time: int,
    interval: str,
    positions: List[Dict[str, Any]],
    min_abs_net_return_pct: float,
) -> str:
    return position_analysis_cache_key(
        f"journal_exit_hold:{interval}:return-filter:{min_abs_net_return_pct:.6f}",
        EXIT_HOLD_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        ("id", "symbol", "direction", "entry_datetime", "datetime", "entry_price", "exit_price", "r_multiple", "realized_pnl", "invested_amount", "leverage", "fee", "funding_fee", "source", "size"),
    )


def _build_item(position: Dict[str, Any], frame: Any) -> Optional[Dict[str, Any]]:
    analyzed = analyze_exit_hold_results(position, frame)
    if analyzed is None:
        return None
    return {
        "journal_id": int(position["id"]),
        "symbol": position.get("symbol"),
        "direction": position.get("direction"),
        "entry_datetime": position.get("entry_datetime"),
        "exit_datetime": position.get("datetime"),
        "hold_results": analyzed["hold_results"],
    }


def run_journal_exit_hold_analysis_service(
    start_time: int,
    end_time: int,
    interval: str = "4h",
    min_abs_net_return_pct: float = 0.0,
) -> Dict[str, Any]:
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    if interval not in EXIT_HOLD_INTERVALS:
        raise ValueError(f"Unsupported exit holding interval: {interval}")

    all_positions = closed_positions(repository.list_entries(), start_time, end_time)
    positions, return_filter = _filter_positions_by_net_return(all_positions, min_abs_net_return_pct)
    cache_key = _cache_key(start_time, end_time, interval, positions, return_filter["minimum_abs_net_return_pct"])
    cached = EXIT_HOLD_CACHE.get(cache_key)
    if cached is not None:
        return cached

    with EXIT_HOLD_LOCK:
        cached = EXIT_HOLD_CACHE.get(cache_key)
        if cached is not None:
            return cached
        warnings: List[str] = []
        sources = set()
        items: List[Dict[str, Any]] = []
        by_market: Dict[tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
        for position in positions:
            if position.get("symbol"):
                by_market[market_group_key(position)].append(position)

        for (_exchange, instrument_type, symbol), symbol_positions in by_market.items():
            requested, fetch_end_time, capped = _requested_candles(symbol_positions, interval)
            if not requested or fetch_end_time is None:
                continue
            if capped:
                warnings.append(f"{symbol} {interval}: older exit-hold observations may be unavailable")
            frame = load_journal_ohlcv(
                symbol,
                interval,
                total_candles=requested,
                end_time=fetch_end_time,
                exchange=symbol_positions[0].get("exchange"),
                instrument_type=instrument_type,
            )
            if frame is None or frame.empty:
                warnings.append(f"{symbol} {interval}: market data unavailable")
                continue
            sources.add(market_source(frame))
            for position in symbol_positions:
                if (item := _build_item(position, frame)) is not None:
                    items.append(item)

        items.sort(key=lambda item: item.get("exit_datetime") or "", reverse=True)
        direction_breakdown = {
            direction: {"hold_results": _hold_aggregates([item for item in items if item.get("direction") == direction])}
            for direction in ("Long", "Short")
        }
        result = {
            "success": True,
            "data": {
                "interval": interval,
                "market_data_sources": sorted(sources),
                "direction_breakdown": direction_breakdown,
                "items": items,
                "return_filter": return_filter,
                "warnings": sorted(set(warnings)),
            },
        }
        EXIT_HOLD_CACHE.set(cache_key, result)
        return result


__all__ = ["EXIT_HOLD_INTERVALS", "run_journal_exit_hold_analysis_service"]
