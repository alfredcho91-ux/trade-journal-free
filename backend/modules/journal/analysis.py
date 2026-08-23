"""Point-in-time trade excursion analysis for closed journal positions."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from backend.modules.journal import repository
from backend.modules.journal.trade_selection import (
    EXCURSION_BATCH_SPAN_MS,
    EXCURSION_INTERVAL,
    EXCURSION_INTERVAL_MS,
    MAX_EXCURSION_CANDLES,
    closed_positions,
    finite_float,
    market_group_key,
    position_batches,
    timestamp_ms,
)
from backend.modules.journal.market_data import is_market_fallback, load_journal_ohlcv, market_source

_timestamp_ms = timestamp_ms
_finite_float = finite_float
_closed_positions = closed_positions


def _classification(mfe_pct: float, mae_pct: float, realized_move_pct: float) -> str:
    if mfe_pct >= mae_pct and realized_move_pct < mfe_pct * 0.5:
        return "good_entry_poor_exit"
    if mae_pct > mfe_pct and realized_move_pct <= 0:
        return "poor_entry"
    return "balanced"


def _trade_excursion(entry: Dict[str, Any], candles: pd.DataFrame) -> Optional[Dict[str, Any]]:
    entry_time = _timestamp_ms(entry.get("entry_datetime"))
    close_time = _timestamp_ms(entry.get("datetime"))
    entry_price = _finite_float(entry.get("entry_price"))
    exit_price = _finite_float(entry.get("exit_price"))
    if None in (entry_time, close_time, entry_price, exit_price) or entry_price <= 0:
        return None

    internal = candles.loc[
        (pd.to_numeric(candles["open_time"], errors="coerce") >= entry_time)
        & (pd.to_numeric(candles["close_time"], errors="coerce") <= close_time)
    ]
    highs = [entry_price, exit_price]
    lows = [entry_price, exit_price]
    if not internal.empty:
        highs.extend(pd.to_numeric(internal["high"], errors="coerce").dropna().tolist())
        lows.extend(pd.to_numeric(internal["low"], errors="coerce").dropna().tolist())

    high = max(highs)
    low = min(lows)
    direction = entry.get("direction")
    if direction == "Short":
        mfe_pct = max(0.0, (entry_price - low) / entry_price * 100)
        mae_pct = max(0.0, (high - entry_price) / entry_price * 100)
        realized_move_pct = (entry_price - exit_price) / entry_price * 100
    else:
        mfe_pct = max(0.0, (high - entry_price) / entry_price * 100)
        mae_pct = max(0.0, (entry_price - low) / entry_price * 100)
        realized_move_pct = (exit_price - entry_price) / entry_price * 100

    capture_pct = (realized_move_pct / mfe_pct * 100) if mfe_pct > 0 else None
    return {
        "journal_id": int(entry["id"]),
        "mfe_pct": mfe_pct,
        "mae_pct": mae_pct,
        "realized_move_pct": realized_move_pct,
        "capture_pct": capture_pct,
        "classification": _classification(mfe_pct, mae_pct, realized_move_pct),
        "candle_count": len(internal),
    }


_position_batches = position_batches


def run_journal_excursions_service(start_time: int, end_time: int) -> Dict[str, Any]:
    """Calculate MFE/MAE without using candle extremes outside each position lifetime."""
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")

    positions = _closed_positions(repository.list_entries(), start_time, end_time)
    by_market: Dict[tuple[str, str, str], List[Dict[str, Any]]] = defaultdict(list)
    for position in positions:
        if position.get("symbol"):
            by_market[market_group_key(position)].append(position)

    excursions: List[Dict[str, Any]] = []
    warnings: List[str] = []
    for (exchange, instrument_type, symbol), symbol_positions in by_market.items():
        for batch_index, batch in enumerate(_position_batches(symbol_positions), start=1):
            earliest_entry = min(_timestamp_ms(item["entry_datetime"]) or end_time for item in batch)
            latest_close = max(_timestamp_ms(item["datetime"]) or start_time for item in batch)
            requested = math.ceil((latest_close - earliest_entry) / EXCURSION_INTERVAL_MS) + 4
            if requested > MAX_EXCURSION_CANDLES:
                warnings.append(f"{symbol}: a position exceeds the {MAX_EXCURSION_CANDLES}-candle analysis limit")
            requested = min(MAX_EXCURSION_CANDLES, max(1, requested))
            candles = load_journal_ohlcv(
                symbol,
                EXCURSION_INTERVAL,
                total_candles=requested,
                end_time=latest_close,
                exchange=exchange,
                instrument_type=instrument_type,
            )
            if candles is None or candles.empty:
                warnings.append(f"{symbol} batch {batch_index}: market data unavailable")
                continue
            if is_market_fallback(candles):
                warnings.append(f"{symbol} {EXCURSION_INTERVAL}: {market_source(candles)}")

            for position in batch:
                result = _trade_excursion(position, candles)
                if result is not None:
                    excursions.append(result)

    excursions.sort(key=lambda item: item["journal_id"])
    return {
        "success": True,
        "data": {
            "interval": EXCURSION_INTERVAL,
            "items": excursions,
            "warnings": warnings,
        },
    }


__all__ = ["run_journal_excursions_service"]
