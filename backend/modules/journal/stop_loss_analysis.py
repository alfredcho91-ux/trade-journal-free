"""Post-stop analysis using confirmed Deepcoin stop-loss trigger events."""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

from backend.config.settings import PROJECT_ROOT, get_deepcoin_credentials
from backend.modules.deepcoin.service import DeepcoinClient
from backend.modules.journal import repository
from backend.modules.journal.cache_keys import position_analysis_cache_key
from backend.modules.journal.market_context import load_market_frames
from backend.modules.journal.trade_selection import closed_positions
from backend.modules.journal.quality_market import (
    TREND_INTERVALS,
    classify_market_regime,
    finite,
    finite_timestamp,
    point_in_time_trend_state,
)
from backend.utils.cache import DataCache
from backend.utils.error_handler import DataLoadError

STOP_HORIZONS = (1, 2, 3)
STOP_TARGETS = (1, 2, 3)
STOP_MATCH_MAX_TIME_MS = 5 * 60 * 1000
STOP_MATCH_MAX_PRICE_DIFF_PCT = 1.0
FALSE_STOP_MIN_ORIGINAL_R = 2.0
REVERSAL_MIN_OPPOSITE_R = 2.0
GOOD_STOP_MIN_OPPOSITE_PCT = 1.0
DIRECTION_DOMINANCE_RATIO = 1.25
STOP_ANALYSIS_CACHE_VERSION = 3
STOP_ANALYSIS_CACHE = DataCache(
    ttl_minutes=10,
    cache_dir=str(PROJECT_ROOT / ".cache" / "journal_stop_loss"),
)
STOP_ANALYSIS_LOCK = threading.Lock()
CLASS_IDS = ("false_stop", "good_stop", "reversal_opportunity", "noise_chop")


def _float(value: Any) -> Optional[float]:
    return finite(value)


def _timestamp(value: Any) -> Optional[int]:
    result = _float(value)
    if result is None or result <= 0:
        return None
    return int(result * 1000) if result < 10_000_000_000 else int(result)


def _same_price(left: Optional[float], right: Optional[float]) -> bool:
    if left is None or right is None or left <= 0 or right <= 0:
        return False
    return abs(left - right) <= max(abs(right) * 1e-8, 1e-8)


def _confirmed_stop_events(symbol: str, raw_orders: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for order in raw_orders:
        trigger_price = _float(order.get("triggerPx"))
        stop_price = _float(order.get("slTriggerPrice")) or _float(order.get("closeSLTriggerPrice"))
        trigger_time = _timestamp(order.get("triggerTime"))
        direction = str(order.get("posSide") or "").strip().lower().title()
        if (
            str(order.get("ordType") or "").strip().lower() != "tpsl"
            or str(order.get("errorCode") or "0") != "0"
            or direction not in {"Long", "Short"}
            or trigger_time is None
            or not _same_price(trigger_price, stop_price)
        ):
            continue
        events.append({
            "symbol": symbol,
            "direction": direction,
            "trigger_time": trigger_time,
            "trigger_price": trigger_price,
            "size": _float(order.get("sz")),
            "order_id": str(order.get("ordId") or "").strip() or None,
        })
    return sorted(events, key=lambda item: item["trigger_time"])


def _load_stop_events(
    symbols: Iterable[str],
    warnings: List[str],
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]]]:
    credentials = get_deepcoin_credentials()
    if credentials is None:
        warnings.append("Deepcoin credentials are unavailable; confirmed stop-loss orders cannot be identified.")
        return {}, {}

    client = DeepcoinClient(credentials)
    output: Dict[str, List[Dict[str, Any]]] = {}
    coverage: Dict[str, Dict[str, Any]] = {}
    for symbol in sorted(set(symbols)):
        coin = symbol.split("/")[0].upper()
        try:
            raw_orders = client.get_trigger_orders_history(inst_id=f"{coin}-USDT-SWAP")
        except DataLoadError:
            warnings.append(f"{symbol}: Deepcoin stop-order history is unavailable.")
            continue
        output[symbol] = _confirmed_stop_events(symbol, raw_orders)
        history_times = [
            value
            for order in raw_orders
            if (value := _timestamp(order.get("uTime")) or _timestamp(order.get("cTime"))) is not None
        ]
        coverage[symbol] = {
            "raw_order_count": len(raw_orders),
            "confirmed_stop_count": len(output[symbol]),
            "oldest_history_time": min(history_times) if history_times else None,
            "newest_history_time": max(history_times) if history_times else None,
            "history_limit_reached": len(raw_orders) >= 100,
        }
        if len(raw_orders) >= 100:
            warnings.append(f"{symbol}: Deepcoin returned its latest 100 trigger orders; older stops may be unavailable.")
    return output, coverage


