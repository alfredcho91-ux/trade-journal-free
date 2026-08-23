"""Personal stop-distance analysis from closed-trade price paths."""

from __future__ import annotations

import math
import threading
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

import numpy as np
import pandas as pd

from backend.config.settings import PROJECT_ROOT
from backend.modules.journal import repository
from backend.modules.journal.analysis import (
    EXCURSION_INTERVAL,
    EXCURSION_INTERVAL_MS,
    MAX_EXCURSION_CANDLES,
)
from backend.modules.journal.cache_keys import position_analysis_cache_key
from backend.modules.journal.quality_analysis import run_journal_quality_analysis_service
from backend.modules.journal.quality_market import finite, finite_timestamp
from backend.modules.journal.trade_selection import closed_positions, market_group_key, position_batches
from backend.utils.cache import DataCache
from backend.modules.journal.market_data import is_market_fallback, load_journal_ohlcv, market_source

FIXED_STOP_CANDIDATES = tuple(round(value * 0.25, 2) for value in range(1, 17))
ATR_STOP_MULTIPLIERS = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0)
RECOVERY_THRESHOLDS = FIXED_STOP_CANDIDATES
TRAIN_RATIO = 0.7
MIN_RECOVERY_SAMPLE = 3
MIN_REGIME_SAMPLE = 5
STOP_OPTIMIZATION_CACHE_VERSION = 4
STOP_OPTIMIZATION_CACHE = DataCache(
    ttl_minutes=60,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_stop_optimization"),
)
STOP_OPTIMIZATION_LOCK = threading.Lock()


def _percentile(values: Iterable[Any], percentile: float) -> Optional[float]:
    valid = [value for item in values if (value := finite(item)) is not None]
    return float(np.percentile(valid, percentile)) if valid else None


def _directional_return(entry_price: float, exit_price: float, direction: str) -> float:
    side = -1.0 if direction == "Short" else 1.0
    return (exit_price - entry_price) / entry_price * 100.0 * side


def _max_drawdown(values: Sequence[float]) -> float:
    cumulative = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        cumulative += value
        peak = max(peak, cumulative)
        drawdown = max(drawdown, peak - cumulative)
    return drawdown


