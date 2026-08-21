"""Volume Profile Visible Range (VPVR) calculations shared by API consumers."""

from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd


_REQUIRED_COLUMNS = {
    "high",
    "low",
    "close",
    "volume",
    "quote_volume",
    "taker_buy_quote_volume",
}


def _build_value_area(profile: List[Dict[str, float]], poc_index: int, target_volume: float) -> set[int]:
    """Expand from POC into the highest-volume adjacent price levels."""
    selected = {poc_index}
    accumulated = profile[poc_index]["volume"]
    left = poc_index - 1
    right = poc_index + 1

    while accumulated < target_volume and (left >= 0 or right < len(profile)):
        left_volume = profile[left]["volume"] if left >= 0 else -1.0
        right_volume = profile[right]["volume"] if right < len(profile) else -1.0

        if right_volume > left_volume:
            chosen = right
            right += 1
        else:
            chosen = left
            left -= 1

        selected.add(chosen)
        accumulated += profile[chosen]["volume"]

    return selected


def _serialize_profile(
    profile: List[Dict[str, float]],
    *,
    current_price: float,
    value_area_pct: float,
) -> Dict[str, Any]:
    total_volume = sum(level["volume"] for level in profile)
    poc_index = max(range(len(profile)), key=lambda index: profile[index]["volume"])
    value_area_indices = _build_value_area(profile, poc_index, total_volume * value_area_pct)
    value_area_low = min(profile[index]["price_low"] for index in value_area_indices)
    value_area_high = max(profile[index]["price_high"] for index in value_area_indices)

    rows = []
    for index in reversed(range(len(profile))):
        level = profile[index]
        is_last_level = index == len(profile) - 1
        rows.append(
            {
                "price_low": level["price_low"],
                "price_high": level["price_high"],
                "volume": level["volume"],
                "buy_volume": level["buy_volume"],
                "sell_volume": max(level["volume"] - level["buy_volume"], 0.0),
                "delta": (2 * level["buy_volume"]) - level["volume"],
                "volume_pct": (level["volume"] / total_volume * 100) if total_volume else 0.0,
                "is_poc": index == poc_index,
                "is_value_area": index in value_area_indices,
                "is_current": level["price_low"] <= current_price < level["price_high"]
                or (is_last_level and current_price == level["price_high"]),
            }
        )

    return {
        "price_low": profile[0]["price_low"],
        "price_high": profile[-1]["price_high"],
        "current_price": current_price,
        "total_quote_volume": total_volume,
        "poc_price_low": profile[poc_index]["price_low"],
        "poc_price_high": profile[poc_index]["price_high"],
        "value_area_low": value_area_low,
        "value_area_high": value_area_high,
        "value_area_pct": value_area_pct,
        "bin_count": len(profile),
        "bins": rows,
    }


def _resolve_price_bounds(
    *,
    data_price_low: float,
    data_price_high: float,
    current_price: float,
    max_price_range: float | None,
) -> tuple[float, float]:
    if max_price_range is None:
        return data_price_low, data_price_high

    data_span = data_price_high - data_price_low
    if 0 < data_span < max_price_range:
        padding = data_span * 0.02
        return max(0.0, data_price_low - padding), data_price_high + padding

    half_range = max_price_range / 2
    price_low = max(0.0, current_price - half_range)
    return price_low, price_low + max_price_range


