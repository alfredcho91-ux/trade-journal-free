"""Historical counterfactual plan and execution analysis."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from backend.modules.journal import repository as journal_repository
from backend.modules.journal.quality_analysis import run_journal_quality_analysis_service
from backend.modules.journal.sl_tp_analysis import load_trade_path_items
from backend.modules.journal.trade_selection import closed_positions, finite_float, timestamp_ms
from backend.modules.plan_lab import repository

ADHERENCE_WEIGHTS = {"entry": 0.30, "stop": 0.35, "exit": 0.35}
ADHERENCE_THRESHOLD = 80.0
ENTRY_MINOR_DEVIATION_R = 0.10
ENTRY_MAJOR_DEVIATION_R = 0.50
DEFAULT_POST_EXIT_HORIZON_HOURS = 40.0
DISCOVERY_RATIO = 0.70
TP1_EXIT_FRACTION = 0.50
REMAINING_EXIT_FRACTION = 0.50


def _mean(values: Iterable[Optional[float]]) -> Optional[float]:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return sum(clean) / len(clean) if clean else None


def _sample_confidence(count: int) -> str:
    return "strong" if count >= 30 else "medium" if count >= 10 else "low"


def _entry_reference(revision: Dict[str, Any]) -> Optional[float]:
    exact = finite_float(revision.get("entry_price"))
    if exact is not None:
        return exact
    lower = finite_float(revision.get("entry_min"))
    upper = finite_float(revision.get("entry_max"))
    return (lower + upper) / 2 if lower is not None and upper is not None else None


def plan_geometry(
    side: str, revision: Dict[str, Any], *, entry_override: Optional[float] = None,
) -> Dict[str, Any]:
    entry = finite_float(entry_override) if entry_override is not None else _entry_reference(revision)
    stop = finite_float(revision.get("stop_loss"))
    target = finite_float(revision.get("take_profit"))
    target_2 = finite_float(revision.get("take_profit_2"))
    if entry is None or stop is None or target is None:
        return {"valid": False, "status": "INVALID_PLAN", "entry": entry}
    risk = entry - stop if side == "Long" else stop - entry
    reward = target - entry if side == "Long" else entry - target
    reward_2 = target_2 - entry if side == "Long" and target_2 is not None else entry - target_2 if target_2 is not None else None
    split_valid = target_2 is None or (reward_2 is not None and reward_2 > reward)
    valid = risk > 0 and reward > 0 and split_valid
    planned_total_reward = (
        TP1_EXIT_FRACTION * reward + REMAINING_EXIT_FRACTION * reward_2
        if reward_2 is not None else reward
    )
    return {
        "valid": valid,
        "status": "VALID" if valid else "INVALID_PLAN",
        "entry": entry,
        "stop": stop,
        "target": target,
        "target_2": target_2,
        "execution_mode": "SPLIT_TP_50_50" if target_2 is not None else "SINGLE_TP",
        "risk_distance": risk if valid else None,
        "reward_distance": reward if valid else None,
        "risk_pct": risk / entry * 100 if valid else None,
        "reward_pct": reward / entry * 100 if valid else None,
        "planned_rr": reward / risk if valid else None,
        "planned_rr_2": reward_2 / risk if valid and reward_2 is not None else None,
        "planned_total_rr": planned_total_reward / risk if valid else None,
        "planned_total_reward_pct": planned_total_reward / entry * 100 if valid else None,
        "break_even_win_rate_pct": 100 / (1 + planned_total_reward / risk) if valid else None,
    }


def _directional_return(entry_price: float, exit_price: float, side: str) -> float:
    direction = -1 if side == "Short" else 1
    return (exit_price - entry_price) / entry_price * 100 * direction


def _planned_risk_usdt(entry: Dict[str, Any], geometry: Dict[str, Any]) -> Optional[float]:
    invested = finite_float(entry.get("invested_amount"))
    leverage = finite_float(entry.get("leverage"))
    risk_pct = geometry.get("risk_pct")
    if invested is None or leverage is None or invested <= 0 or leverage <= 0 or risk_pct is None:
        return None
    risk = invested * leverage * float(risk_pct) / 100
    return risk if risk > 0 else None


def _barrier_result(path: pd.DataFrame, geometry: Dict[str, Any], side: str) -> Dict[str, Any]:
    if not geometry.get("valid"):
        return {"status": "INVALID_PLAN", "planned_r": None, "touch_time": None}
    if path is None or path.empty:
        return {"status": "NOT_EVALUABLE", "planned_r": None, "touch_time": None}
    stop = float(geometry["stop"])
    target = float(geometry["target"])
    for index, row in enumerate(path.itertuples(index=False)):
        high = finite_float(getattr(row, "high", None))
        low = finite_float(getattr(row, "low", None))
        if high is None or low is None:
            continue
        stop_hit = high >= stop if side == "Short" else low <= stop
        target_hit = low <= target if side == "Short" else high >= target
        if bool(getattr(row, "boundary_uncertain", False)) and (stop_hit or target_hit):
            return {"status": "NOT_EVALUABLE", "planned_r": None, "touch_time": None}
        touch_time = finite_float(getattr(row, "close_time", None))
        if touch_time is None:
            touch_time = float(index)
        if stop_hit and target_hit:
            return {"status": "AMBIGUOUS", "planned_r": None, "touch_time": touch_time}
        if target_hit:
            return {"status": "TP_FIRST", "planned_r": geometry["planned_rr"], "touch_time": touch_time}
        if stop_hit:
            return {"status": "SL_FIRST", "planned_r": -1.0, "touch_time": touch_time}
    return {"status": "UNRESOLVED", "planned_r": None, "touch_time": None}


def _touch_time(row: Any, fallback: int) -> float:
    value = finite_float(getattr(row, "close_time", None))
    return value if value is not None else float(fallback)


def _split_leg(
    leg_type: str,
    fraction: float,
    exit_price: float,
    touch_time: Optional[float],
    price_r: float,
) -> Dict[str, Any]:
    return {
        "type": leg_type,
        "fraction": fraction,
        "exit_price": exit_price,
        "exit_time": touch_time,
        "price_r": price_r,
        "contribution_r": fraction * price_r,
        "status": "FILLED",
    }


def _split_barrier_result(path: pd.DataFrame, geometry: Dict[str, Any], side: str) -> Dict[str, Any]:
    """Resolve a fixed TP1 50% / remaining 50% plan without guessing OHLC order."""
    if not geometry.get("valid") or geometry.get("target_2") is None:
        return {"status": "INVALID_PLAN", "planned_r": None, "touch_time": None, "legs": []}
    if path is None or path.empty:
        return {"status": "NOT_EVALUABLE", "planned_r": None, "touch_time": None, "legs": []}

    stop = float(geometry["stop"])
    target_1 = float(geometry["target"])
    target_2 = float(geometry["target_2"])
    rr_1 = float(geometry["planned_rr"])
    rr_2 = float(geometry["planned_rr_2"])
    tp1_leg: Optional[Dict[str, Any]] = None

    for index, row in enumerate(path.itertuples(index=False)):
        high = finite_float(getattr(row, "high", None))
        low = finite_float(getattr(row, "low", None))
        if high is None or low is None:
            continue
        if side == "Short":
            stop_hit = high >= stop
            tp1_hit = low <= target_1
            tp2_hit = low <= target_2
        else:
            stop_hit = low <= stop
            tp1_hit = high >= target_1
            tp2_hit = high >= target_2
        boundary_uncertain = bool(getattr(row, "boundary_uncertain", False))
        relevant_hit = stop_hit or (tp2_hit if tp1_leg is not None else tp1_hit)
        if boundary_uncertain and relevant_hit:
            return {
                "status": "NOT_EVALUABLE", "planned_r": None, "touch_time": None,
                "legs": [tp1_leg] if tp1_leg is not None else [],
                "tp1_filled": tp1_leg is not None,
                "ambiguity_reason": "BOUNDARY_PARTIAL_CANDLE",
            }
        touch_time = _touch_time(row, index)

        if tp1_leg is None:
            if stop_hit and tp1_hit:
                return {
                    "status": "NOT_EVALUABLE", "planned_r": None, "touch_time": touch_time,
                    "legs": [], "ambiguity_reason": "TP1_SL_SAME_CANDLE",
                }
            if tp2_hit:
                legs = [
                    _split_leg("TP1", TP1_EXIT_FRACTION, target_1, touch_time, rr_1),
                    _split_leg("TP2", REMAINING_EXIT_FRACTION, target_2, touch_time, rr_2),
                ]
                return {
                    "status": "TP1_TP2", "planned_r": sum(item["contribution_r"] for item in legs),
                    "touch_time": touch_time, "legs": legs, "tp1_filled": True,
                    "tp2_filled": True, "stop_filled": False, "horizon_filled": False,
                }
            if tp1_hit:
                tp1_leg = _split_leg("TP1", TP1_EXIT_FRACTION, target_1, touch_time, rr_1)
                continue
            if stop_hit:
                leg = _split_leg("SL", 1.0, stop, touch_time, -1.0)
                return {
                    "status": "SL_FIRST", "planned_r": -1.0, "touch_time": touch_time,
                    "legs": [leg], "tp1_filled": False, "tp2_filled": False,
                    "stop_filled": True, "horizon_filled": False,
                }
        else:
            if stop_hit and tp2_hit:
                return {
                    "status": "NOT_EVALUABLE", "planned_r": None, "touch_time": touch_time,
                    "legs": [tp1_leg], "tp1_filled": True,
                    "ambiguity_reason": "TP2_SL_SAME_CANDLE_AFTER_TP1",
                }
            if tp2_hit:
                second = _split_leg("TP2", REMAINING_EXIT_FRACTION, target_2, touch_time, rr_2)
                legs = [tp1_leg, second]
                return {
                    "status": "TP1_TP2", "planned_r": sum(item["contribution_r"] for item in legs),
                    "touch_time": touch_time, "legs": legs, "tp1_filled": True,
                    "tp2_filled": True, "stop_filled": False, "horizon_filled": False,
                }
            if stop_hit:
                second = _split_leg("SL", REMAINING_EXIT_FRACTION, stop, touch_time, -1.0)
                legs = [tp1_leg, second]
                return {
                    "status": "TP1_SL", "planned_r": sum(item["contribution_r"] for item in legs),
                    "touch_time": touch_time, "legs": legs, "tp1_filled": True,
                    "tp2_filled": False, "stop_filled": True, "horizon_filled": False,
                }

    final_row = path.iloc[-1]
    horizon_price = finite_float(final_row.get("close"))
    if bool(final_row.get("boundary_uncertain", False)) or horizon_price is None:
        return {
            "status": "NOT_EVALUABLE" if bool(final_row.get("boundary_uncertain", False)) else "UNRESOLVED",
            "planned_r": None, "touch_time": None,
            "legs": [tp1_leg] if tp1_leg is not None else [],
            "tp1_filled": tp1_leg is not None,
            "ambiguity_reason": "HORIZON_PARTIAL_CANDLE" if bool(final_row.get("boundary_uncertain", False)) else None,
        }
    horizon_r = _directional_return(float(geometry["entry"]), horizon_price, side) / float(geometry["risk_pct"])
    touch_time = finite_float(final_row.get("close_time"))
    if tp1_leg is None:
        leg = _split_leg("HORIZON", 1.0, horizon_price, touch_time, horizon_r)
        return {
            "status": "HORIZON", "planned_r": horizon_r, "touch_time": touch_time,
            "legs": [leg], "tp1_filled": False, "tp2_filled": False,
            "stop_filled": False, "horizon_filled": True,
        }
    second = _split_leg("HORIZON", REMAINING_EXIT_FRACTION, horizon_price, touch_time, horizon_r)
    legs = [tp1_leg, second]
    return {
        "status": "TP1_HORIZON", "planned_r": sum(item["contribution_r"] for item in legs),
        "touch_time": touch_time, "legs": legs, "tp1_filled": True,
        "tp2_filled": False, "stop_filled": False, "horizon_filled": True,
    }


def _simulation(
    path_item: Optional[Dict[str, Any]], geometry: Dict[str, Any], side: str,
) -> Dict[str, Any]:
    if path_item is None or not isinstance(path_item.get("path"), pd.DataFrame):
        return {"status": "NOT_EVALUABLE", "planned_r": None, "touch_time": None}
    result = (
        _split_barrier_result(path_item["path"], geometry, side)
        if geometry.get("execution_mode") == "SPLIT_TP_50_50"
        else _barrier_result(path_item["path"], geometry, side)
    )
    planned_r = result.get("planned_r")
    fee_pct = finite_float(path_item.get("fee_pct")) or 0.0
    risk_pct = finite_float(geometry.get("risk_pct"))
    if planned_r is not None and risk_pct and risk_pct > 0:
        fee_r = fee_pct / risk_pct
        planned_r -= fee_r
        legs = result.get("legs") or []
        if legs:
            result["legs"] = [
                {**leg, "contribution_r": float(leg["contribution_r"]) - fee_r * float(leg["fraction"])}
                for leg in legs
            ]
    return {**result, "planned_r": planned_r}


def _entry_adherence(entry: Dict[str, Any], revision: Dict[str, Any], geometry: Dict[str, Any]) -> Dict[str, Any]:
    actual = finite_float(entry.get("entry_price"))
    if actual is None or not geometry.get("valid"):
        return {"score": None, "status": "NOT_EVALUABLE"}
    lower = finite_float(revision.get("entry_min"))
    upper = finite_float(revision.get("entry_max"))
    planned_entry = _entry_reference(revision)
    if lower is None or upper is None:
        lower = upper = planned_entry
    if lower is None or upper is None:
        return {"score": None, "status": "NOT_EVALUABLE"}
    deviation = 0.0 if lower <= actual <= upper else min(abs(actual - lower), abs(actual - upper))
    deviation_r = deviation / float(geometry["risk_distance"])
    if deviation_r == 0:
        score, status = 100.0, "COMPLIANT"
    elif deviation_r <= ENTRY_MINOR_DEVIATION_R:
        score, status = 80.0, "PARTIAL"
    elif deviation_r <= ENTRY_MAJOR_DEVIATION_R:
        score, status = 50.0, "PARTIAL"
    else:
        score, status = 0.0, "VIOLATION"
    return {"score": score, "status": status, "deviation_r": deviation_r}


def _stop_adherence(actual_return_pct: Optional[float], geometry: Dict[str, Any], simulation: Dict[str, Any]) -> Dict[str, Any]:
    if actual_return_pct is None or not geometry.get("valid"):
        return {"score": None, "status": "NOT_EVALUABLE"}
    risk_pct = float(geometry["risk_pct"])
    if actual_return_pct < -risk_pct * 1.05:
        return {"score": 0.0, "status": "STOP_OVERRUN"}
    if simulation.get("stop_filled") or simulation["status"] == "SL_FIRST":
        if actual_return_pct > -risk_pct * 0.95:
            return {"score": 60.0, "status": "DISCRETIONARY_EARLY_STOP"}
        return {"score": 100.0, "status": "PLANNED_STOP"}
    if simulation.get("tp1_filled") or simulation["status"] == "TP_FIRST":
        return {"score": 100.0, "status": "TP_BEFORE_STOP"}
    return {"score": None, "status": "NOT_TRIGGERED"}


def _exit_adherence(actual_return_pct: Optional[float], geometry: Dict[str, Any], simulation: Dict[str, Any]) -> Dict[str, Any]:
    if actual_return_pct is None or not geometry.get("valid"):
        return {"score": None, "status": "NOT_EVALUABLE"}
    reward_pct = float(geometry.get("planned_total_reward_pct") or geometry["reward_pct"])
    if actual_return_pct >= reward_pct * 0.95:
        return {"score": 100.0, "status": "PLANNED_TARGET"}
    if simulation.get("tp2_filled") or simulation["status"] == "TP_FIRST":
        return {"score": 30.0, "status": "TARGET_SHORTFALL"}
    if simulation.get("tp1_filled"):
        return {"score": 60.0, "status": "PARTIAL_TARGET"}
    if simulation["status"] in {"UNRESOLVED", "HORIZON", "TP1_HORIZON"}:
        return {"score": 60.0, "status": "DISCRETIONARY_EXIT"}
    return {"score": None, "status": "STOP_SCENARIO"}


def _overall_adherence(parts: Dict[str, Dict[str, Any]]) -> Optional[float]:
    available = [(name, value["score"]) for name, value in parts.items() if value.get("score") is not None]
    weight = sum(ADHERENCE_WEIGHTS[name] for name, _ in available)
    return sum(score * ADHERENCE_WEIGHTS[name] for name, score in available) / weight if weight else None


def _path_mfe_r(path_item: Optional[Dict[str, Any]], geometry: Dict[str, Any], side: str) -> Optional[float]:
    if path_item is None or not geometry.get("valid") or not isinstance(path_item.get("path"), pd.DataFrame):
        return None
    path = path_item["path"]
    if path.empty:
        return None
    if "boundary_uncertain" in path.columns:
        path = path.loc[~path["boundary_uncertain"].fillna(False).astype(bool)]
    if path.empty:
        return None
    highs = pd.to_numeric(path["high"], errors="coerce").dropna()
    lows = pd.to_numeric(path["low"], errors="coerce").dropna()
    if highs.empty or lows.empty:
        return None
    best = float(highs.max()) - geometry["entry"] if side == "Long" else geometry["entry"] - float(lows.min())
    return max(0.0, best / geometry["risk_distance"])


def _path_after_timestamp(path: pd.DataFrame, boundary_ms: int) -> Optional[pd.DataFrame]:
    """Keep observable post-boundary candles and flag an overlapping partial candle."""
    if "open_time" not in path.columns or "close_time" not in path.columns:
        return None
    open_times = pd.to_numeric(path["open_time"], errors="coerce")
    close_exclusive = pd.to_numeric(path["close_time"], errors="coerce") + 1
    post = path.loc[close_exclusive > boundary_ms].copy()
    if post.empty:
        return post
    post_open = pd.to_numeric(post["open_time"], errors="coerce")
    post_close_exclusive = pd.to_numeric(post["close_time"], errors="coerce") + 1
    existing = (
        post["boundary_uncertain"].fillna(False).astype(bool)
        if "boundary_uncertain" in post.columns
        else pd.Series(False, index=post.index)
    )
    post["boundary_uncertain"] = existing | (
        (post_open < boundary_ms) & (boundary_ms < post_close_exclusive)
    )
    return post.reset_index(drop=True)


def _post_exit_outcome(
    path_item: Optional[Dict[str, Any]], geometry: Dict[str, Any], side: str, exit_time: Any,
) -> str:
    # A post-exit slice cannot establish whether TP1 had filled before the
    # actual exit. Do not silently evaluate a split plan as a TP1-only plan.
    if geometry.get("execution_mode") == "SPLIT_TP_50_50":
        return "NOT_EVALUABLE"
    if path_item is None or not isinstance(path_item.get("path"), pd.DataFrame):
        return "NOT_EVALUABLE"
    path = path_item["path"]
    exit_ms = timestamp_ms(exit_time)
    if exit_ms is None:
        return "NOT_EVALUABLE"
    post = _path_after_timestamp(path, exit_ms)
    if post is None:
        return "NOT_EVALUABLE"
    result = _barrier_result(post, geometry, side)
    return {
        "TP_FIRST": "POST_EXIT_TP",
        "SL_FIRST": "POST_EXIT_SL",
        "AMBIGUOUS": "AMBIGUOUS",
        "UNRESOLVED": "NO_BARRIER",
    }.get(result["status"], "NOT_EVALUABLE")


def _classify_execution(
    actual_return_pct: Optional[float], geometry: Dict[str, Any], simulation: Dict[str, Any],
    post_exit_outcome: str, entry_part: Dict[str, Any], actual_exit_ms: Optional[int] = None,
) -> tuple[str, List[str]]:
    if actual_return_pct is None or not geometry.get("valid"):
        return "NOT_EVALUABLE", []
    risk_pct = float(geometry["risk_pct"])
    reward_pct = float(geometry.get("planned_total_reward_pct") or geometry["reward_pct"])
    tags: List[str] = []
    if entry_part.get("status") in {"PARTIAL", "VIOLATION"}:
        tags.append("ENTRY_DEVIATION")
    if post_exit_outcome == "POST_EXIT_TP":
        tags.append("TP_AFTER_EXIT")
    touch_time = finite_float(simulation.get("touch_time"))
    touch_confirmed_before_exit = (
        touch_time is not None and actual_exit_ms is not None and touch_time < actual_exit_ms
    )
    if actual_return_pct < -risk_pct * 1.05:
        primary = "STOP_OVERRUN"
        tags.append("LOSS_BEYOND_PLAN_SL")
    elif actual_return_pct < 0 and actual_return_pct > -risk_pct * 0.95 and simulation["status"] == "SL_FIRST":
        primary = "DISCRETIONARY_EARLY_STOP"
    elif (
        post_exit_outcome == "NOT_EVALUABLE"
        and (simulation.get("tp1_filled") or simulation["status"] == "TP_FIRST")
        and actual_return_pct < reward_pct * 0.95
        and not touch_confirmed_before_exit
    ):
        primary = "NOT_EVALUABLE"
    elif 0 <= actual_return_pct < reward_pct * 0.95 and post_exit_outcome == "POST_EXIT_TP":
        primary = "EARLY_TP_EXIT"
    elif (simulation.get("tp1_filled") or simulation["status"] == "TP_FIRST") and actual_return_pct < reward_pct * 0.95:
        primary = "TARGET_GIVEBACK"
    elif actual_return_pct > reward_pct * 1.05:
        primary = "HOLD_AFTER_TP"
    elif abs(actual_return_pct - reward_pct) <= reward_pct * 0.10 or abs(actual_return_pct + risk_pct) <= risk_pct * 0.10:
        primary = "PLAN_LIKE"
    else:
        primary = "OTHER"
    return primary, tags


def evaluate_plan(plan: Dict[str, Any], entry: Dict[str, Any], path_item: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    annotated = repository.annotate_revisions(plan, entry.get("entry_datetime"), entry.get("datetime"))
    revision = annotated.get("plan_effective_at_entry")
    source = str(annotated.get("plan_source") or "UNLINKED")
    base = {
        "plan_id": plan["id"], "journal_id": entry["id"], "symbol": entry.get("symbol"),
        "side": plan["side"], "entry_datetime": entry.get("entry_datetime"),
        "exit_datetime": entry.get("datetime"), "setup": (revision or {}).get("setup"),
        "plan_source": source, "plan_initial": annotated.get("plan_initial"),
        "plan_effective_at_entry": revision, "revisions": annotated["revisions"],
    }
    if revision is None:
        return {**base, "evaluation_status": "POST_TRADE_INPUT", "r_basis": "unavailable"}
    actual_entry = finite_float(entry.get("entry_price"))
    exit_price = finite_float(entry.get("exit_price"))
    original_geometry = plan_geometry(plan["side"], revision)
    geometry = plan_geometry(plan["side"], revision, entry_override=actual_entry)
    if exit_price is None or actual_entry is None:
        return {**base, "evaluation_status": "NOT_EVALUABLE", "geometry": geometry, "r_basis": "unavailable"}
    simulation = _simulation(path_item, geometry, plan["side"])
    actual_return_pct = _directional_return(actual_entry, exit_price, plan["side"])
    planned_risk_usdt = _planned_risk_usdt(entry, geometry)
    net_pnl = finite_float(entry.get("realized_pnl"))
    if planned_risk_usdt is not None and net_pnl is not None:
        actual_r, r_basis = net_pnl / planned_risk_usdt, "usdt"
    elif geometry.get("risk_pct"):
        actual_r, r_basis = actual_return_pct / geometry["risk_pct"], "price"
    else:
        actual_r, r_basis = None, "unavailable"
    parts = {
        "entry": _entry_adherence(entry, revision, geometry),
        "stop": _stop_adherence(actual_return_pct, geometry, simulation),
        "exit": _exit_adherence(actual_return_pct, geometry, simulation),
    }
    adherence = _overall_adherence(parts)
    planned_r = simulation.get("planned_r")
    planned_pnl = planned_r * planned_risk_usdt if planned_r is not None and planned_risk_usdt is not None else None
    plan_legs = [
        {
            **leg,
            "contribution_pnl": (
                float(leg["contribution_r"]) * planned_risk_usdt
                if planned_risk_usdt is not None else None
            ),
        }
        for leg in (simulation.get("legs") or [])
    ]
    execution_delta = actual_r - planned_r if r_basis == "usdt" and actual_r is not None and planned_r is not None else None
    execution_delta_usdt = execution_delta * planned_risk_usdt if execution_delta is not None and planned_risk_usdt is not None else None
    mfe_r = _path_mfe_r(path_item, geometry, plan["side"])
    post_exit = _post_exit_outcome(path_item, geometry, plan["side"], entry.get("datetime"))
    primary, secondary = _classify_execution(
        actual_return_pct,
        geometry,
        simulation,
        post_exit,
        parts["entry"],
        timestamp_ms(entry.get("datetime")),
    )
    return {
        **base, "evaluation_status": simulation["status"], "geometry": geometry,
        "original_planned_rr": original_geometry.get("planned_rr"),
        "planned_result_r": planned_r, "planned_result_pnl": planned_pnl,
        "actual_r": actual_r, "r_basis": r_basis,
        "planned_risk_usdt": planned_risk_usdt, "net_pnl": net_pnl,
        "execution_delta_r": execution_delta, "execution_delta_usdt": execution_delta_usdt,
        "actual_return_pct": actual_return_pct,
        "adherence": {**parts, "overall": adherence},
        "adherent": adherence is not None and adherence >= ADHERENCE_THRESHOLD,
        "mfe_r": mfe_r,
        "target_calibration": geometry.get("planned_total_rr") / mfe_r if mfe_r and mfe_r > 0 else None,
        "primary_execution_category": primary, "secondary_tags": secondary,
        "post_exit_outcome": post_exit, "simulation_touch_time": simulation.get("touch_time"),
        "plan_execution_mode": geometry.get("execution_mode"),
        "plan_legs": plan_legs,
        "simulation_ambiguity_reason": simulation.get("ambiguity_reason"),
        "simulation_horizon_end": path_item.get("horizon_end") if path_item else None,
        "simulation_horizon_hours": path_item.get("horizon_hours") if path_item else None,
    }


def _official(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [item for item in items if item.get("r_basis") == "usdt" and item.get("planned_result_r") is not None]


def _performance(values: Iterable[Optional[float]]) -> Dict[str, Any]:
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    wins = [value for value in clean if value > 0]
    losses = [value for value in clean if value < 0]
    equity = peak = max_drawdown = 0.0
    for value in clean:
        equity += value
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    return {
        "trade_count": len(clean), "expectancy_r": _mean(clean), "total_r": sum(clean),
        "win_rate_pct": len(wins) / len(clean) * 100 if clean else None,
        "profit_factor": sum(wins) / abs(sum(losses)) if losses else None,
        "average_win_r": _mean(wins), "average_loss_r": _mean(losses),
        "max_drawdown_r": max_drawdown if clean else None,
        "sample_confidence": _sample_confidence(len(clean)),
    }


def _stats(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    official = _official(items)
    adherence_items = [item for item in items if item.get("adherence", {}).get("overall") is not None]
    actual = _performance(item.get("actual_r") for item in official)
    plan = _performance(item.get("planned_result_r") for item in official)
    return {
        "trade_count": len(items), "official_r_count": len(official),
        "actual": actual, "plan": plan,
        "plan_win_rate_pct": plan["win_rate_pct"], "plan_expectancy_r": plan["expectancy_r"],
        "actual_expectancy_r": actual["expectancy_r"],
        "execution_delta_r": _mean(item.get("execution_delta_r") for item in official),
        "execution_delta_total_r": sum(item.get("execution_delta_r") or 0 for item in official),
        "average_planned_rr": _mean(
            item.get("geometry", {}).get("planned_total_rr")
            or item.get("geometry", {}).get("planned_rr")
            for item in items
        ),
        "average_break_even_win_rate_pct": _mean(item.get("geometry", {}).get("break_even_win_rate_pct") for item in items),
        "adherence_pct": _mean(item.get("adherence", {}).get("overall") for item in adherence_items),
        "adherent_trade_pct": sum(bool(item.get("adherent")) for item in adherence_items) / len(adherence_items) * 100 if adherence_items else None,
    }


def _aggregate_group(identifier: str, values: List[Dict[str, Any]], denominator: int) -> Dict[str, Any]:
    official = _official(values)
    stats = _stats(values)
    return {
        "id": identifier, **stats,
        "journal_ids": [item["journal_id"] for item in official],
        "all_journal_ids": [item["journal_id"] for item in values],
        "average_actual_r": _mean(item.get("actual_r") for item in official),
        "average_planned_r": _mean(item.get("planned_result_r") for item in official),
        "average_execution_delta_r": _mean(item.get("execution_delta_r") for item in official),
        "total_execution_delta_r": sum(item.get("execution_delta_r") or 0 for item in official),
        "total_execution_delta_usdt": sum(item.get("execution_delta_usdt") or 0 for item in official),
        "occurrence_rate_pct": len(official) / denominator * 100 if denominator else None,
        "sample_confidence": _sample_confidence(len(official)),
    }


def _grouped(items: List[Dict[str, Any]], key) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        value = str(key(item) or "").strip()
        if value:
            groups[value].append(item)
    denominator = len(_official(items))
    return sorted(
        (_aggregate_group(name, values, denominator) for name, values in groups.items()),
        key=lambda row: row["official_r_count"], reverse=True,
    )


def _matrix(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cells = []
    for adherent in (True, False):
        for positive in (True, False):
            selected = [item for item in _official(items) if item.get("adherent") is adherent and (item["planned_result_r"] > 0) is positive]
            cells.append({
                "id": f"{'adherent' if adherent else 'non_adherent'}_{'positive' if positive else 'negative'}",
                "adherent": adherent, "plan_positive": positive, "trade_count": len(selected),
                "average_planned_r": _mean(item.get("planned_result_r") for item in selected),
                "average_actual_r": _mean(item.get("actual_r") for item in selected),
                "average_execution_delta_r": _mean(item.get("execution_delta_r") for item in selected),
                "journal_ids": [item["journal_id"] for item in selected],
            })
    return cells


def _primary_attribution(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return _grouped(_official(items), lambda item: item.get("primary_execution_category"))


def _secondary_observations(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    official = _official(items)
    for item in official:
        for tag in item.get("secondary_tags") or []:
            groups[tag].append(item)
    return [_aggregate_group(key, values, len(official)) for key, values in groups.items()]


def _delta_distribution(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    specs = [
        ("lte_-2", "≤ -2R", lambda value: value <= -2),
        ("-2_-1", "-2R ~ -1R", lambda value: -2 < value <= -1),
        ("-1_0", "-1R ~ 0R", lambda value: -1 < value < 0),
        ("0_1", "0R ~ +1R", lambda value: 0 <= value < 1),
        ("1_2", "+1R ~ +2R", lambda value: 1 <= value < 2),
        ("gte_2", "≥ +2R", lambda value: value >= 2),
    ]
    official = _official(items)
    result = []
    for identifier, label, predicate in specs:
        selected = [item for item in official if item.get("execution_delta_r") is not None and predicate(float(item["execution_delta_r"]))]
        result.append({"id": identifier, "label": label, "trade_count": len(selected), "journal_ids": [item["journal_id"] for item in selected]})
    return result


def _cumulative_curve(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    actual_total = plan_total = 0.0
    points = []
    for item in sorted(_official(items), key=lambda value: timestamp_ms(value.get("exit_datetime")) or 0):
        actual_total += float(item["actual_r"])
        plan_total += float(item["planned_result_r"])
        points.append({
            "journal_id": item["journal_id"], "date": item.get("exit_datetime"), "symbol": item.get("symbol"),
            "setup": item.get("setup"), "actual_r": item["actual_r"], "plan_r": item["planned_result_r"],
            "execution_delta_r": item.get("execution_delta_r"), "actual_cumulative_r": actual_total,
            "plan_cumulative_r": plan_total,
        })
    return points


def _variant_bundle(name: str, items: List[Dict[str, Any]], resolver) -> Dict[str, Any]:
    ordered = sorted(_official(items), key=lambda item: timestamp_ms(item.get("exit_datetime")) or 0)
    split = int(len(ordered) * DISCOVERY_RATIO)
    if len(ordered) > 1:
        split = min(max(split, 1), len(ordered) - 1)
    discovery, validation = ordered[:split], ordered[split:]
    return {
        "id": name,
        "overall": _performance(resolver(item) for item in ordered),
        "discovery": _performance(resolver(item) for item in discovery),
        "validation": _performance(resolver(item) for item in validation),
        "journal_ids": [item["journal_id"] for item in ordered],
    }


def _optimizer(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    variants = [
        _variant_bundle("ACTUAL", items, lambda item: item.get("actual_r")),
        _variant_bundle("PLAN", items, lambda item: item.get("planned_result_r")),
        _variant_bundle("PLAN_TP_ON_EARLY_EXIT", items, lambda item: item.get("planned_result_r") if item.get("primary_execution_category") == "EARLY_TP_EXIT" else item.get("actual_r")),
        _variant_bundle("PLAN_SL_ON_OVERRUN", items, lambda item: item.get("planned_result_r") if item.get("primary_execution_category") == "STOP_OVERRUN" else item.get("actual_r")),
        _variant_bundle("KEEP_EARLY_STOP_PLAN_TP", items, lambda item: item.get("actual_r") if item.get("primary_execution_category") == "DISCRETIONARY_EARLY_STOP" else item.get("planned_result_r") if item.get("primary_execution_category") == "EARLY_TP_EXIT" else item.get("actual_r")),
    ]
    baseline_discovery = variants[0]["discovery"].get("expectancy_r")
    baseline_validation = variants[0]["validation"].get("expectancy_r")
    for variant in variants:
        discovery = variant["discovery"]
        validation = variant["validation"]
        discovery["delta_vs_actual_r"] = discovery["expectancy_r"] - baseline_discovery if discovery["expectancy_r"] is not None and baseline_discovery is not None else None
        validation["delta_vs_actual_r"] = validation["expectancy_r"] - baseline_validation if validation["expectancy_r"] is not None and baseline_validation is not None else None
        same_direction = (
            discovery["delta_vs_actual_r"] is not None and validation["delta_vs_actual_r"] is not None
            and discovery["delta_vs_actual_r"] > 0 and validation["delta_vs_actual_r"] > 0
        )
        variant["validation_status"] = "supported" if same_direction and validation["sample_confidence"] != "low" else "observed_low_sample" if same_direction else "not_maintained"
    return {"split": "chronological_70_30", "variants": variants}


def _largest_execution_gap(attribution: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    negative = [
        item for item in attribution
        if item.get("id") != "NOT_EVALUABLE"
        and finite_float(item.get("total_execution_delta_r")) is not None
        and float(item["total_execution_delta_r"]) < 0
    ]
    return min(negative, key=lambda item: float(item["total_execution_delta_r"])) if negative else None


def _diagnosis(summary: Dict[str, Any], attribution: List[Dict[str, Any]]) -> str:
    if summary.get("official_r_count", 0) < 5:
        return "INSUFFICIENT_PLANS"
    plan_exp = summary.get("plan_expectancy_r")
    actual_exp = summary.get("actual_expectancy_r")
    if plan_exp is not None and actual_exp is not None and plan_exp > actual_exp + 0.15:
        return "PLAN_OUTPERFORMED_ACTUAL"
    if actual_exp is not None and plan_exp is not None and actual_exp > plan_exp + 0.15:
        return "DISCRETION_OUTPERFORMED_PLAN"
    worst = _largest_execution_gap(attribution)
    if worst is not None:
        return f"BEHAVIOR_GAP:{worst['id']}"
    return "NO_CLEAR_GAP"


def _extended_path_positions(
    plans_by_entry: Dict[int, Dict[str, Any]], entries: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], int]:
    extended = []
    latest_horizon = 0
    for entry in entries:
        plan = plans_by_entry[int(entry["id"])]
        annotated = repository.annotate_revisions(plan, entry.get("entry_datetime"), entry.get("datetime"))
        revision = annotated.get("plan_effective_at_entry") or {}
        entry_ms = timestamp_ms(entry.get("entry_datetime"))
        exit_ms = timestamp_ms(entry.get("datetime"))
        if entry_ms is None or exit_ms is None:
            continue
        max_hold = finite_float(revision.get("max_hold_hours"))
        if max_hold is not None:
            horizon_ms = entry_ms + int(max_hold * 3_600_000)
            horizon_source = "plan_max_hold"
        else:
            horizon_ms = exit_ms + int(DEFAULT_POST_EXIT_HORIZON_HOURS * 3_600_000)
            horizon_source = "fixed_post_exit_40h"
        copied = dict(entry)
        copied["datetime"] = pd.Timestamp(horizon_ms, unit="ms", tz="UTC").isoformat()
        copied["_actual_exit_datetime"] = entry.get("datetime")
        copied["_horizon_hours"] = (horizon_ms - entry_ms) / 3_600_000
        copied["_horizon_source"] = horizon_source
        extended.append(copied)
        latest_horizon = max(latest_horizon, horizon_ms)
    return extended, latest_horizon


def _regime_map(start_time: int, end_time: int, linked_ids: set[int]) -> tuple[Dict[int, Dict[str, Any]], List[str]]:
    if not linked_ids:
        return {}, []
    try:
        response = run_journal_quality_analysis_service(start_time, end_time)
        data = response.get("data") or {}
        mapping = {
            int(item["journal_id"]): item.get("market_regime") or {}
            for item in data.get("items") or [] if int(item.get("journal_id") or 0) in linked_ids
        }
        return mapping, list(data.get("warnings") or [])
    except Exception as exc:
        return {}, [f"Plan regime analysis unavailable: {type(exc).__name__}"]


def run_plan_lab_service(
    start_time: int, end_time: int, direction: Optional[str] = None, setup: Optional[str] = None,
    symbol: Optional[str] = None, plan_source: Optional[str] = None,
) -> Dict[str, Any]:
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    all_entries = journal_repository.list_entries()
    closed = closed_positions(all_entries, start_time, end_time)
    if direction:
        closed = [entry for entry in closed if entry.get("direction") == direction]
    if symbol:
        symbol_key = repository.normalize_symbol(symbol)
        closed = [entry for entry in closed if repository.normalize_symbol(entry.get("symbol")) == symbol_key]
    plans = repository.list_plans()
    linked = {
        int(plan["link"]["journal_entry_id"]): plan for plan in plans
        if plan.get("link") and plan["link"].get("link_status") == "LINKED" and plan["link"].get("journal_entry_id") is not None
    }
    linked_positions = [entry for entry in closed if int(entry["id"]) in linked]
    if plan_source:
        linked_positions = [entry for entry in linked_positions if linked[int(entry["id"])].get("source") == plan_source]
    extended_positions, horizon_end = _extended_path_positions(linked, linked_positions)
    path_items, path_warnings = load_trade_path_items(start_time, horizon_end or end_time, extended_positions) if extended_positions else ([], [])
    extended_by_id = {int(item["id"]): item for item in extended_positions}
    path_by_id = {int(item["journal_id"]): item for item in path_items}
    for journal_id, path_item in path_by_id.items():
        copied = extended_by_id.get(journal_id) or {}
        path_item["horizon_end"] = copied.get("datetime")
        path_item["horizon_hours"] = copied.get("_horizon_hours")
        path_item["horizon_source"] = copied.get("_horizon_source")
    evaluations = [evaluate_plan(linked[int(entry["id"])], entry, path_by_id.get(int(entry["id"]))) for entry in linked_positions]
    if setup:
        evaluations = [item for item in evaluations if str(item.get("setup") or "") == setup]
    regime_by_id, regime_warnings = _regime_map(start_time, end_time, {int(item["journal_id"]) for item in evaluations})
    for item in evaluations:
        regime = regime_by_id.get(int(item["journal_id"])) or {}
        item["market_regime"] = regime
        item["market_regime_id"] = regime.get("id")
    summary = _stats(evaluations)
    summary.update({
        "closed_trade_count": len(closed), "plan_recorded_count": len(evaluations),
        "plan_recording_rate_pct": len(evaluations) / len(closed) * 100 if closed else None,
    })
    attribution = _primary_attribution(evaluations)
    early_exit = _grouped(
        [item for item in _official(evaluations) if item.get("actual_return_pct") is not None and item.get("geometry", {}).get("reward_pct") is not None and 0 <= item["actual_return_pct"] < item["geometry"]["reward_pct"] * 0.95],
        lambda item: item.get("post_exit_outcome"),
    )
    stop_behavior = _grouped(
        [item for item in _official(evaluations) if item.get("primary_execution_category") in {"STOP_OVERRUN", "DISCRETIONARY_EARLY_STOP", "PLAN_LIKE"}],
        lambda item: item.get("primary_execution_category"),
    )
    return {"success": True, "data": {
        "methodology": {
            "verified_pretrade": "server_received_at_strictly_before_first_actual_entry_at",
            "retrospective": "latest_server_received_revision_explicitly_labelled_hindsight",
            "simulation_mode": "actual_entry_plus_plan_sl_tp",
            "default_horizon": "actual_exit_plus_40_elapsed_hours",
            "path_interval": "5m", "same_candle_policy": "AMBIGUOUS_excluded",
            "official_r_basis": "actual_net_pnl_over_planned_risk_usdt",
            "adherence_weights": ADHERENCE_WEIGHTS, "adherence_threshold": ADHERENCE_THRESHOLD,
            "fees_funding": "actual_uses_existing_net_pnl_plan_uses_recorded_fee_proxy",
            "split_tp": "tp2_present_means_tp1_50_percent_then_remaining_50_percent",
            "setup_identity": "immutable_text_snapshot_no_stable_setup_registry",
        },
        "summary": summary, "diagnosis": _diagnosis(summary, attribution),
        "largest_execution_gap": _largest_execution_gap(attribution),
        "coverage": {
            "closed_trades": len(closed), "plan_recorded": len(evaluations),
            "official_r": sum(item.get("r_basis") == "usdt" and item.get("planned_result_r") is not None for item in evaluations),
            "price_r_only": sum(item.get("r_basis") == "price" for item in evaluations),
            "r_unavailable": sum(item.get("r_basis") == "unavailable" for item in evaluations),
            "ambiguous": sum(item.get("evaluation_status") == "AMBIGUOUS" for item in evaluations),
            "not_evaluable": sum(
                item.get("evaluation_status") == "NOT_EVALUABLE"
                or item.get("primary_execution_category") == "NOT_EVALUABLE"
                for item in evaluations
            ),
            "verified_pretrade": sum(item.get("plan_source") == "VERIFIED_PRETRADE" for item in evaluations),
            "retrospective": sum(item.get("plan_source") == "RETROSPECTIVE" for item in evaluations),
            "legacy_single_tp": sum(item.get("plan_execution_mode") == "SINGLE_TP" for item in evaluations),
            "split_tp": sum(item.get("plan_execution_mode") == "SPLIT_TP_50_50" for item in evaluations),
            "split_post_exit_unsupported": sum(
                item.get("plan_execution_mode") == "SPLIT_TP_50_50"
                and item.get("post_exit_outcome") == "NOT_EVALUABLE"
                for item in evaluations
            ),
            "ambiguous_links": sum(plan.get("link", {}).get("link_status") == "AMBIGUOUS_LINK" for plan in plans if plan.get("link")),
        },
        "cumulative_curve": _cumulative_curve(evaluations),
        "primary_attribution": attribution,
        "secondary_observations": _secondary_observations(evaluations),
        "early_exit_analysis": early_exit, "stop_behavior_analysis": stop_behavior,
        "delta_distribution": _delta_distribution(evaluations),
        "matrix": _matrix(evaluations), "behavior_costs": attribution,
        "setup_stats": _grouped(evaluations, lambda item: item.get("setup")),
        "side_stats": _grouped(evaluations, lambda item: item.get("side")),
        "regime_stats": _grouped(evaluations, lambda item: item.get("market_regime_id")),
        "optimizer": _optimizer(evaluations),
        "target_calibration": {
            "sample_count": sum(item.get("target_calibration") is not None for item in evaluations),
            "average_mfe_r": _mean(item.get("mfe_r") for item in evaluations),
            "average_target_to_mfe_ratio": _mean(item.get("target_calibration") for item in evaluations),
        },
        "evaluations": sorted(evaluations, key=lambda item: timestamp_ms(item.get("exit_datetime")) or 0, reverse=True),
        "plans": plans, "warnings": sorted(set(path_warnings + regime_warnings)),
    }}


__all__ = [
    "ADHERENCE_THRESHOLD", "ADHERENCE_WEIGHTS", "evaluate_plan", "plan_geometry",
    "run_plan_lab_service",
]