def _performance(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    returns = [float(item["simulated_return_pct"]) for item in results]
    r_values = [float(item["simulated_r"]) for item in results]
    positives = [value for value in returns if value > 0]
    negatives = [value for value in returns if value < 0]
    actual_winners = [item for item in results if item["actual_winner"]]
    stopped_winners = [item for item in actual_winners if item["stop_hit"]]
    gross_loss = abs(sum(negatives))
    return {
        "trade_count": len(results),
        "stop_hit_count": sum(item["stop_hit"] for item in results),
        "win_rate_pct": len(positives) / len(results) * 100 if results else None,
        "winner_preservation_pct": (
            (len(actual_winners) - len(stopped_winners)) / len(actual_winners) * 100
            if actual_winners else None
        ),
        "false_stop_pct": len(stopped_winners) / len(actual_winners) * 100 if actual_winners else None,
        "average_return_pct": float(np.mean(returns)) if returns else None,
        "average_r": float(np.mean(r_values)) if r_values else None,
        "profit_factor": sum(positives) / gross_loss if gross_loss > 0 else None,
        "max_drawdown_pct_points": _max_drawdown(returns),
    }


def _candidate_results(
    items: List[Dict[str, Any]],
    stop_type: str,
    value: float,
) -> List[Dict[str, Any]]:
    results = []
    for item in items:
        stop_pct = value if stop_type == "fixed" else (item.get("atr_pct") or 0) * value
        if stop_pct <= 0:
            continue
        stop_hit = item["mae_pct"] >= stop_pct
        simulated_return = -stop_pct if stop_hit else item["actual_return_pct"]
        results.append({
            "actual_winner": item["actual_winner"],
            "stop_hit": stop_hit,
            "simulated_return_pct": simulated_return,
            "simulated_r": simulated_return / stop_pct,
            "stop_pct": stop_pct,
        })
    return results


def _split_items(items: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    ordered = sorted(items, key=lambda item: item["entry_time"])
    if len(ordered) < 2:
        return ordered, []
    split = max(1, min(len(ordered) - 1, math.floor(len(ordered) * TRAIN_RATIO)))
    return ordered[:split], ordered[split:]


def _score_candidates(candidates: List[Dict[str, Any]]) -> None:
    metric_specs = (
        ("winner_preservation_pct", 0.20, False),
        ("profit_factor", 0.25, False),
        ("average_r", 0.25, False),
        ("max_drawdown_pct_points", 0.20, True),
    )
    for metric, _, _ in metric_specs:
        values = []
        for candidate in candidates:
            value = finite(candidate["train"].get(metric))
            if value is not None:
                values.append(min(value, 5.0) if metric == "profit_factor" else value)
        low = min(values) if values else None
        high = max(values) if values else None
        for candidate in candidates:
            value = finite(candidate["train"].get(metric))
            if value is None or low is None or high is None:
                normalized = 0.0
            else:
                value = min(value, 5.0) if metric == "profit_factor" else value
                normalized = 0.5 if high == low else (value - low) / (high - low)
            candidate.setdefault("_normalized", {})[metric] = normalized

    for candidate in candidates:
        metric_score = sum(
            weight * (1.0 - candidate["_normalized"][metric] if inverse else candidate["_normalized"][metric])
            for metric, weight, inverse in metric_specs
        )
        distances = [finite(item.get("average_stop_pct")) for item in candidates]
        valid_distances = [value for value in distances if value is not None]
        distance = finite(candidate.get("average_stop_pct"))
        if distance is None or not valid_distances or max(valid_distances) == min(valid_distances):
            efficiency = 0.5
        else:
            efficiency = 1.0 - (distance - min(valid_distances)) / (max(valid_distances) - min(valid_distances))
        candidate["score"] = metric_score + 0.10 * efficiency
        candidate.pop("_normalized", None)


def _simulate_candidates(items: List[Dict[str, Any]], stop_type: str) -> List[Dict[str, Any]]:
    values = FIXED_STOP_CANDIDATES if stop_type == "fixed" else ATR_STOP_MULTIPLIERS
    train, validation = _split_items(items)
    output = []
    for value in values:
        all_results = _candidate_results(items, stop_type, value)
        train_results = _candidate_results(train, stop_type, value)
        validation_results = _candidate_results(validation, stop_type, value)
        output.append({
            "type": stop_type,
            "value": value,
            "average_stop_pct": float(np.mean([item["stop_pct"] for item in all_results])) if all_results else None,
            "overall": _performance(all_results),
            "train": _performance(train_results),
            "validation": _performance(validation_results),
            "score": 0.0,
        })
    _score_candidates(output)
    return output


def _sweet_spot(candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    eligible = [candidate for candidate in candidates if candidate["train"]["trade_count"]]
    if not eligible:
        return None
    best = max(eligible, key=lambda candidate: candidate["score"])
    ordered = sorted(eligible, key=lambda candidate: candidate["value"])
    best_index = ordered.index(best)
    threshold = best["score"] - 0.08
    lower = best_index
    upper = best_index
    while lower > max(0, best_index - 1) and ordered[lower - 1]["score"] >= threshold:
        lower -= 1
    while upper < min(len(ordered) - 1, best_index + 1) and ordered[upper + 1]["score"] >= threshold:
        upper += 1
    return {
        "lower_pct": ordered[lower]["value"],
        "upper_pct": ordered[upper]["value"],
        "selected_pct": best["value"],
        "score": best["score"],
        "train": best["train"],
        "validation": best["validation"],
        "sample_quality": (
            "high" if best["train"]["trade_count"] >= 30
            else "medium" if best["train"]["trade_count"] >= 10
            else "low"
        ),
    }


def _mae_distribution(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    winners = [item["mae_pct"] for item in items if item["actual_winner"]]
    return {
        "winner_count": len(winners),
        "p50": _percentile(winners, 50),
        "p75": _percentile(winners, 75),
        "p90": _percentile(winners, 90),
        "p95": _percentile(winners, 95),
    }


def _recovered_after_threshold(item: Dict[str, Any], threshold: float) -> Optional[bool]:
    entry_price = item["entry_price"]
    direction = item["direction"]
    path = item["path"]
    if direction == "Short":
        hits = path.index[path["high"] >= entry_price * (1 + threshold / 100)]
    else:
        hits = path.index[path["low"] <= entry_price * (1 - threshold / 100)]
    if len(hits) == 0:
        return None
    hit_location = path.index.get_loc(hits[0])
    after = path.iloc[hit_location + 1:]
    if after.empty:
        return False
    return bool(
        after["low"].min() <= entry_price if direction == "Short"
        else after["high"].max() >= entry_price
    )


def _recovery_curve(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    losers = [item for item in items if not item["actual_winner"]]
    points = []
    for threshold in RECOVERY_THRESHOLDS:
        results = [result for item in losers if (result := _recovered_after_threshold(item, threshold)) is not None]
        recovered = sum(results)
        points.append({
            "threshold_pct": threshold,
            "reached_count": len(results),
            "recovered_count": recovered,
            "recovery_probability_pct": recovered / len(results) * 100 if results else None,
        })
    steepest = None
    for previous, current in zip(points, points[1:]):
        if (
            previous["reached_count"] >= MIN_RECOVERY_SAMPLE
            and current["reached_count"] >= MIN_RECOVERY_SAMPLE
            and previous["recovery_probability_pct"] is not None
            and current["recovery_probability_pct"] is not None
        ):
            drop = previous["recovery_probability_pct"] - current["recovery_probability_pct"]
            if drop > 0 and (steepest is None or drop > steepest["drop_pct_points"]):
                steepest = {
                    "from_pct": previous["threshold_pct"],
                    "to_pct": current["threshold_pct"],
                    "drop_pct_points": drop,
                }
    return {"loser_count": len(losers), "points": points, "steepest_drop": steepest}


def _baseline(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    results = [{
        "actual_winner": item["actual_winner"],
        "stop_hit": False,
        "simulated_return_pct": item["actual_return_pct"],
        "simulated_r": item["actual_return_pct"],
    } for item in items]
    return _performance(results)


def _expected_effect(baseline: Dict[str, Any], recommendation: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if recommendation is None or not recommendation["validation"]["trade_count"]:
        return None
    candidate = recommendation["validation"]
    return {
        "profit_factor_delta": (candidate["profit_factor"] - baseline["profit_factor"])
        if None not in (candidate["profit_factor"], baseline["profit_factor"]) else None,
        "average_return_delta_pct": (candidate["average_return_pct"] - baseline["average_return_pct"])
        if None not in (candidate["average_return_pct"], baseline["average_return_pct"]) else None,
        "max_drawdown_reduction_pct_points": (
            baseline["max_drawdown_pct_points"] - candidate["max_drawdown_pct_points"]
        ),
    }


def _analysis_bundle(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    fixed = _simulate_candidates(items, "fixed")
    atr = _simulate_candidates(items, "atr")
    recommendation = _sweet_spot(fixed)
    _, validation = _split_items(items)
    validation_baseline = _baseline(validation)
    if recommendation is not None:
        compared = []
        improved = []
        recommended_validation = recommendation["validation"]
        for metric, higher_is_better in (
            ("profit_factor", True),
            ("average_return_pct", True),
            ("max_drawdown_pct_points", False),
        ):
            candidate_value = finite(recommended_validation.get(metric))
            baseline_value = finite(validation_baseline.get(metric))
            if candidate_value is not None and baseline_value is not None:
                compared.append(candidate_value >= baseline_value if higher_is_better else candidate_value <= baseline_value)
                improved.append(candidate_value > baseline_value if higher_is_better else candidate_value < baseline_value)
        recommendation["validation_status"] = (
            "insufficient" if len(validation) < 5 or len(compared) < 2
            else "passed" if sum(compared) >= 2 and any(improved)
            else "neutral" if all(compared)
            else "failed"
        )
    return {
        "trade_count": len(items),
        "train_count": len(items) - len(validation),
        "validation_count": len(validation),
        "winner_mae_distribution": _mae_distribution(items),
        "loser_recovery": _recovery_curve(items),
        "fixed_candidates": fixed,
        "atr_candidates": atr,
        "recommendation": recommendation,
        "actual_validation": validation_baseline,
        "expected_effect": _expected_effect(validation_baseline, recommendation),
    }


def _regime_analysis(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[item["regime_id"]].append(item)
    output = []
    for regime_id, group in grouped.items():
        if regime_id == "unavailable" or len(group) < MIN_REGIME_SAMPLE:
            continue
        recommendation = _sweet_spot(_simulate_candidates(group, "fixed"))
        output.append({"id": regime_id, "trade_count": len(group), "recommendation": recommendation})
    return sorted(output, key=lambda item: (-item["trade_count"], item["id"]))


def _build_path_items(
    positions: List[Dict[str, Any]],
    quality_items: Dict[int, Dict[str, Any]],
    warnings: List[str],
) -> List[Dict[str, Any]]:
    by_market: Dict[tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for position in positions:
        if position.get("symbol"):
            by_market[market_group_key(position)].append(position)

    items = []
    for (exchange, instrument_type, symbol), symbol_positions in by_market.items():
        for batch_index, batch in enumerate(position_batches(symbol_positions), start=1):
            earliest = min(finite_timestamp(item.get("entry_datetime")) or 0 for item in batch)
            latest = max(finite_timestamp(item.get("datetime")) or 0 for item in batch)
            requested = math.ceil((latest - earliest) / EXCURSION_INTERVAL_MS) + 4
            if requested > MAX_EXCURSION_CANDLES:
                warnings.append(f"{symbol}: a position exceeds the {MAX_EXCURSION_CANDLES}-candle optimization limit")
            requested = min(MAX_EXCURSION_CANDLES, max(1, requested))
            candles = load_journal_ohlcv(
                symbol,
                EXCURSION_INTERVAL,
                total_candles=requested,
                end_time=latest,
                exchange=exchange,
                instrument_type=instrument_type,
            )
            if candles is None or candles.empty:
                warnings.append(f"{symbol} batch {batch_index}: stop optimization market data unavailable")
                continue
            if is_market_fallback(candles):
                warnings.append(f"{symbol} {EXCURSION_INTERVAL}: {market_source(candles)}")
            for position in batch:
                entry_time = finite_timestamp(position.get("entry_datetime"))
                exit_time = finite_timestamp(position.get("datetime"))
                entry_price = finite(position.get("entry_price"))
                exit_price = finite(position.get("exit_price"))
                realized_pnl = finite(position.get("realized_pnl"))
                if None in (entry_time, exit_time, entry_price, exit_price, realized_pnl) or entry_price <= 0:
                    continue
                path = candles.loc[
                    (candles["open_time"] >= entry_time) & (candles["close_time"] <= exit_time)
                ].copy().reset_index(drop=True)
                quality = quality_items.get(int(position["id"]), {})
                excursion = quality.get("excursion") or {}
                mae_pct = finite(excursion.get("mae_pct"))
                if mae_pct is None:
                    continue
                atr = finite(quality.get("trend_states", {}).get("4h", {}).get("atr"))
                items.append({
                    "journal_id": int(position["id"]),
                    "direction": str(position.get("direction") or ""),
                    "entry_time": entry_time,
                    "entry_price": entry_price,
                    "actual_return_pct": _directional_return(entry_price, exit_price, str(position.get("direction") or "")),
                    "actual_winner": realized_pnl > 0,
                    "mae_pct": mae_pct,
                    "atr_pct": atr / entry_price * 100 if atr is not None and atr > 0 else None,
                    "regime_id": str(quality.get("market_regime", {}).get("id") or "unavailable"),
                    "path": path,
                })
    return sorted(items, key=lambda item: item["entry_time"])


def _cache_key(start_time: int, end_time: int, positions: List[Dict[str, Any]]) -> str:
    return position_analysis_cache_key(
        "journal_stop_optimization",
        STOP_OPTIMIZATION_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        ("id", "datetime", "entry_datetime", "symbol", "direction", "entry_price", "exit_price", "realized_pnl"),
    )


def run_journal_stop_optimization_service(start_time: int, end_time: int) -> Dict[str, Any]:
    """Find robust stop ranges using chronological train/validation splits."""
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    positions = closed_positions(repository.list_entries(), start_time, end_time)
    cache_key = _cache_key(start_time, end_time, positions)
    cached = STOP_OPTIMIZATION_CACHE.get(cache_key)
    if cached is not None:
        return cached
    with STOP_OPTIMIZATION_LOCK:
        cached = STOP_OPTIMIZATION_CACHE.get(cache_key)
        if cached is not None:
            return cached
        quality = run_journal_quality_analysis_service(start_time, end_time)["data"]
        warnings = list(quality.get("warnings") or [])
        quality_items = {int(item["journal_id"]): item for item in quality.get("items") or []}
        items = _build_path_items(positions, quality_items, warnings)
        result = {
            "success": True,
            "data": {
                "interval": EXCURSION_INTERVAL,
                "methodology": {
                    "winner_definition": "net_realized_pnl_above_zero",
                    "candidate_return_basis": "directional_price_return_before_fees_and_funding",
                    "train_ratio": TRAIN_RATIO,
                    "score_weights": {"winner_preservation": 0.20, "profit_factor": 0.25, "average_r": 0.25, "drawdown": 0.20, "stop_efficiency": 0.10},
                    "same_candle_recovery_counted": False,
                    "minimum_regime_sample": MIN_REGIME_SAMPLE,
                },
                "direction_breakdown": {
                    direction: _analysis_bundle([item for item in items if item["direction"] == direction])
                    for direction in ("Long", "Short")
                },
                "regime_breakdown": {
                    direction: _regime_analysis([item for item in items if item["direction"] == direction])
                    for direction in ("Long", "Short")
                },
                "coverage": {"closed_positions_considered": len(positions), "analyzed_positions": len(items)},
                "warnings": sorted(set(warnings)),
            },
        }
        STOP_OPTIMIZATION_CACHE.set(cache_key, result)
        return result


__all__ = ["run_journal_stop_optimization_service"]