def _is_adverse_stop(position: Dict[str, Any], stop_price: float) -> bool:
    entry_price = _float(position.get("entry_price"))
    direction = str(position.get("direction") or "")
    if entry_price is None or entry_price <= 0:
        return False
    return (direction == "Long" and stop_price < entry_price) or (
        direction == "Short" and stop_price > entry_price
    )


def _match_confirmed_stops(
    positions: List[Dict[str, Any]],
    events_by_symbol: Dict[str, List[Dict[str, Any]]],
) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    matches: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    used_events = set()
    for position in sorted(positions, key=lambda item: finite_timestamp(item.get("datetime")) or 0):
        symbol = str(position.get("symbol") or "")
        direction = str(position.get("direction") or "")
        entry_time = finite_timestamp(position.get("entry_datetime"))
        exit_time = finite_timestamp(position.get("datetime"))
        exit_price = _float(position.get("exit_price"))
        if None in (entry_time, exit_time, exit_price) or exit_price <= 0:
            continue
        candidates = []
        for event in events_by_symbol.get(symbol, []):
            event_key = event.get("order_id") or (
                symbol,
                event["direction"],
                event["trigger_time"],
                event["trigger_price"],
            )
            if event_key in used_events or event["direction"] != direction:
                continue
            time_delta = abs(event["trigger_time"] - exit_time)
            price_delta_pct = abs(event["trigger_price"] - exit_price) / exit_price * 100
            if (
                entry_time <= event["trigger_time"] <= exit_time + STOP_MATCH_MAX_TIME_MS
                and time_delta <= STOP_MATCH_MAX_TIME_MS
                and price_delta_pct <= STOP_MATCH_MAX_PRICE_DIFF_PCT
                and _is_adverse_stop(position, event["trigger_price"])
            ):
                candidates.append((time_delta, price_delta_pct, event_key, event))
        if not candidates:
            continue
        _, _, event_key, event = min(candidates, key=lambda item: (item[0], item[1]))
        used_events.add(event_key)
        matches.append((position, event))
    return matches


def _regime_at(frames: Dict[str, pd.DataFrame], timestamp_ms: int) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    states: Dict[str, Dict[str, Any]] = {}
    previous_4h = "unavailable"
    for interval in TREND_INTERVALS:
        frame = frames.get(interval)
        if frame is None or frame.empty:
            states[interval] = {"status": "unavailable", "reason": "market_data_unavailable"}
            continue
        state, previous_direction = point_in_time_trend_state(frame, timestamp_ms)
        states[interval] = state
        if interval == "4h":
            previous_4h = previous_direction
    return states, classify_market_regime(states, previous_4h)


def _directional_move(start_price: float, end_price: float, direction: str) -> float:
    side = -1.0 if direction == "Short" else 1.0
    return (end_price - start_price) * side


def _target_hits(
    post: pd.DataFrame,
    start_price: float,
    risk_amount: float,
    direction: str,
) -> Dict[str, bool]:
    if post.empty:
        return {str(target): False for target in STOP_TARGETS}
    favorable_extreme = float(post["low"].min()) if direction == "Short" else float(post["high"].max())
    move_r = _directional_move(start_price, favorable_extreme, direction) / risk_amount
    return {str(target): move_r >= target for target in STOP_TARGETS}


def _four_hour_reversal(
    frame_4h: pd.DataFrame,
    post: pd.DataFrame,
    opposite_direction: str,
) -> Optional[int]:
    for bar_number, (_, row) in enumerate(post.iterrows(), start=1):
        state, _ = point_in_time_trend_state(frame_4h, int(row["close_time"]) + 1)
        if state.get("direction") == opposite_direction:
            return bar_number
    return None


