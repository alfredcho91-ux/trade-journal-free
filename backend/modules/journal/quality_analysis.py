"""Trade-quality orchestration and aggregate statistics."""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

import numpy as np

from backend.modules.journal import repository
from backend.modules.journal.analysis import run_journal_excursions_service
from backend.modules.journal.cache_keys import position_analysis_cache_key
from backend.modules.journal.market_context import load_market_frames
from backend.modules.journal.trade_selection import closed_positions
from backend.modules.journal.quality_market import (
    HOLD_HORIZONS,
    TREND_INTERVALS,
    analyze_exit_quality,
    classify_market_regime,
    finite,
    finite_timestamp,
    point_in_time_trend_state,
    trade_alignment,
)
from backend.config.settings import PROJECT_ROOT
from backend.utils.cache import DataCache

MIN_REGIME_CONCLUSION_SAMPLE = 5
QUALITY_ANALYSIS_CACHE_VERSION = 5
QUALITY_ANALYSIS_CACHE = DataCache(
    ttl_minutes=10,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_quality"),
)
QUALITY_ANALYSIS_LOCK = threading.Lock()


def _mean(values: Iterable[Any]) -> Optional[float]:
    valid = [value for item in values if (value := finite(item)) is not None]
    return float(np.mean(valid)) if valid else None


def _percentile(values: Iterable[Any], percentile: float) -> Optional[float]:
    valid = [value for item in values if (value := finite(item)) is not None]
    return float(np.percentile(valid, percentile)) if valid else None


def _sample_quality(count: int) -> str:
    return "high" if count >= 30 else "medium" if count >= 10 else "low"


