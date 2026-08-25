"""Point-in-time market regime and counterfactual exit calculations."""

from __future__ import annotations

import math
from typing import Any, Dict, Optional, Tuple

import pandas as pd

from core.indicator_pipelines import compute_trend_judgment_indicators

TREND_INTERVALS = ("1w", "1d", "4h")
HOLD_HORIZONS = tuple(range(1, 11))
TRAILING_ATR_MULTIPLIER = 2.0


def finite(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def prepare_quality_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Add shared momentum indicators plus the requested EMA structure."""
    prepared = compute_trend_judgment_indicators(frame.copy().reset_index(drop=True))
    close = prepared["close"]
    for length in (20, 50, 200):
        prepared[f"ema{length}"] = close.ewm(
            span=length,
            adjust=False,
            min_periods=length,
        ).mean()
    return prepared


def _dow_direction(completed: pd.DataFrame, pivot_span: int = 2) -> str:
    """Use only already-confirmed swing highs/lows from completed candles."""
    recent = completed.tail(100).reset_index(drop=True)
    if len(recent) < pivot_span * 2 + 4:
        return "sideways"

    swing_highs = []
    swing_lows = []
    for index in range(pivot_span, len(recent) - pivot_span):
        high = finite(recent.iloc[index]["high"])
        low = finite(recent.iloc[index]["low"])
        if high is None or low is None:
            continue
        window = recent.iloc[index - pivot_span:index + pivot_span + 1]
        if high >= float(window["high"].max()):
            swing_highs.append(high)
        if low <= float(window["low"].min()):
            swing_lows.append(low)

    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return "sideways"
    if swing_highs[-1] > swing_highs[-2] and swing_lows[-1] > swing_lows[-2]:
        return "up"
    if swing_highs[-1] < swing_highs[-2] and swing_lows[-1] < swing_lows[-2]:
        return "down"
    return "sideways"


def _trend_state_from_completed(completed: pd.DataFrame) -> Dict[str, Any]:
    if len(completed) < 200:
        return {"status": "unavailable", "reason": "insufficient_completed_candles"}

    row = completed.iloc[-1]
    previous = completed.iloc[-2]
    close = finite(row.get("close"))
    ema20 = finite(row.get("ema20"))
    ema50 = finite(row.get("ema50"))
    ema200 = finite(row.get("ema200"))
    if None in (close, ema20, ema50, ema200):
        return {"status": "unavailable", "reason": "indicator_warmup_incomplete"}

    if ema20 > ema50 > ema200:
        ema_alignment = "bullish"
    elif ema20 < ema50 < ema200:
        ema_alignment = "bearish"
    else:
        ema_alignment = "mixed"

    price_vs_ema = {
        "ema20": "above" if close >= ema20 else "below",
        "ema50": "above" if close >= ema50 else "below",
        "ema200": "above" if close >= ema200 else "below",
    }
    above_all = all(value == "above" for value in price_vs_ema.values())
    below_all = all(value == "below" for value in price_vs_ema.values())

    macd_line = finite(row.get("macd"))
    macd_signal = finite(row.get("macd_signal"))
    macd_hist = finite(row.get("macd_hist"))
    previous_hist = finite(previous.get("macd_hist"))
    macd_direction = (
        "bullish" if macd_line is not None and macd_signal is not None and macd_line >= macd_signal
        else "bearish"
    )
    if macd_hist is None or previous_hist is None:
        macd_momentum = "unknown"
    elif abs(macd_hist) > abs(previous_hist):
        macd_momentum = "strengthening"
    else:
        macd_momentum = "weakening"

    dow_direction = _dow_direction(completed)
    score = 0
    score += 2 if ema_alignment == "bullish" else -2 if ema_alignment == "bearish" else 0
    score += 1 if above_all else -1 if below_all else 0
    score += 1 if macd_hist is not None and macd_hist >= 0 else -1
    score += 1 if dow_direction == "up" else -1 if dow_direction == "down" else 0
    direction = "up" if score >= 2 else "down" if score <= -2 else "sideways"

    adx = finite(row.get("adx"))
    atr = finite(row.get("atr"))
    strength = "unknown"
    if adx is not None:
        strength = "strong" if adx >= 25 else "moderate" if adx >= 18 else "weak"

    return {
        "status": "complete",
        "candle_close_time": int(row["close_time"]),
        "direction": direction,
        "trend_score": score,
        "strength": strength,
        "adx": adx,
        "atr": atr,
        "close": close,
        "ema20": ema20,
        "ema50": ema50,
        "ema200": ema200,
        "ema_alignment": ema_alignment,
        "price_vs_ema": price_vs_ema,
        "macd": {
            "line": macd_line,
            "signal": macd_signal,
            "histogram": macd_hist,
            "direction": macd_direction,
            "momentum": macd_momentum,
        },
        "dow_direction": dow_direction,
    }


def point_in_time_trend_state(frame: pd.DataFrame, entry_time_ms: int) -> Tuple[Dict[str, Any], str]:
    """Return current and previous trend directions using only pre-entry bars."""
    completed = frame.loc[frame["close_time"] < entry_time_ms]
    current = _trend_state_from_completed(completed)
    previous_direction = "unavailable"
    if len(completed) > 200:
        previous = _trend_state_from_completed(completed.iloc[:-1])
        previous_direction = str(previous.get("direction") or "unavailable")
    return current, previous_direction


def classify_market_regime(states: Dict[str, Dict[str, Any]], previous_4h_direction: str) -> Dict[str, str]:
    weekly = states.get("1w", {}).get("direction")
    daily = states.get("1d", {}).get("direction")
    four_hour = states.get("4h", {}).get("direction")
    if any(value not in {"up", "down", "sideways"} for value in (weekly, daily, four_hour)):
        return {"id": "unavailable", "alignment": "unavailable", "trade_bias": "neutral"}

    if weekly == daily == four_hour and weekly in {"up", "down"}:
        if previous_4h_direction != four_hour and previous_4h_direction in {"up", "down", "sideways"}:
            regime_id = f"higher_{weekly}_4h_reentry"
        else:
            regime_id = f"aligned_{weekly}"
        return {"id": regime_id, "alignment": "aligned", "trade_bias": weekly}

    if weekly == daily and weekly in {"up", "down"} and four_hour != weekly:
        return {
            "id": f"higher_{weekly}_4h_pullback",
            "alignment": "higher_vs_4h",
            "trade_bias": weekly,
        }

    if weekly == "sideways" and daily == four_hour and daily in {"up", "down"}:
        return {
            "id": f"weekly_sideways_mid_{daily}",
            "alignment": "weekly_unclear",
            "trade_bias": daily,
        }

    if weekly in {"up", "down"} and daily == four_hour and daily != weekly:
        return {
            "id": f"weekly_{weekly}_mid_{daily}_conflict",
            "alignment": "conflict",
            "trade_bias": weekly,
        }

    return {"id": "mixed", "alignment": "conflict", "trade_bias": "neutral"}


def trade_alignment(direction: str, market_bias: str) -> str:
    if market_bias not in {"up", "down"}:
        return "neutral"
    if (direction == "Long" and market_bias == "up") or (direction == "Short" and market_bias == "down"):
        return "with_trend"
    return "counter_trend"


def directional_return_pct(entry_price: float, exit_price: float, direction: str) -> float:
    side = -1.0 if direction == "Short" else 1.0
    return ((exit_price - entry_price) / entry_price) * 100.0 * side


def _risk_pct(entry: Dict[str, Any], actual_return_pct: float) -> Optional[float]:
    actual_r = finite(entry.get("r_multiple"))
    if actual_r is None or abs(actual_r) <= 1e-12 or abs(actual_return_pct) <= 1e-12:
        return None
    risk = abs(actual_return_pct / actual_r)
    return risk if risk > 0 else None


def _exit_result(
    entry_price: float,
    exit_price: float,
    direction: str,
    exit_time: int,
    bars: int,
    risk_pct: Optional[float],
) -> Dict[str, Any]:
    return_pct = directional_return_pct(entry_price, exit_price, direction)
    return {
        "available": True,
        "exit_time": int(exit_time),
        "exit_price": float(exit_price),
        "return_pct": return_pct,
        "r_multiple": return_pct / risk_pct if risk_pct else None,
        "bars": bars,
    }


def analyze_exit_hold_results(
    entry: Dict[str, Any],
    frame: pd.DataFrame,
) -> Optional[Dict[str, Any]]:
    """Replay only the recorded exit and the next completed candles.

    This intentionally has no indicator or virtual-exit work so the exit-hold
    view can use a user-selected candle interval without changing the 4H
    quality-analysis pipeline.
    """
    entry_price = finite(entry.get("entry_price"))
    exit_price = finite(entry.get("exit_price"))
    exit_time_ms = finite_timestamp(entry.get("datetime"))
    direction = str(entry.get("direction") or "")
    if None in (entry_price, exit_price, exit_time_ms) or direction not in {"Long", "Short"}:
        return None

    actual_return = directional_return_pct(entry_price, exit_price, direction)
    risk_pct = _risk_pct(entry, actual_return)
    now_ms = int(pd.Timestamp.now(tz="UTC").timestamp() * 1000)
    completed = frame.loc[frame["close_time"] < now_ms]
    post = completed.loc[completed["close_time"] > exit_time_ms].head(max(HOLD_HORIZONS))
    hold_results: Dict[str, Dict[str, Any]] = {
        "actual": _exit_result(entry_price, exit_price, direction, int(exit_time_ms), 0, risk_pct)
    }
    for horizon in HOLD_HORIZONS:
        if len(post) < horizon:
            hold_results[str(horizon)] = {"available": False, "reason": "future_candle_unavailable"}
            continue
        row = post.iloc[horizon - 1]
        hold_results[str(horizon)] = _exit_result(
            entry_price,
            float(row["close"]),
            direction,
            int(row["close_time"]),
            horizon,
            risk_pct,
        )
    return {
        "actual_return_pct": actual_return,
        "hold_results": hold_results,
        "post_exit_candle_count": len(post),
    }


def _signal_virtual_exits(
    frame: pd.DataFrame,
    entry_time_ms: int,
    horizon_end_ms: int,
    entry_price: float,
    direction: str,
    risk_pct: Optional[float],
) -> Dict[str, Dict[str, Any]]:
    side = -1.0 if direction == "Short" else 1.0
    candidates = frame.loc[
        (frame["open_time"] >= entry_time_ms)
        & (frame["close_time"] <= horizon_end_ms)
    ]
    strategy_columns = {
        "rsi_overheat": ("rsi",),
        "stoch_rsi_overheat": ("stoch_rsi_k",),
        "slow_5_overheat": ("slow_stoch_5k",),
        "slow_10_overheat": ("slow_stoch_10k",),
        "slow_20_overheat": ("slow_stoch_20k",),
        "slow_5_cross": ("slow_stoch_5k", "slow_stoch_5d"),
        "slow_10_cross": ("slow_stoch_10k", "slow_stoch_10d"),
        "slow_20_cross": ("slow_stoch_20k", "slow_stoch_20d"),
        "macd_weakening": ("macd_hist",),
        "atr_trailing_stop": ("atr",),
    }
    results: Dict[str, Dict[str, Any]] = {
        strategy_id: {"available": False, "reason": "not_triggered"}
        for strategy_id in strategy_columns
    }
    if candidates.empty:
        return results

    armed = {"5": False, "10": False, "20": False}
    prior = frame.loc[frame["close_time"] < entry_time_ms]
    prior_atr = finite(prior.iloc[-1].get("atr")) if not prior.empty else None
    trailing_anchor = entry_price
    trailing_stop = (
        entry_price - TRAILING_ATR_MULTIPLIER * prior_atr
        if direction == "Long" and prior_atr is not None
        else entry_price + TRAILING_ATR_MULTIPLIER * prior_atr
        if direction == "Short" and prior_atr is not None
        else None
    )

    candidate_indices = list(candidates.index)
    for bars, index in enumerate(candidate_indices, start=1):
        row = frame.loc[index]
        previous = frame.iloc[frame.index.get_loc(index) - 1] if frame.index.get_loc(index) > 0 else None
        close = finite(row.get("close"))
        if close is None:
            continue

        def set_close_signal(strategy_id: str) -> None:
            if results[strategy_id]["available"]:
                return
            results[strategy_id] = _exit_result(
                entry_price,
                close,
                direction,
                int(row["close_time"]),
                bars,
                risk_pct,
            )

        rsi = finite(row.get("rsi"))
        if rsi is not None and ((direction == "Long" and rsi >= 70) or (direction == "Short" and rsi <= 30)):
            set_close_signal("rsi_overheat")

        stoch_rsi = finite(row.get("stoch_rsi_k"))
        if stoch_rsi is not None and ((direction == "Long" and stoch_rsi >= 80) or (direction == "Short" and stoch_rsi <= 20)):
            set_close_signal("stoch_rsi_overheat")

        for key in ("5", "10", "20"):
            k = finite(row.get(f"slow_stoch_{key}k"))
            d = finite(row.get(f"slow_stoch_{key}d"))
            previous_k = finite(previous.get(f"slow_stoch_{key}k")) if previous is not None else None
            previous_d = finite(previous.get(f"slow_stoch_{key}d")) if previous is not None else None
            overheated = k is not None and ((direction == "Long" and k >= 80) or (direction == "Short" and k <= 20))
            if overheated:
                armed[key] = True
                set_close_signal(f"slow_{key}_overheat")
            opposite_cross = (
                armed[key]
                and None not in (k, d, previous_k, previous_d)
                and (
                    (direction == "Long" and previous_k >= previous_d and k < d)
                    or (direction == "Short" and previous_k <= previous_d and k > d)
                )
            )
            if opposite_cross:
                set_close_signal(f"slow_{key}_cross")

        hist = finite(row.get("macd_hist"))
        previous_hist = finite(previous.get("macd_hist")) if previous is not None else None
        if hist is not None and previous_hist is not None:
            signed_hist = hist * side
            signed_previous = previous_hist * side
            if signed_previous > 0 and (signed_hist <= 0 or signed_hist < signed_previous):
                set_close_signal("macd_weakening")

        if trailing_stop is not None and not results["atr_trailing_stop"]["available"]:
            open_price = finite(row.get("open")) or close
            low = finite(row.get("low"))
            high = finite(row.get("high"))
            hit = (direction == "Long" and low is not None and low <= trailing_stop) or (
                direction == "Short" and high is not None and high >= trailing_stop
            )
            if hit:
                fill_price = (
                    min(open_price, trailing_stop) if direction == "Long"
                    else max(open_price, trailing_stop)
                )
                results["atr_trailing_stop"] = _exit_result(
                    entry_price,
                    fill_price,
                    direction,
                    int(row["close_time"]),
                    bars,
                    risk_pct,
                )
            atr = finite(row.get("atr"))
            if atr is not None and low is not None and high is not None:
                if direction == "Long":
                    trailing_anchor = max(trailing_anchor, high)
                    trailing_stop = max(trailing_stop, trailing_anchor - TRAILING_ATR_MULTIPLIER * atr)
                else:
                    trailing_anchor = min(trailing_anchor, low)
                    trailing_stop = min(trailing_stop, trailing_anchor + TRAILING_ATR_MULTIPLIER * atr)

    return results


def analyze_exit_quality(
    entry: Dict[str, Any],
    frame_4h: pd.DataFrame,
    excursion: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    entry_price = finite(entry.get("entry_price"))
    exit_price = finite(entry.get("exit_price"))
    entry_time_ms = finite_timestamp(entry.get("entry_datetime"))
    exit_time_ms = finite_timestamp(entry.get("datetime"))
    direction = str(entry.get("direction") or "")
    if None in (entry_price, exit_price, entry_time_ms, exit_time_ms) or direction not in {"Long", "Short"}:
        return None

    actual_return = directional_return_pct(entry_price, exit_price, direction)
    risk_pct = _risk_pct(entry, actual_return)
    now_ms = int(pd.Timestamp.now(tz="UTC").timestamp() * 1000)
    completed_4h = frame_4h.loc[frame_4h["close_time"] < now_ms]
    post = completed_4h.loc[completed_4h["close_time"] > exit_time_ms].head(10)
    hold_analysis = analyze_exit_hold_results(entry, frame_4h)
    if hold_analysis is None:
        return None
    hold_results = hold_analysis["hold_results"]

    best_post_return = actual_return
    worst_post_return = actual_return
    if not post.empty:
        if direction == "Long":
            best_post_return = directional_return_pct(entry_price, float(post["high"].max()), direction)
            worst_post_return = directional_return_pct(entry_price, float(post["low"].min()), direction)
        else:
            best_post_return = directional_return_pct(entry_price, float(post["low"].min()), direction)
            worst_post_return = directional_return_pct(entry_price, float(post["high"].max()), direction)

    mfe = finite(excursion.get("mfe_pct")) if excursion else None
    raw_capture = finite(excursion.get("capture_pct")) if excursion else None
    capture = min(100.0, max(0.0, raw_capture)) if raw_capture is not None else None
    profit_give_up = max(0.0, mfe - actual_return) if mfe is not None else None
    horizon_end_ms = int(post.iloc[-1]["close_time"]) if not post.empty else int(exit_time_ms)
    virtual_exits = _signal_virtual_exits(
        completed_4h,
        int(entry_time_ms),
        horizon_end_ms,
        entry_price,
        direction,
        risk_pct,
    )
    return {
        "actual_return_pct": actual_return,
        "actual_r_multiple": finite(entry.get("r_multiple")),
        "r_available": risk_pct is not None,
        "r_unavailable_reason": None if risk_pct is not None else "stored_risk_or_r_multiple_unavailable",
        "hold_results": hold_results,
        "post_exit_mfe_pct": max(0.0, best_post_return - actual_return),
        "post_exit_adverse_pct": max(0.0, actual_return - worst_post_return),
        "additional_profit_potential_pct": max(0.0, best_post_return - actual_return),
        "capture_ratio_pct": capture,
        "profit_give_up_pct": profit_give_up,
        "post_exit_candle_count": len(post),
        "virtual_exits": virtual_exits,
    }


def finite_timestamp(value: Any) -> Optional[int]:
    if not value:
        return None
    try:
        timestamp = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    return int(timestamp.timestamp() * 1000)


__all__ = [
    "HOLD_HORIZONS",
    "TREND_INTERVALS",
    "TRAILING_ATR_MULTIPLIER",
    "analyze_exit_quality",
    "analyze_exit_hold_results",
    "classify_market_regime",
    "directional_return_pct",
    "finite",
    "finite_timestamp",
    "point_in_time_trend_state",
    "prepare_quality_frame",
    "trade_alignment",
]