def _classify_stop(
    entry_recovered: bool,
    original_mfe_r: float,
    opposite_mfe_r: float,
    opposite_mfe_pct: float,
    reversal_bar: Optional[int],
) -> str:
    if (
        opposite_mfe_pct >= GOOD_STOP_MIN_OPPOSITE_PCT
        and reversal_bar is not None
        and opposite_mfe_r >= REVERSAL_MIN_OPPOSITE_R
    ):
        return "reversal_opportunity"
    if opposite_mfe_pct >= GOOD_STOP_MIN_OPPOSITE_PCT:
        return "good_stop"
    if (
        entry_recovered
        and original_mfe_r >= FALSE_STOP_MIN_ORIGINAL_R
        and original_mfe_r >= opposite_mfe_r * DIRECTION_DOMINANCE_RATIO
    ):
        return "false_stop"
    return "noise_chop"


def _opposite_trade(
    stop_position: Dict[str, Any],
    all_positions: List[Dict[str, Any]],
    stop_time: int,
    horizon_end: int,
) -> Optional[Dict[str, Any]]:
    opposite_direction = "Short" if stop_position.get("direction") == "Long" else "Long"
    candidates = []
    for position in all_positions:
        entry_time = finite_timestamp(position.get("entry_datetime"))
        if (
            position.get("id") != stop_position.get("id")
            and position.get("symbol") == stop_position.get("symbol")
            and position.get("direction") == opposite_direction
            and entry_time is not None
            and stop_time <= entry_time <= horizon_end
        ):
            candidates.append((entry_time, position))
    if not candidates:
        return None
    _, position = min(candidates, key=lambda item: item[0])
    stop_pnl = _float(stop_position.get("realized_pnl"))
    opposite_pnl = _float(position.get("realized_pnl"))
    return {
        "journal_id": int(position["id"]),
        "direction": opposite_direction,
        "entry_datetime": position.get("entry_datetime"),
        "exit_datetime": position.get("datetime"),
        "realized_pnl": opposite_pnl,
        "combined_realized_pnl": stop_pnl + opposite_pnl if stop_pnl is not None and opposite_pnl is not None else None,
    }


