import pandas as pd
import pytest
from pydantic import ValidationError

from backend.modules.journal.schemas import JournalSlTpQuery
from backend.modules.journal.sl_tp_analysis import (
    _analysis_bundle,
    grid_values,
    performance,
    simulate_trade_path,
)


def _path(*rows):
    return pd.DataFrame(rows, columns=["high", "low"])


def _item(index, *, direction="Long", path=None, exit_price=101.0, fee_pct=0.0):
    return {
        "journal_id": index,
        "direction": direction,
        "entry_time": index,
        "entry_price": 100.0,
        "exit_price": exit_price,
        "fee_pct": fee_pct,
        "path": path if path is not None else _path((101.0, 99.5)),
    }


def test_long_uses_first_barrier_in_chronological_order():
    result = simulate_trade_path(
        _path((101.0, 99.5), (102.2, 99.8), (101.0, 98.8)),
        entry_price=100,
        exit_price=99,
        direction="Long",
        sl_pct=1,
        tp_pct=2,
        fee_pct=0.1,
    )

    assert result["outcome"] == "take_profit"
    assert result["tp_hit"] is True
    assert result["stop_hit"] is False
    assert result["return_pct"] == pytest.approx(1.9)


def test_short_reverses_stop_and_target_prices():
    result = simulate_trade_path(
        _path((100.5, 98.9), (101.5, 99.0)),
        entry_price=100,
        exit_price=101,
        direction="Short",
        sl_pct=1,
        tp_pct=1,
    )

    assert result["outcome"] == "take_profit"
    assert result["return_pct"] == 1


def test_same_five_minute_candle_is_ambiguous_and_conservative():
    result = simulate_trade_path(
        _path((102.5, 98.5)),
        entry_price=100,
        exit_price=101,
        direction="Long",
        sl_pct=1,
        tp_pct=2,
    )

    assert result["outcome"] == "ambiguous_stop"
    assert result["ambiguous"] is True
    assert result["return_pct"] == -1


def test_performance_compounds_returns_and_tracks_drawdown():
    result = performance([
        {"return_pct": 10, "r_multiple": 1, "stop_hit": False, "tp_hit": True, "ambiguous": False},
        {"return_pct": -10, "r_multiple": -1, "stop_hit": True, "tp_hit": False, "ambiguous": False},
    ])

    assert result["win_rate_pct"] == 50
    assert result["expectancy_pct"] == 0
    assert result["cumulative_return_pct"] == pytest.approx(-1)
    assert result["max_drawdown_pct"] == pytest.approx(10)


def test_grid_and_bundle_produce_a_train_selected_candidate():
    items = [
        _item(index, path=_path((103.0, 99.5)), exit_price=102.0)
        if index % 2 else _item(index, path=_path((100.5, 98.0)), exit_price=99.0)
        for index in range(1, 11)
    ]
    sl_values = grid_values(0.5, 1.0, 0.5)
    tp_values = grid_values(1.0, 2.0, 1.0)
    bundle = _analysis_bundle(items, sl_values, tp_values)

    assert sl_values == [0.5, 1.0]
    assert tp_values == [1.0, 2.0]
    assert len(bundle["candidates"]) == 4
    assert bundle["train_count"] == 7
    assert bundle["validation_count"] == 3
    assert bundle["best_candidate"] is not None
    assert bundle["recommendation"]["validation_status"] == "insufficient"


def test_query_rejects_reversed_or_excessive_grids():
    with pytest.raises(ValidationError):
        JournalSlTpQuery(start_time=1, end_time=2, sl_min=2, sl_max=1)
    with pytest.raises(ValidationError):
        JournalSlTpQuery(
            start_time=1,
            end_time=2,
            sl_min=0.1,
            sl_max=10,
            sl_step=0.1,
            tp_min=0.1,
            tp_max=10,
            tp_step=0.1,
        )
