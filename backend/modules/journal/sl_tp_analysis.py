"""Stop-loss/take-profit grid simulation over closed-trade price paths."""

from __future__ import annotations

import math
import threading
from collections import defaultdict, deque
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

from backend.config.settings import PROJECT_ROOT
from backend.modules.journal import repository
from backend.modules.journal.cache_keys import position_analysis_cache_key
from backend.modules.journal.trade_selection import (
    closed_positions,
    finite_float,
    market_group_key,
    path_covers_position,
    position_batches,
    timestamp_ms,
)
from backend.utils.cache import DataCache
from backend.modules.journal.market_data import load_journal_ohlcv

PATH_INTERVAL = "5m"
PATH_INTERVAL_MS = 5 * 60 * 1000
MAX_PATH_CANDLES = 30_000
TRAIN_RATIO = 0.7
MAX_GRID_COMBINATIONS = 800
SL_TP_CACHE_VERSION = 2
SCORE_WEIGHTS = {
    "expectancy": 0.35,
    "profit_factor": 0.25,
    "average_r": 0.15,
    "drawdown": 0.25,
}
SL_TP_PATH_CACHE = DataCache(
    ttl_minutes=60,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_sl_tp_paths"),
)
SL_TP_RESULT_CACHE = DataCache(
    ttl_minutes=60,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_sl_tp_analysis"),
)
SL_TP_LOCK = threading.RLock()


def grid_values(minimum: float, maximum: float, step: float) -> List[float]:
    """Build a stable inclusive decimal grid without float accumulation drift."""
    start = Decimal(str(minimum))
    end = Decimal(str(maximum))
    increment = Decimal(str(step))
    values: List[float] = []
    current = start
    while current <= end:
        values.append(float(current))
        current += increment
    return values


def _directional_return(entry_price: float, exit_price: float, direction: str) -> float:
    side = -1.0 if direction == "Short" else 1.0
    return (exit_price - entry_price) / entry_price * 100.0 * side


def simulate_trade_path(
    path: pd.DataFrame,
    *,
    entry_price: float,
    exit_price: float,
    direction: str,
    sl_pct: float,
    tp_pct: float,
    fee_pct: float = 0.0,
) -> Dict[str, Any]:
    """Resolve the first barrier hit; a same-5m collision is conservatively a stop."""
    if direction == "Short":
        stop_price = entry_price * (1.0 + sl_pct / 100.0)
        target_price = entry_price * (1.0 - tp_pct / 100.0)
    else:
        stop_price = entry_price * (1.0 - sl_pct / 100.0)
        target_price = entry_price * (1.0 + tp_pct / 100.0)

    outcome = "actual_exit"
    ambiguous = False
    gross_return_pct = _directional_return(entry_price, exit_price, direction)
    for row in path.itertuples(index=False):
        high = finite_float(getattr(row, "high", None))
        low = finite_float(getattr(row, "low", None))
        if high is None or low is None:
            continue
        if direction == "Short":
            stop_hit = high >= stop_price
            target_hit = low <= target_price
        else:
            stop_hit = low <= stop_price
            target_hit = high >= target_price

        if stop_hit and target_hit:
            outcome = "ambiguous_stop"
            ambiguous = True
            gross_return_pct = -sl_pct
            break
        if stop_hit:
            outcome = "stop"
            gross_return_pct = -sl_pct
            break
        if target_hit:
            outcome = "take_profit"
            gross_return_pct = tp_pct
            break

    net_return_pct = gross_return_pct - fee_pct
    return {
        "outcome": outcome,
        "stop_hit": outcome in {"stop", "ambiguous_stop"},
        "tp_hit": outcome == "take_profit",
        "ambiguous": ambiguous,
        "return_pct": net_return_pct,
        "r_multiple": net_return_pct / sl_pct,
    }


def _compound_performance(returns: Sequence[float]) -> tuple[float, float]:
    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    for value in returns:
        equity *= max(0.0, 1.0 + value / 100.0)
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - equity) / peak * 100.0)
    return (equity - 1.0) * 100.0, max_drawdown


