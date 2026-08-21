from __future__ import annotations

import numpy as np
import pandas as pd

from backend.modules.journal.quality_market import (
    analyze_exit_quality,
    classify_market_regime,
    point_in_time_trend_state,
    prepare_quality_frame,
)


FOUR_HOURS_MS = 4 * 60 * 60 * 1000


def _frame(count: int = 260, start: int = 1_600_000_000_000) -> pd.DataFrame:
    close = np.linspace(100.0, 180.0, count)
    open_time = start + np.arange(count) * FOUR_HOURS_MS
    return pd.DataFrame({
        "open_time": open_time,
        "close_time": open_time + FOUR_HOURS_MS - 1,
        "open": close - 0.2,
        "high": close + 0.8,
        "low": close - 0.8,
        "close": close,
        "volume": np.full(count, 100.0),
    })


def test_point_in_time_trend_ignores_post_entry_mutation():
    frame = _frame()
    prepared = prepare_quality_frame(frame)
    entry_time = int(frame.iloc[230]["open_time"])
    before, _ = point_in_time_trend_state(prepared, entry_time)

    mutated = frame.copy()
    mutated.loc[mutated["open_time"] >= entry_time, "close"] = 1.0
    mutated.loc[mutated["open_time"] >= entry_time, ["open", "high", "low"]] = 1.0
    after, _ = point_in_time_trend_state(prepare_quality_frame(mutated), entry_time)

    assert before == after
    assert before["status"] == "complete"
    assert before["direction"] == "up"


def test_market_regime_distinguishes_alignment_pullback_and_reentry():
    aligned = {key: {"direction": "up"} for key in ("1w", "1d", "4h")}
    pullback = {"1w": {"direction": "up"}, "1d": {"direction": "up"}, "4h": {"direction": "down"}}

    assert classify_market_regime(aligned, "up")["id"] == "aligned_up"
    assert classify_market_regime(aligned, "down")["id"] == "higher_up_4h_reentry"
    assert classify_market_regime(pullback, "up")["id"] == "higher_up_4h_pullback"


def test_exit_quality_uses_completed_post_exit_closes(monkeypatch):
    frame = prepare_quality_frame(_frame())
    entry_row = frame.iloc[220]
    exit_row = frame.iloc[230]
    now_ms = int(frame.iloc[236]["close_time"]) + 1
    monkeypatch.setattr(pd.Timestamp, "now", classmethod(lambda cls, tz=None: pd.Timestamp(now_ms, unit="ms", tz="UTC")))
    entry = {
        "entry_price": float(entry_row["close"]),
        "exit_price": float(exit_row["close"]),
        "entry_datetime": pd.Timestamp(int(entry_row["open_time"]), unit="ms", tz="UTC").isoformat(),
        "datetime": pd.Timestamp(int(exit_row["close_time"]), unit="ms", tz="UTC").isoformat(),
        "direction": "Long",
        "r_multiple": None,
    }
    excursion = {"mfe_pct": 8.0, "capture_pct": 50.0}

    result = analyze_exit_quality(entry, frame, excursion)

    assert result is not None
    assert result["post_exit_candle_count"] == 6
    assert result["hold_results"]["5"]["available"] is True
    assert result["hold_results"]["10"]["available"] is False
    assert result["r_available"] is False