def calculate_vpvr(
    candles: pd.DataFrame,
    *,
    bin_count: int = 24,
    value_area_pct: float = 0.70,
    price_range: float | None = None,
) -> Dict[str, Any]:
    """Build a quote-volume profile by proportionally allocating candle ranges.

    Exchange kline data does not include the trade-by-price distribution required
    for an exact volume profile. Each candle's quote volume is therefore spread
    across the price bins it overlaps, in proportion to its high-low range.
    """
    if bin_count < 1:
        raise ValueError("bin_count must be at least 1")
    if not 0 < value_area_pct <= 1:
        raise ValueError("value_area_pct must be between 0 and 1")
    if price_range is not None and price_range <= 0:
        raise ValueError("price_range must be greater than 0")
    missing_columns = _REQUIRED_COLUMNS.difference(candles.columns)
    if missing_columns:
        raise ValueError(f"VPVR candle data is missing columns: {', '.join(sorted(missing_columns))}")

    frame = candles.loc[:, list(_REQUIRED_COLUMNS)].copy()
    for column in _REQUIRED_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=["high", "low", "close"])
    if frame.empty:
        raise ValueError("VPVR requires at least one valid candle")

    frame["candle_low"] = frame[["low", "high"]].min(axis=1)
    frame["candle_high"] = frame[["low", "high"]].max(axis=1)
    frame["quote_volume"] = frame["quote_volume"].fillna(0.0).clip(lower=0.0)
    frame["volume"] = frame["volume"].fillna(0.0).clip(lower=0.0)
    frame["taker_buy_quote_volume"] = (
        frame["taker_buy_quote_volume"]
        .fillna(0.0)
        .clip(lower=0.0, upper=frame["quote_volume"])
    )

    data_price_low = float(frame["candle_low"].min())
    data_price_high = float(frame["candle_high"].max())
    current_price = float(frame["close"].iloc[-1])
    total_base_volume = float(frame["volume"].sum())
    period_vwap = float(frame["quote_volume"].sum() / total_base_volume) if total_base_volume else None

    price_low, price_high = _resolve_price_bounds(
        data_price_low=data_price_low,
        data_price_high=data_price_high,
        current_price=current_price,
        max_price_range=price_range,
    )
    effective_price_range = price_high - price_low

    if price_high == price_low:
        volume = float(frame["quote_volume"].sum())
        buy_volume = float(frame["taker_buy_quote_volume"].sum())
        return _serialize_profile(
            [
                {
                    "price_low": price_low,
                    "price_high": price_high,
                    "volume": volume,
                    "buy_volume": buy_volume,
                }
            ],
            current_price=current_price,
            value_area_pct=value_area_pct,
        ) | {"price_range": effective_price_range, "vwap": period_vwap}

    price_step = (price_high - price_low) / bin_count
    profile = [
        {
            "price_low": price_low + (index * price_step),
            "price_high": price_low + ((index + 1) * price_step),
            "volume": 0.0,
            "buy_volume": 0.0,
        }
        for index in range(bin_count)
    ]

    for candle in frame.itertuples(index=False):
        candle_low = float(candle.candle_low)
        candle_high = float(candle.candle_high)
        quote_volume = float(candle.quote_volume)
        buy_volume = float(candle.taker_buy_quote_volume)

        if candle_high == candle_low:
            if candle_low < price_low or candle_low > price_high:
                continue
            index = min(int((candle_low - price_low) / price_step), bin_count - 1)
            profile[index]["volume"] += quote_volume
            profile[index]["buy_volume"] += buy_volume
            continue

        visible_low = max(candle_low, price_low)
        visible_high = min(candle_high, price_high)
        if visible_high <= visible_low:
            continue

        start_index = max(int((visible_low - price_low) / price_step), 0)
        end_index = min(int((visible_high - price_low) / price_step), bin_count - 1)
        overlaps = []
        for index in range(start_index, end_index + 1):
            overlap = max(
                0.0,
                min(visible_high, profile[index]["price_high"])
                - max(visible_low, profile[index]["price_low"]),
            )
            if overlap > 0:
                overlaps.append((index, overlap))

        candle_range = candle_high - candle_low
        if not overlaps:
            continue
        for index, overlap in overlaps:
            allocation = overlap / candle_range
            profile[index]["volume"] += quote_volume * allocation
            profile[index]["buy_volume"] += buy_volume * allocation

    return _serialize_profile(
        profile,
        current_price=current_price,
        value_area_pct=value_area_pct,
    ) | {"price_range": effective_price_range, "vwap": period_vwap}


__all__ = ["calculate_vpvr"]