def performance(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    returns = [float(item["return_pct"]) for item in results]
    r_values = [float(item["r_multiple"]) for item in results]
    wins = [value for value in returns if value > 0]
    losses = [value for value in returns if value < 0]
    gross_loss = abs(sum(losses))
    cumulative_return, max_drawdown = _compound_performance(returns)
    return {
        "trade_count": len(results),
        "win_rate_pct": len(wins) / len(results) * 100.0 if results else None,
        "stop_hit_count": sum(bool(item["stop_hit"]) for item in results),
        "stop_hit_pct": sum(bool(item["stop_hit"]) for item in results) / len(results) * 100.0 if results else None,
        "tp_hit_count": sum(bool(item["tp_hit"]) for item in results),
        "tp_hit_pct": sum(bool(item["tp_hit"]) for item in results) / len(results) * 100.0 if results else None,
        "ambiguous_count": sum(bool(item["ambiguous"]) for item in results),
        "average_win_pct": sum(wins) / len(wins) if wins else None,
        "average_loss_pct": sum(losses) / len(losses) if losses else None,
        "expectancy_pct": sum(returns) / len(returns) if returns else None,
        "average_r": sum(r_values) / len(r_values) if r_values else None,
        "profit_factor": sum(wins) / gross_loss if gross_loss > 0 else None,
        "cumulative_return_pct": cumulative_return if results else None,
        "max_drawdown_pct": max_drawdown if results else None,
    }


def _split_items(items: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    ordered = sorted(items, key=lambda item: (item["entry_time"], item["journal_id"]))
    if len(ordered) < 2:
        return ordered, []
    split = max(1, min(len(ordered) - 1, math.floor(len(ordered) * TRAIN_RATIO)))
    return ordered[:split], ordered[split:]


def _simulate_items(items: Iterable[Dict[str, Any]], sl_pct: float, tp_pct: float) -> List[Dict[str, Any]]:
    return [_simulate_prepared_item(item, sl_pct, tp_pct) for item in items]


def _first_barrier_index(item: Dict[str, Any], barrier: str, distance_pct: float) -> Optional[int]:
    cache = item.setdefault("_barrier_indices", {})
    key = (barrier, distance_pct)
    if key in cache:
        return cache[key]
    entry_price = item["entry_price"]
    direction = item["direction"]
    path = item["path"]
    if barrier == "stop":
        hits = (
            path["high"] >= entry_price * (1.0 + distance_pct / 100.0)
            if direction == "Short"
            else path["low"] <= entry_price * (1.0 - distance_pct / 100.0)
        )
    else:
        hits = (
            path["low"] <= entry_price * (1.0 - distance_pct / 100.0)
            if direction == "Short"
            else path["high"] >= entry_price * (1.0 + distance_pct / 100.0)
        )
    locations = hits.to_numpy().nonzero()[0]
    result = int(locations[0]) if len(locations) else None
    cache[key] = result
    return result


def _simulate_prepared_item(item: Dict[str, Any], sl_pct: float, tp_pct: float) -> Dict[str, Any]:
    stop_index = _first_barrier_index(item, "stop", sl_pct)
    target_index = _first_barrier_index(item, "target", tp_pct)
    if stop_index is not None and target_index is not None and stop_index == target_index:
        outcome = "ambiguous_stop"
        gross_return_pct = -sl_pct
        ambiguous = True
    elif stop_index is not None and (target_index is None or stop_index < target_index):
        outcome = "stop"
        gross_return_pct = -sl_pct
        ambiguous = False
    elif target_index is not None:
        outcome = "take_profit"
        gross_return_pct = tp_pct
        ambiguous = False
    else:
        outcome = "actual_exit"
        gross_return_pct = _directional_return(item["entry_price"], item["exit_price"], item["direction"])
        ambiguous = False
    net_return_pct = gross_return_pct - item["fee_pct"]
    return {
        "outcome": outcome,
        "stop_hit": outcome in {"stop", "ambiguous_stop"},
        "tp_hit": outcome == "take_profit",
        "ambiguous": ambiguous,
        "return_pct": net_return_pct,
        "r_multiple": net_return_pct / sl_pct,
    }


def _actual_performance(items: Iterable[Dict[str, Any]], risk_pct: float = 1.0) -> Dict[str, Any]:
    results = []
    for item in items:
        return_pct = _directional_return(item["entry_price"], item["exit_price"], item["direction"]) - item["fee_pct"]
        results.append({
            "return_pct": return_pct,
            "r_multiple": return_pct / risk_pct,
            "stop_hit": False,
            "tp_hit": False,
            "ambiguous": False,
        })
    return performance(results)


def _normalized(value: Optional[float], low: Optional[float], high: Optional[float], *, inverse: bool = False) -> float:
    if value is None or low is None or high is None:
        return 0.0
    elif high == low:
        score = 0.5
    else:
        score = (value - low) / (high - low)
    return 1.0 - score if inverse else score


def _score_candidates(candidates: List[Dict[str, Any]]) -> None:
    specs = (
        ("expectancy_pct", SCORE_WEIGHTS["expectancy"], False),
        ("profit_factor", SCORE_WEIGHTS["profit_factor"], False),
        ("average_r", SCORE_WEIGHTS["average_r"], False),
        ("max_drawdown_pct", SCORE_WEIGHTS["drawdown"], True),
    )
    ranges: Dict[str, tuple[Optional[float], Optional[float]]] = {}
    for metric, _, _ in specs:
        values = []
        for candidate in candidates:
            value = finite_float(candidate["train"].get(metric))
            if value is not None:
                values.append(min(value, 5.0) if metric == "profit_factor" else value)
        ranges[metric] = (min(values), max(values)) if values else (None, None)

    for candidate in candidates:
        score = 0.0
        for metric, weight, inverse in specs:
            value = finite_float(candidate["train"].get(metric))
            if value is not None and metric == "profit_factor":
                value = min(value, 5.0)
            low, high = ranges[metric]
            score += weight * _normalized(value, low, high, inverse=inverse)
        candidate["score"] = score


def _validation_status(candidate: Dict[str, Any], actual_validation: Dict[str, Any]) -> str:
    validation = candidate["validation"]
    if validation["trade_count"] < 5:
        return "insufficient"
    expectancy = finite_float(validation.get("expectancy_pct"))
    actual_expectancy = finite_float(actual_validation.get("expectancy_pct"))
    profit_factor = finite_float(validation.get("profit_factor"))
    actual_pf = finite_float(actual_validation.get("profit_factor"))
    drawdown = finite_float(validation.get("max_drawdown_pct"))
    actual_drawdown = finite_float(actual_validation.get("max_drawdown_pct"))
    comparisons = []
    improvements = []
    for value, baseline, higher_is_better in (
        (expectancy, actual_expectancy, True),
        (profit_factor, actual_pf, True),
        (drawdown, actual_drawdown, False),
    ):
        if value is None or baseline is None:
            continue
        comparisons.append(value >= baseline if higher_is_better else value <= baseline)
        improvements.append(value > baseline if higher_is_better else value < baseline)
    if len(comparisons) < 2:
        return "insufficient"
    if sum(comparisons) >= 2 and any(improvements):
        return "passed"
    if all(comparisons):
        return "neutral"
    return "failed"


def _recommendation(
    candidates: List[Dict[str, Any]],
    sl_values: List[float],
    tp_values: List[float],
    actual_validation: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not candidates:
        return None
    best = max(candidates, key=lambda item: item["score"])
    if best["train"]["trade_count"] == 0:
        return None
    threshold = best["score"] - 0.08
    eligible = {
        (item["sl_index"], item["tp_index"])
        for item in candidates
        if item["score"] >= threshold
    }
    start = (best["sl_index"], best["tp_index"])
    cluster = {start}
    queue = deque([start])
    while queue:
        sl_index, tp_index = queue.popleft()
        for neighbor in ((sl_index - 1, tp_index), (sl_index + 1, tp_index), (sl_index, tp_index - 1), (sl_index, tp_index + 1)):
            if neighbor in eligible and neighbor not in cluster:
                cluster.add(neighbor)
                queue.append(neighbor)
    cluster_sl = [sl_values[index] for index, _ in cluster]
    cluster_tp = [tp_values[index] for _, index in cluster]
    return {
        "sl_lower_pct": min(cluster_sl),
        "sl_upper_pct": max(cluster_sl),
        "tp_lower_pct": min(cluster_tp),
        "tp_upper_pct": max(cluster_tp),
        "selected_sl_pct": best["sl_pct"],
        "selected_tp_pct": best["tp_pct"],
        "score": best["score"],
        "validation_status": _validation_status(best, actual_validation),
        "sample_quality": "high" if best["train"]["trade_count"] >= 30 else "medium" if best["train"]["trade_count"] >= 10 else "low",
    }


def _analysis_bundle(items: List[Dict[str, Any]], sl_values: List[float], tp_values: List[float]) -> Dict[str, Any]:
    train, validation = _split_items(items)
    candidates = []
    for sl_index, sl_pct in enumerate(sl_values):
        for tp_index, tp_pct in enumerate(tp_values):
            candidates.append({
                "sl_pct": sl_pct,
                "tp_pct": tp_pct,
                "sl_index": sl_index,
                "tp_index": tp_index,
                "overall": performance(_simulate_items(items, sl_pct, tp_pct)),
                "train": performance(_simulate_items(train, sl_pct, tp_pct)),
                "validation": performance(_simulate_items(validation, sl_pct, tp_pct)),
                "score": 0.0,
            })
    _score_candidates(candidates)
    actual_validation = _actual_performance(validation)
    recommendation = _recommendation(candidates, sl_values, tp_values, actual_validation)
    best = max(candidates, key=lambda item: item["score"]) if candidates else None
    for candidate in candidates:
        candidate.pop("sl_index", None)
        candidate.pop("tp_index", None)
    return {
        "trade_count": len(items),
        "train_count": len(train),
        "validation_count": len(validation),
        "actual_overall": _actual_performance(items),
        "actual_validation": actual_validation,
        "candidates": candidates,
        "best_candidate": best,
        "recommendation": recommendation,
    }


def _fee_pct(position: Dict[str, Any]) -> Optional[float]:
    fee = finite_float(position.get("fee"))
    invested = finite_float(position.get("invested_amount"))
    leverage = finite_float(position.get("leverage"))
    if fee is None or invested is None or leverage is None or invested <= 0 or leverage <= 0:
        return None
    notional = invested * leverage
    return abs(fee) / notional * 100.0


def _path_cache_key(start_time: int, end_time: int, positions: List[Dict[str, Any]]) -> str:
    return position_analysis_cache_key(
        "journal_sl_tp_paths",
        SL_TP_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        ("id", "datetime", "entry_datetime", "symbol", "direction", "entry_price", "exit_price", "fee", "leverage", "invested_amount"),
    )


def _build_path_items(positions: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[str]]:
    by_market: Dict[tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for position in positions:
        symbol = position.get("symbol")
        if symbol:
            by_market[market_group_key(position)].append(position)

    items: List[Dict[str, Any]] = []
    warnings: List[str] = []
    for (exchange, instrument_type, symbol), symbol_positions in by_market.items():
        for batch_index, batch in enumerate(position_batches(symbol_positions), start=1):
            earliest = min(timestamp_ms(item.get("entry_datetime")) or 0 for item in batch)
            latest = max(timestamp_ms(item.get("datetime")) or 0 for item in batch)
            requested = math.ceil((latest - earliest) / PATH_INTERVAL_MS) + 4
            if requested > MAX_PATH_CANDLES:
                warnings.append(f"{symbol}: a position exceeds the {MAX_PATH_CANDLES}-candle SL/TP limit")
            requested = min(MAX_PATH_CANDLES, max(1, requested))
            candles = load_journal_ohlcv(
                symbol,
                PATH_INTERVAL,
                total_candles=requested,
                end_time=latest,
                exchange=exchange,
                instrument_type=instrument_type,
            )
            if candles is None or candles.empty:
                warnings.append(f"{symbol} batch {batch_index}: SL/TP market data unavailable")
                continue

            for position in batch:
                entry_time = timestamp_ms(position.get("entry_datetime"))
                exit_time = timestamp_ms(position.get("datetime"))
                entry_price = finite_float(position.get("entry_price"))
                exit_price = finite_float(position.get("exit_price"))
                if None in (entry_time, exit_time, entry_price, exit_price) or entry_price <= 0:
                    continue
                if not path_covers_position(candles, entry_time, exit_time, PATH_INTERVAL_MS):
                    warnings.append(f"journal {position['id']}: complete {PATH_INTERVAL} path is unavailable")
                    continue
                path = candles.loc[
                    (pd.to_numeric(candles["open_time"], errors="coerce") >= entry_time)
                    & (pd.to_numeric(candles["close_time"], errors="coerce") <= exit_time)
                ].copy().reset_index(drop=True)
                if path.empty:
                    continue
                fee_pct = _fee_pct(position)
                items.append({
                    "journal_id": int(position["id"]),
                    "direction": str(position.get("direction") or ""),
                    "entry_time": entry_time,
                    "entry_price": entry_price,
                    "exit_price": exit_price,
                    "fee_pct": fee_pct or 0.0,
                    "fee_available": fee_pct is not None,
                    "path": path,
                })
    return sorted(items, key=lambda item: (item["entry_time"], item["journal_id"])), sorted(set(warnings))


def _load_path_items(start_time: int, end_time: int, positions: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[str]]:
    key = _path_cache_key(start_time, end_time, positions)
    cached = SL_TP_PATH_CACHE.get(key)
    if cached is not None:
        return cached
    with SL_TP_LOCK:
        cached = SL_TP_PATH_CACHE.get(key)
        if cached is not None:
            return cached
        built = _build_path_items(positions)
        SL_TP_PATH_CACHE.set(key, built)
        return built


def _result_cache_key(
    start_time: int,
    end_time: int,
    positions: List[Dict[str, Any]],
    sl_values: List[float],
    tp_values: List[float],
) -> str:
    base = position_analysis_cache_key(
        "journal_sl_tp_analysis",
        SL_TP_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        ("id", "datetime", "entry_datetime", "symbol", "direction", "entry_price", "exit_price", "fee", "leverage", "invested_amount"),
    )
    return f"{base}:sl={','.join(map(str, sl_values))}:tp={','.join(map(str, tp_values))}"


def run_journal_sl_tp_analysis_service(
    start_time: int,
    end_time: int,
    sl_min: float,
    sl_max: float,
    sl_step: float,
    tp_min: float,
    tp_max: float,
    tp_step: float,
) -> Dict[str, Any]:
    """Simulate an adjustable SL/TP grid against each closed trade's 5m path."""
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    sl_values = grid_values(sl_min, sl_max, sl_step)
    tp_values = grid_values(tp_min, tp_max, tp_step)
    if not sl_values or not tp_values or len(sl_values) * len(tp_values) > MAX_GRID_COMBINATIONS:
        raise ValueError(f"SL/TP grid must contain between 1 and {MAX_GRID_COMBINATIONS} combinations")

    positions = closed_positions(repository.list_entries(), start_time, end_time)
    cache_key = _result_cache_key(start_time, end_time, positions, sl_values, tp_values)
    cached = SL_TP_RESULT_CACHE.get(cache_key)
    if cached is not None:
        return cached
    with SL_TP_LOCK:
        cached = SL_TP_RESULT_CACHE.get(cache_key)
        if cached is not None:
            return cached
        items, warnings = _load_path_items(start_time, end_time, positions)
        result = {
            "success": True,
            "data": {
                "interval": PATH_INTERVAL,
                "sl_values": sl_values,
                "tp_values": tp_values,
                "methodology": {
                    "simulation_window": "entry_to_actual_exit",
                    "same_candle_policy": "conservative_stop_and_ambiguous",
                    "return_basis": "directional_price_return_after_recorded_fee_proxy",
                    "funding_included": False,
                    "slippage_included": False,
                    "train_ratio": TRAIN_RATIO,
                    "score_weights": SCORE_WEIGHTS,
                    "max_grid_combinations": MAX_GRID_COMBINATIONS,
                },
                "direction_breakdown": {
                    direction: _analysis_bundle(
                        [item for item in items if item["direction"] == direction],
                        sl_values,
                        tp_values,
                    )
                    for direction in ("Long", "Short")
                },
                "coverage": {
                    "closed_positions_considered": len(positions),
                    "analyzed_positions": len(items),
                    "fee_proxy_positions": sum(bool(item["fee_available"]) for item in items),
                },
                "warnings": warnings,
            },
        }
        SL_TP_RESULT_CACHE.set(cache_key, result)
        return result


__all__ = ["run_journal_sl_tp_analysis_service"]