def _performance_stats(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    pnls = [value for item in items if (value := finite(item.get("realized_pnl"))) is not None]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    gross_loss = abs(sum(losses))
    r_values = [value for item in items if (value := finite(item.get("r_multiple"))) is not None]
    early_count = sum(item.get("quality_class") == "good_entry_early_exit" for item in items)
    late_count = sum(item.get("quality_class") == "good_entry_late_exit" for item in items)
    return {
        "trade_count": len(items),
        "total_pnl": float(sum(pnls)) if pnls else None,
        "win_rate_pct": len(wins) / len(pnls) * 100 if pnls else None,
        "average_r": float(np.mean(r_values)) if r_values else None,
        "r_sample_count": len(r_values),
        "average_pnl": float(np.mean(pnls)) if pnls else None,
        "profit_factor": sum(wins) / gross_loss if gross_loss > 0 else None,
        "average_mfe_pct": _mean(item.get("excursion", {}).get("mfe_pct") for item in items),
        "average_mae_pct": _mean(item.get("excursion", {}).get("mae_pct") for item in items),
        "average_holding_minutes": _mean(item.get("holding_minutes") for item in items),
        "early_exit_ratio_pct": early_count / len(items) * 100 if items else None,
        "late_exit_ratio_pct": late_count / len(items) * 100 if items else None,
        "average_capture_ratio_pct": _mean(item.get("exit_quality", {}).get("capture_ratio_pct") for item in items),
        "sample_quality": _sample_quality(len(items)),
    }


def _hold_aggregates(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    output: Dict[str, Dict[str, Any]] = {}
    for key in ("actual", *(str(value) for value in HOLD_HORIZONS)):
        results = [
            result
            for item in items
            if (result := item.get("exit_quality", {}).get("hold_results", {}).get(key, {})).get("available")
        ]
        output[key] = {
            "available_count": len(results),
            "average_return_pct": _mean(result.get("return_pct") for result in results),
            "average_r": _mean(result.get("r_multiple") for result in results),
            "r_sample_count": sum(finite(result.get("r_multiple")) is not None for result in results),
        }
    return output


def _strategy_aggregates(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    strategy_ids = sorted({
        strategy_id
        for item in items
        for strategy_id in item.get("exit_quality", {}).get("virtual_exits", {})
    })
    output: Dict[str, Dict[str, Any]] = {}
    for strategy_id in strategy_ids:
        results = [
            result
            for item in items
            if (result := item.get("exit_quality", {}).get("virtual_exits", {}).get(strategy_id, {})).get("available")
        ]
        output[strategy_id] = {
            "triggered_count": len(results),
            "eligible_count": len(items),
            "trigger_rate_pct": len(results) / len(items) * 100 if items else None,
            "average_return_pct": _mean(result.get("return_pct") for result in results),
            "average_r": _mean(result.get("r_multiple") for result in results),
            "r_sample_count": sum(finite(result.get("r_multiple")) is not None for result in results),
        }
    return output


def _best_exit_method(items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for horizon, aggregate in _hold_aggregates(items).items():
        if aggregate["available_count"] >= 3 and aggregate["average_return_pct"] is not None:
            candidates.append({"type": "hold", "id": horizon, **aggregate})
    for strategy_id, aggregate in _strategy_aggregates(items).items():
        if aggregate["triggered_count"] >= 3 and aggregate["average_return_pct"] is not None:
            candidates.append({"type": "strategy", "id": strategy_id, **aggregate})
    return max(candidates, key=lambda item: item["average_return_pct"]) if candidates else None


def _quality_thresholds(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "method": "selected_period_distribution",
        "mfe_low_pct": _percentile((item.get("excursion", {}).get("mfe_pct") for item in items), 25),
        "mae_typical_pct": _percentile((item.get("excursion", {}).get("mae_pct") for item in items), 50),
        "post_exit_high_pct": _percentile((item.get("exit_quality", {}).get("additional_profit_potential_pct") for item in items), 75),
        "give_up_high_pct": _percentile((item.get("exit_quality", {}).get("profit_give_up_pct") for item in items), 75),
        "capture_typical_pct": _percentile((item.get("exit_quality", {}).get("capture_ratio_pct") for item in items), 50),
    }


def _assign_quality_classes(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    thresholds = _quality_thresholds(items)
    required = [thresholds[key] for key in ("mfe_low_pct", "mae_typical_pct", "post_exit_high_pct", "give_up_high_pct", "capture_typical_pct")]
    for item in items:
        excursion = item.get("excursion") or {}
        exit_quality = item.get("exit_quality") or {}
        mfe = finite(excursion.get("mfe_pct"))
        mae = finite(excursion.get("mae_pct"))
        realized = finite(excursion.get("realized_move_pct"))
        post = finite(exit_quality.get("additional_profit_potential_pct"))
        give_up = finite(exit_quality.get("profit_give_up_pct"))
        capture = finite(exit_quality.get("capture_ratio_pct"))
        if None in (mfe, mae, realized, post, give_up, capture) or any(value is None for value in required):
            item["quality_class"] = "unavailable"
            continue
        poor_entry = (mfe <= thresholds["mfe_low_pct"] and mae >= thresholds["mae_typical_pct"]) or (mae > mfe and realized <= 0)
        if poor_entry:
            item["quality_class"] = "poor_entry"
        elif post >= thresholds["post_exit_high_pct"] and capture <= thresholds["capture_typical_pct"]:
            item["quality_class"] = "good_entry_early_exit"
        elif give_up >= thresholds["give_up_high_pct"] and give_up > post:
            item["quality_class"] = "good_entry_late_exit"
        else:
            item["quality_class"] = "good_entry_good_exit"
    return thresholds


def _group_stats(items: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[str(item.get(key) or "unavailable")].append(item)
    return [
        {"id": group_id, **_performance_stats(group_items)}
        for group_id, group_items in sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0]))
    ]


def _regime_stats(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[item["market_regime"]["id"]].append(item)
    output = []
    for regime_id, group_items in grouped.items():
        output.append({
            "id": regime_id,
            "alignment": group_items[0]["market_regime"]["alignment"],
            "trade_bias": group_items[0]["market_regime"]["trade_bias"],
            **_performance_stats(group_items),
            "hold_results": _hold_aggregates(group_items),
            "best_exit_method": _best_exit_method(group_items),
        })
    return sorted(output, key=lambda item: (-item["trade_count"], item["id"]))


def _analysis_bundle(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate one comparable slice while preserving shared quality thresholds."""
    performance = _performance_stats(items)
    regimes = _regime_stats(items)
    eligible_regimes = [
        item
        for item in regimes
        if item["trade_count"] >= MIN_REGIME_CONCLUSION_SAMPLE and item["average_pnl"] is not None
    ]
    quality_counts = {
        quality: sum(item["quality_class"] == quality for item in items)
        for quality in (
            "good_entry_good_exit",
            "good_entry_early_exit",
            "good_entry_late_exit",
            "poor_entry",
            "unavailable",
        )
    }
    analyzed_count = len(items) - quality_counts["unavailable"]
    exit_issues = quality_counts["good_entry_early_exit"] + quality_counts["good_entry_late_exit"]
    issue_balance = "insufficient_data"
    if analyzed_count:
        issue_balance = (
            "entry"
            if quality_counts["poor_entry"] > exit_issues
            else "exit"
            if exit_issues > quality_counts["poor_entry"]
            else "balanced"
        )

    return {
        "summary": {
            **performance,
            "best_regime": max(eligible_regimes, key=lambda item: item["average_pnl"]) if eligible_regimes else None,
            "worst_regime": min(eligible_regimes, key=lambda item: item["average_pnl"]) if eligible_regimes else None,
            "quality_counts": quality_counts,
            "early_exit_ratio_pct": quality_counts["good_entry_early_exit"] / analyzed_count * 100 if analyzed_count else None,
            "late_exit_ratio_pct": quality_counts["good_entry_late_exit"] / analyzed_count * 100 if analyzed_count else None,
            "average_capture_ratio_pct": _mean(
                item.get("exit_quality", {}).get("capture_ratio_pct") for item in items
            ),
            "issue_balance": issue_balance,
            "r_available_count": sum(
                item.get("exit_quality", {}).get("r_available") is True for item in items
            ),
        },
        "regimes": regimes,
        "alignment_stats": _group_stats(items, "regime_alignment"),
        "trade_alignment_stats": _group_stats(items, "trade_alignment"),
        "hold_results": _hold_aggregates(items),
        "virtual_exit_strategies": _strategy_aggregates(items),
    }


def _direction_breakdown(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {
        direction: _analysis_bundle([item for item in items if item.get("direction") == direction])
        for direction in ("Long", "Short")
    }


def _analysis_cache_key(start_time: int, end_time: int, positions: List[Dict[str, Any]]) -> str:
    return position_analysis_cache_key(
        "journal_quality",
        QUALITY_ANALYSIS_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        (
            "id",
            "symbol",
            "direction",
            "entry_datetime",
            "datetime",
            "entry_price",
            "exit_price",
            "realized_pnl",
            "r_multiple",
        ),
    )


def _build_item(
    entry: Dict[str, Any],
    frames: Dict[str, Any],
    excursion: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    entry_time = finite_timestamp(entry.get("entry_datetime"))
    exit_time = finite_timestamp(entry.get("datetime"))
    if entry_time is None or exit_time is None or "4h" not in frames:
        return None
    states: Dict[str, Dict[str, Any]] = {}
    previous_4h = "unavailable"
    for interval in TREND_INTERVALS:
        if interval not in frames:
            states[interval] = {"status": "unavailable", "reason": "market_data_unavailable"}
            continue
        state, previous_direction = point_in_time_trend_state(frames[interval], entry_time)
        states[interval] = state
        if interval == "4h":
            previous_4h = previous_direction
    regime = classify_market_regime(states, previous_4h)
    exit_quality = analyze_exit_quality(entry, frames["4h"], excursion)
    if exit_quality is None:
        return None
    return {
        "journal_id": int(entry["id"]),
        "symbol": entry.get("symbol"),
        "direction": entry.get("direction"),
        "entry_datetime": entry.get("entry_datetime"),
        "exit_datetime": entry.get("datetime"),
        "realized_pnl": finite(entry.get("realized_pnl")),
        "r_multiple": finite(entry.get("r_multiple")),
        "holding_minutes": max(0.0, (exit_time - entry_time) / 60_000),
        "trend_states": states,
        "market_regime": regime,
        "regime_alignment": regime["alignment"],
        "trade_alignment": trade_alignment(str(entry.get("direction") or ""), regime["trade_bias"]),
        "excursion": excursion,
        "exit_quality": exit_quality,
        "quality_class": "unavailable",
    }


def run_journal_quality_analysis_service(start_time: int, end_time: int) -> Dict[str, Any]:
    """Analyze entry-time regimes and post-exit alternatives without look-ahead leakage."""
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")

    positions = closed_positions(repository.list_entries(), start_time, end_time)
    cache_key = _analysis_cache_key(start_time, end_time, positions)
    cached_result = QUALITY_ANALYSIS_CACHE.get(cache_key)
    if cached_result is not None:
        return cached_result
    with QUALITY_ANALYSIS_LOCK:
        cached_result = QUALITY_ANALYSIS_CACHE.get(cache_key)
        if cached_result is not None:
            return cached_result
        return _run_uncached_quality_analysis(start_time, end_time, positions, cache_key)


def _run_uncached_quality_analysis(
    start_time: int,
    end_time: int,
    positions: List[Dict[str, Any]],
    cache_key: str,
) -> Dict[str, Any]:
    excursion_response = run_journal_excursions_service(start_time, end_time)
    excursion_data = excursion_response["data"]
    excursions = {item["journal_id"]: item for item in excursion_data["items"]}
    warnings = list(excursion_data.get("warnings") or [])
    by_symbol: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for position in positions:
        if position.get("symbol"):
            by_symbol[str(position["symbol"])].append(position)

    items: List[Dict[str, Any]] = []
    market_data_sources = set()
    for symbol, symbol_positions in by_symbol.items():
        frames = load_market_frames(symbol, symbol_positions, warnings)
        market_data_sources.update(
            str(frame.attrs.get("market_source"))
            for frame in frames.values()
            if frame is not None and frame.attrs.get("market_source")
        )
        for position in symbol_positions:
            item = _build_item(position, frames, excursions.get(int(position["id"])))
            if item is not None:
                items.append(item)

    items.sort(key=lambda item: item["exit_datetime"] or "", reverse=True)
    thresholds = _assign_quality_classes(items)
    analysis = _analysis_bundle(items)
    summary = analysis["summary"]
    if items and summary["r_available_count"] < len(items):
        warnings.append("R multiples are shown only for trades with a stored R multiple or risk basis.")

    result = {
        "success": True,
        "data": {
            "entry_trend_intervals": list(TREND_INTERVALS),
            "exit_interval": "4h",
            "minimum_regime_conclusion_sample": MIN_REGIME_CONCLUSION_SAMPLE,
            "market_data_sources": sorted(market_data_sources),
            **analysis,
            "thresholds": thresholds,
            "direction_stats": _group_stats(items, "direction"),
            "direction_breakdown": _direction_breakdown(items),
            "items": items,
            "warnings": sorted(set(warnings)),
        },
    }
    QUALITY_ANALYSIS_CACHE.set(cache_key, result)
    return result


__all__ = ["run_journal_quality_analysis_service"]
