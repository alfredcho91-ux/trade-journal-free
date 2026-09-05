"""Shared selection and batching helpers for closed journal positions."""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

EXCURSION_INTERVAL = "15m"
EXCURSION_INTERVAL_MS = 15 * 60 * 1000
MAX_EXCURSION_CANDLES = 10_000
EXCURSION_BATCH_SPAN_MS = (MAX_EXCURSION_CANDLES - 4) * EXCURSION_INTERVAL_MS


def timestamp_ms(value: Any) -> Optional[int]:
    if not value:
        return None
    try:
        timestamp = pd.Timestamp(value)
        # pandas accepts values such as the literal "NaT" but they are not
        # usable instants. Treat them as absent historical timestamps instead
        # of letting timestamp()/tz handling leak an exception to callers.
        if pd.isna(timestamp):
            return None
    except (TypeError, ValueError, OverflowError):
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    try:
        return int(timestamp.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        return None


def finite_float(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def instrument_type(entry: Dict[str, Any]) -> str:
    """Recover the synced market type without guessing from a symbol alone."""
    tags = {tag.strip().lower() for tag in str(entry.get("tags") or "").split(",")}
    return "SPOT" if "spot" in tags else "SWAP"


def market_group_key(entry: Dict[str, Any]) -> tuple[str, str, str]:
    """Keep positions from different exchanges out of the same OHLCV analysis."""
    exchange = str(entry.get("exchange") or "unknown").strip().lower()
    symbol = str(entry.get("symbol") or "").strip().upper()
    return exchange, instrument_type(entry), symbol


def path_covers_position(
    candles: pd.DataFrame,
    entry_time: int,
    exit_time: int,
    interval_ms: int,
) -> bool:
    """Return whether contiguous candle history covers the position lifetime."""
    if candles is None or candles.empty or entry_time > exit_time:
        return False
    if "open_time" not in candles.columns or "close_time" not in candles.columns:
        return False
    bounds = pd.DataFrame({
        "open_time": pd.to_numeric(candles["open_time"], errors="coerce"),
        "close_time": pd.to_numeric(candles["close_time"], errors="coerce"),
    }).dropna().drop_duplicates(subset=["open_time"]).sort_values("open_time")
    bounds = bounds.loc[
        (bounds["close_time"] >= entry_time - 1)
        & (bounds["open_time"] <= exit_time)
    ].reset_index(drop=True)
    if bounds.empty:
        return False
    opens = bounds["open_time"].to_numpy(dtype=float)
    closes = bounds["close_time"].to_numpy(dtype=float)
    if (
        opens[0] > entry_time
        or closes[0] < entry_time - 1
        or opens[-1] > exit_time
        or closes[-1] < exit_time - 1
    ):
        return False
    if ((closes < opens) | ((closes - opens + 1) > interval_ms)).any():
        return False
    return bool(len(opens) == 1 or (opens[1:] <= closes[:-1] + 1).all())


def closed_positions(
    entries: Iterable[Dict[str, Any]],
    start_time: int,
    end_time: int,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    for entry in entries:
        if not str(entry.get("source") or "").endswith("_position"):
            continue
        close_time = timestamp_ms(entry.get("datetime"))
        entry_time = timestamp_ms(entry.get("entry_datetime"))
        if close_time is None or entry_time is None or not start_time <= close_time <= end_time:
            continue
        if entry_time > close_time:
            continue
        if finite_float(entry.get("entry_price")) is None or finite_float(entry.get("exit_price")) is None:
            continue
        selected.append(entry)
    return selected


def position_batches(positions: Iterable[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Group positions so each 15m request stays inside the bounded history window."""
    ordered = sorted(positions, key=lambda item: timestamp_ms(item.get("entry_datetime")) or 0)
    batches: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    earliest_entry: Optional[int] = None
    latest_close: Optional[int] = None
    for position in ordered:
        entry_time = timestamp_ms(position.get("entry_datetime"))
        close_time = timestamp_ms(position.get("datetime"))
        if entry_time is None or close_time is None:
            continue
        next_earliest = min(earliest_entry, entry_time) if earliest_entry is not None else entry_time
        next_latest = max(latest_close, close_time) if latest_close is not None else close_time
        if current and next_latest - next_earliest > EXCURSION_BATCH_SPAN_MS:
            batches.append(current)
            current = []
            next_earliest = entry_time
            next_latest = close_time
        current.append(position)
        earliest_entry = next_earliest
        latest_close = next_latest
    if current:
        batches.append(current)
    return batches
