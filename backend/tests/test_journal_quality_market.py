from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.modules.journal import exit_hold_analysis
from backend.modules.journal.exit_hold_analysis import _hold_aggregates
from backend.modules.journal.quality_market import (
    analyze_exit_hold_results,
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
    direct_hold = analyze_exit_hold_results(entry, frame)

    assert result is not None
    assert direct_hold is not None
    assert result["hold_results"] == direct_hold["hold_results"]
    assert result["post_exit_candle_count"] == 6
    assert result["hold_results"]["4"]["available"] is True
    assert result["hold_results"]["6"]["available"] is True
    assert result["hold_results"]["7"]["available"] is False
    assert result["hold_results"]["5"]["available"] is True
    assert result["hold_results"]["10"]["available"] is False
    assert result["r_available"] is False


def test_exit_hold_results_support_selected_frame_without_indicators(monkeypatch):
    frame = _frame()
    entry_row = frame.iloc[220]
    exit_row = frame.iloc[230]
    now_ms = int(frame.iloc[237]["close_time"]) + 1
    monkeypatch.setattr(pd.Timestamp, "now", classmethod(lambda cls, tz=None: pd.Timestamp(now_ms, unit="ms", tz="UTC")))
    entry = {
        "entry_price": float(entry_row["close"]),
        "exit_price": float(exit_row["close"]),
        "entry_datetime": pd.Timestamp(int(entry_row["open_time"]), unit="ms", tz="UTC").isoformat(),
        "datetime": pd.Timestamp(int(exit_row["close_time"]), unit="ms", tz="UTC").isoformat(),
        "direction": "Long",
    }

    result = analyze_exit_hold_results(entry, frame)

    assert result is not None
    assert result["post_exit_candle_count"] == 7
    assert result["hold_results"]["1"]["available"] is True
    assert result["hold_results"]["7"]["available"] is True
    assert result["hold_results"]["8"]["available"] is False


@pytest.mark.parametrize(
    ("interval_ms", "expected_elapsed_ms"),
    [
        (60 * 60 * 1000, 3 * 60 * 60 * 1000),
        (2 * 60 * 60 * 1000, 6 * 60 * 60 * 1000),
        (4 * 60 * 60 * 1000, 12 * 60 * 60 * 1000),
        (24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000),
    ],
)
def test_exit_hold_horizon_uses_selected_frame_interval(interval_ms, expected_elapsed_ms):
    count = 15
    start = 1_600_000_000_000
    close = np.linspace(100.0, 114.0, count)
    open_time = start + np.arange(count) * interval_ms
    frame = pd.DataFrame({
        "open_time": open_time,
        "close_time": open_time + interval_ms - 1,
        "open": close - 0.2,
        "high": close + 0.8,
        "low": close - 0.8,
        "close": close,
        "volume": np.full(count, 100.0),
    })
    entry = {
        "entry_price": float(frame.iloc[0]["close"]),
        "exit_price": float(frame.iloc[1]["close"]),
        "entry_datetime": pd.Timestamp(int(frame.iloc[0]["open_time"]), unit="ms", tz="UTC").isoformat(),
        "datetime": pd.Timestamp(int(frame.iloc[1]["close_time"]), unit="ms", tz="UTC").isoformat(),
        "direction": "Long",
    }

    result = analyze_exit_hold_results(entry, frame)

    assert result is not None
    third = result["hold_results"]["3"]
    assert third["available"] is True
    assert third["bars"] == 3
    assert third["exit_time"] - int(frame.iloc[1]["close_time"]) == expected_elapsed_ms
    assert third["exit_price"] == pytest.approx(float(frame.iloc[4]["close"]))


def test_exit_hold_aggregates_exclude_unavailable_horizons_instead_of_zero():
    complete = {
        "hold_results": {
            "actual": {"available": True, "return_pct": 1.0},
            **{str(index): {"available": True, "return_pct": float(index)} for index in range(1, 11)},
        }
    }
    recent = {
        "hold_results": {
            "actual": {"available": True, "return_pct": -1.0},
            "1": {"available": True, "return_pct": 0.5},
            "2": {"available": True, "return_pct": 1.5},
            **{str(index): {"available": False, "reason": "future_candle_unavailable"} for index in range(3, 11)},
        }
    }

    aggregates = _hold_aggregates([complete, recent])

    assert aggregates["1"]["available_count"] == 2
    assert aggregates["2"]["available_count"] == 2
    assert aggregates["3"]["available_count"] == 1
    assert aggregates["10"]["available_count"] == 1
    assert aggregates["3"]["average_return_pct"] == pytest.approx(3.0)


@pytest.mark.parametrize("interval", ["15m", "1h", "2h", "4h", "1d"])
def test_exit_hold_service_loads_the_selected_ohlcv_interval(monkeypatch, interval):
    interval_ms = exit_hold_analysis.INTERVAL_MS[interval]
    count = 15
    start = 1_700_000_000_000
    close = np.linspace(100.0, 114.0, count)
    open_time = start + np.arange(count) * interval_ms
    frame = pd.DataFrame({
        "open_time": open_time,
        "close_time": open_time + interval_ms - 1,
        "open": close - 0.2,
        "high": close + 0.8,
        "low": close - 0.8,
        "close": close,
        "volume": np.full(count, 100.0),
    })
    position = {
        "id": 1,
        "source": "deepcoin_position",
        "exchange": "deepcoin",
        "symbol": "BTCUSDT",
        "direction": "Long",
        "entry_price": float(frame.iloc[0]["close"]),
        "exit_price": float(frame.iloc[1]["close"]),
        "entry_datetime": pd.Timestamp(int(frame.iloc[0]["open_time"]), unit="ms", tz="UTC").isoformat(),
        "datetime": pd.Timestamp(int(frame.iloc[1]["close_time"]), unit="ms", tz="UTC").isoformat(),
    }
    captured = []

    monkeypatch.setattr(exit_hold_analysis.repository, "list_entries", lambda: [position])
    monkeypatch.setattr(exit_hold_analysis, "closed_positions", lambda entries, start_time, end_time: list(entries))
    monkeypatch.setattr(exit_hold_analysis, "_filter_positions_by_net_return", lambda positions, minimum: (positions, {
        "basis": "net_return_on_invested_margin",
        "minimum_abs_net_return_pct": minimum,
        "candidate_count": len(positions),
        "included_count": len(positions),
        "excluded_below_threshold_count": 0,
        "excluded_return_unavailable_count": 0,
    }))
    monkeypatch.setattr(exit_hold_analysis.EXIT_HOLD_CACHE, "get", lambda key: None)
    monkeypatch.setattr(exit_hold_analysis.EXIT_HOLD_CACHE, "set", lambda key, value: None)
    monkeypatch.setattr(exit_hold_analysis, "market_source", lambda loaded: "Binance USDT-M Futures")

    def fake_load(symbol, requested_interval, **kwargs):
        captured.append((symbol, requested_interval, kwargs))
        return frame

    monkeypatch.setattr(exit_hold_analysis, "load_journal_ohlcv", fake_load)

    result = exit_hold_analysis.run_journal_exit_hold_analysis_service(
        start_time=int(frame.iloc[0]["open_time"]),
        end_time=int(frame.iloc[-1]["close_time"]),
        interval=interval,
    )

    assert captured[0][0] == "BTCUSDT"
    assert captured[0][1] == interval
    assert result["data"]["interval"] == interval
    assert result["data"]["direction_breakdown"]["Long"]["hold_results"]["10"]["available_count"] == 1
