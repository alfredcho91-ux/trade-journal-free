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
    except (TypeError, ValueError):
        return None
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    return int(timestamp.timestamp() * 1000)


def finite_float(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def market_group_key(entry: Dict[str, Any]) -> tuple[str, str]:
    """Keep positions from different exchanges out of the same OHLCV analysis."""
    exchange = str(entry.get("exchange") or "unknown").strip().lower()
    symbol = str(entry.get("symbol") or "").strip().upper()
    return exchange, symbol


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