def _analyze_stop(
    position: Dict[str, Any],
    event: Dict[str, Any],
    frames: Dict[str, pd.DataFrame],
    all_positions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    entry_price = float(position["entry_price"])
    stop_price = float(event["trigger_price"])
    stop_time = int(event["trigger_time"])
    direction = str(position["direction"])
    opposite_direction = "down" if direction == "Long" else "up"
    risk_amount = abs(entry_price - stop_price)
    frame_4h = frames["4h"]
    now_ms = int(pd.Timestamp.now(tz="UTC").timestamp() * 1000)
    completed = frame_4h.loc[frame_4h["close_time"] < now_ms]
    post = completed.loc[completed["open_time"] >= stop_time].head(max(STOP_HORIZONS))
    entry_states, entry_regime = _regime_at(frames, finite_timestamp(position.get("entry_datetime")) or stop_time)
    stop_states, stop_regime = _regime_at(frames, stop_time)

    if post.empty or risk_amount <= 0:
        return {
            "journal_id": int(position["id"]),
            "symbol": position.get("symbol"),
            "direction": direction,
            "entry_datetime": position.get("entry_datetime"),
            "exit_datetime": position.get("datetime"),
            "entry_price": entry_price,
            "exit_price": _float(position.get("exit_price")),
            "stop_price": stop_price,
            "stop_time": stop_time,
            "realized_pnl": _float(position.get("realized_pnl")),
            "classification": "insufficient_data",
            "post_candle_count": len(post),
            "entry_trend_states": entry_states,
            "entry_market_regime": entry_regime,
            "stop_trend_states": stop_states,
            "stop_market_regime": stop_regime,
        }

    if direction == "Long":
        original_extreme = float(post["high"].max())
        opposite_extreme = float(post["low"].min())
        recovered_rows = post.loc[post["high"] >= entry_price]
    else:
        original_extreme = float(post["low"].min())
        opposite_extreme = float(post["high"].max())
        recovered_rows = post.loc[post["low"] <= entry_price]
    original_mfe_r = max(0.0, _directional_move(stop_price, original_extreme, direction) / risk_amount)
    opposite_trade_direction = "Short" if direction == "Long" else "Long"
    opposite_mfe_r = max(
        0.0,
        _directional_move(stop_price, opposite_extreme, opposite_trade_direction) / risk_amount,
    )
    opposite_mfe_pct = opposite_mfe_r * risk_amount / stop_price * 100
    entry_recovered = not recovered_rows.empty
    recovery_bars = int(post.index.get_loc(recovered_rows.index[0])) + 1 if entry_recovered else None
    reversal_bar = _four_hour_reversal(frame_4h, post, opposite_direction)
    classification = _classify_stop(
        entry_recovered,
        original_mfe_r,
        opposite_mfe_r,
        opposite_mfe_pct,
        reversal_bar,
    )

    horizon_results: Dict[str, Dict[str, Any]] = {}
    for horizon in STOP_HORIZONS:
        if len(post) < horizon:
            horizon_results[str(horizon)] = {"available": False}
            continue
        row = post.iloc[horizon - 1]
        close_price = float(row["close"])
        horizon_results[str(horizon)] = {
            "available": True,
            "close_time": int(row["close_time"]),
            "close_price": close_price,
            "original_position_r": _directional_move(entry_price, close_price, direction) / risk_amount,
            "reverse_from_stop_r": _directional_move(stop_price, close_price, opposite_trade_direction) / risk_amount,
        }
    horizon_end = int(post.iloc[-1]["close_time"])
    return {
        "journal_id": int(position["id"]),
        "symbol": position.get("symbol"),
        "direction": direction,
        "entry_datetime": position.get("entry_datetime"),
        "exit_datetime": position.get("datetime"),
        "entry_price": entry_price,
        "exit_price": _float(position.get("exit_price")),
        "stop_price": stop_price,
        "stop_time": stop_time,
        "stop_order_id": event.get("order_id"),
        "realized_pnl": _float(position.get("realized_pnl")),
        "risk_amount": risk_amount,
        "risk_pct": risk_amount / entry_price * 100,
        "classification": classification,
        "post_candle_count": len(post),
        "entry_recovered": entry_recovered,
        "recovery_bars": recovery_bars,
        "original_direction_mfe_r": original_mfe_r,
        "original_direction_mfe_pct": original_mfe_r * risk_amount / stop_price * 100,
        "opposite_direction_mfe_r": opposite_mfe_r,
        "opposite_direction_mfe_pct": opposite_mfe_pct,
        "original_target_hits": _target_hits(post, entry_price, risk_amount, direction),
        "reversal_target_hits": _target_hits(post, stop_price, risk_amount, opposite_trade_direction),
        "horizon_results": horizon_results,
        "entry_trend_states": entry_states,
        "entry_market_regime": entry_regime,
        "stop_trend_states": stop_states,
        "stop_market_regime": stop_regime,
        "four_hour_reversal_bar": reversal_bar,
        "opposite_trade": _opposite_trade(position, all_positions, stop_time, horizon_end),
    }


def _summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    classified = [item for item in items if item.get("classification") in CLASS_IDS]
    counts = {class_id: sum(item.get("classification") == class_id for item in classified) for class_id in CLASS_IDS}
    total = len(classified)
    return {
        "confirmed_stop_count": len(items),
        "classified_stop_count": total,
        "pending_stop_count": len(items) - total,
        "class_counts": counts,
        "class_pct": {
            class_id: counts[class_id] / total * 100 if total else None
            for class_id in CLASS_IDS
        },
    }


def _regime_patterns(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        if item.get("classification") in CLASS_IDS:
            grouped[item.get("entry_market_regime", {}).get("id") or "unavailable"].append(item)
    output = []
    for regime_id, group in grouped.items():
        counts = {class_id: sum(item["classification"] == class_id for item in group) for class_id in CLASS_IDS}
        output.append({
            "id": regime_id,
            "stop_count": len(group),
            "false_stop_count": counts["false_stop"],
            "false_stop_pct": counts["false_stop"] / len(group) * 100,
            "reversal_count": counts["reversal_opportunity"],
            "reversal_pct": counts["reversal_opportunity"] / len(group) * 100,
        })
    return sorted(output, key=lambda item: (-item["stop_count"], item["id"]))


def _direction_breakdown(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    output = {}
    for direction in ("Long", "Short"):
        selected = [item for item in items if item.get("direction") == direction]
        output[direction] = {
            "summary": _summary(selected),
            "regime_patterns": _regime_patterns(selected),
        }
    return output


def _cache_key(start_time: int, end_time: int, positions: List[Dict[str, Any]]) -> str:
    return position_analysis_cache_key(
        "journal_stop_loss",
        STOP_ANALYSIS_CACHE_VERSION,
        start_time,
        end_time,
        positions,
        ("id", "symbol", "direction", "entry_datetime", "datetime", "entry_price", "exit_price", "realized_pnl"),
    )


def run_journal_stop_loss_analysis_service(start_time: int, end_time: int) -> Dict[str, Any]:
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    positions = closed_positions(repository.list_entries(), start_time, end_time)
    cache_key = _cache_key(start_time, end_time, positions)
    cached = STOP_ANALYSIS_CACHE.get(cache_key)
    if cached is not None:
        return cached
    with STOP_ANALYSIS_LOCK:
        cached = STOP_ANALYSIS_CACHE.get(cache_key)
        if cached is not None:
            return cached

        warnings: List[str] = []
        symbols = [str(position["symbol"]) for position in positions if position.get("symbol")]
        events_by_symbol, trigger_coverage = _load_stop_events(symbols, warnings)
        matched = _match_confirmed_stops(positions, events_by_symbol)
        matched_by_symbol: Dict[str, List[Tuple[Dict[str, Any], Dict[str, Any]]]] = defaultdict(list)
        for position, event in matched:
            matched_by_symbol[str(position["symbol"])].append((position, event))

        items: List[Dict[str, Any]] = []
        for symbol, pairs in matched_by_symbol.items():
            stop_positions = [position for position, _ in pairs]
            frames = load_market_frames(symbol, stop_positions, warnings)
            if "4h" not in frames:
                continue
            for position, event in pairs:
                items.append(_analyze_stop(position, event, frames, positions))
        items.sort(key=lambda item: item.get("stop_time") or 0, reverse=True)

        result = {
            "success": True,
            "data": {
                "interval": "4h",
                "horizons": list(STOP_HORIZONS),
                "criteria": {
                    "stop_identification": "confirmed_deepcoin_sl_trigger",
                    "stop_match_max_time_minutes": STOP_MATCH_MAX_TIME_MS / 60_000,
                    "stop_match_max_price_diff_pct": STOP_MATCH_MAX_PRICE_DIFF_PCT,
                    "risk_basis": "absolute_distance_between_entry_and_confirmed_stop_trigger",
                    "post_candles": "first_3_fully_completed_4h_candles_after_stop",
                    "classification_priority": ["reversal_opportunity", "good_stop", "false_stop", "noise_chop"],
                    "false_stop": {
                        "entry_recovered": True,
                        "minimum_original_direction_mfe_r": FALSE_STOP_MIN_ORIGINAL_R,
                        "minimum_dominance_ratio": DIRECTION_DOMINANCE_RATIO,
                    },
                    "reversal_opportunity": {
                        "minimum_opposite_direction_mfe_pct": GOOD_STOP_MIN_OPPOSITE_PCT,
                        "minimum_opposite_direction_mfe_r": REVERSAL_MIN_OPPOSITE_R,
                        "requires_4h_opposite_trend_transition": True,
                    },
                    "good_stop": {
                        "minimum_opposite_direction_mfe_pct": GOOD_STOP_MIN_OPPOSITE_PCT,
                    },
                    "noise_chop": "all_remaining_confirmed_stops",
                },
                "summary": _summary(items),
                "regime_patterns": _regime_patterns(items),
                "direction_breakdown": _direction_breakdown(items),
                "coverage": {
                    "closed_positions_considered": len(positions),
                    "matched_confirmed_stops": len(matched),
                    "trigger_history": trigger_coverage,
                },
                "items": items,
                "warnings": sorted(set(warnings)),
            },
        }
        STOP_ANALYSIS_CACHE.set(cache_key, result)
        return result


__all__ = ["run_journal_stop_loss_analysis_service"]
