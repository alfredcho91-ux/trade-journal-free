import pandas as pd

from backend.modules.journal.stop_optimization import (
    _analysis_bundle,
    _candidate_results,
    _mae_distribution,
    _recovered_after_threshold,
    _split_items,
)


def _path(*rows):
    return pd.DataFrame(rows, columns=["high", "low"])


def _item(index, *, direction="Long", pnl=1, actual_return=2, mae=0.5, path=None, atr_pct=1):
    return {
        "journal_id": index,
        "direction": direction,
        "entry_time": index,
        "entry_price": 100.0,
        "actual_return_pct": actual_return,
        "actual_winner": pnl > 0,
        "mae_pct": mae,
        "atr_pct": atr_pct,
        "regime_id": "aligned_up",
        "path": path if path is not None else _path((102, 99.5)),
    }


def test_winner_mae_distribution_uses_only_net_profitable_trades():
    result = _mae_distribution([
        _item(1, pnl=10, mae=0.5),
        _item(2, pnl=5, mae=1.5),
        _item(3, pnl=-5, mae=9.0),
    ])

    assert result["winner_count"] == 2
    assert result["p50"] == 1.0
    assert result["p95"] < 1.5


def test_recovery_requires_a_later_candle_to_avoid_intrabar_lookahead():
    same_candle = _item(1, pnl=-1, path=_path((101.0, 98.0)))
    later_recovery = _item(2, pnl=-1, path=_path((99.0, 98.0), (100.2, 98.5)))

    assert _recovered_after_threshold(same_candle, 1.0) is False
    assert _recovered_after_threshold(later_recovery, 1.0) is True


def test_short_stop_candidate_uses_directional_mae_and_caps_loss_at_stop():
    item = _item(1, direction="Short", pnl=10, actual_return=3, mae=1.2)

    result = _candidate_results([item], "fixed", 1.0)[0]

    assert result["stop_hit"] is True
    assert result["simulated_return_pct"] == -1.0
    assert result["simulated_r"] == -1.0


def test_analysis_uses_chronological_train_validation_split():
    items = [
        _item(index, pnl=1 if index % 2 else -1, actual_return=2 if index % 2 else -2, mae=index / 10)
        for index in range(1, 11)
    ]

    train, validation = _split_items(items)
    analysis = _analysis_bundle(items)

    assert [item["journal_id"] for item in train] == list(range(1, 8))
    assert [item["journal_id"] for item in validation] == [8, 9, 10]
    assert analysis["train_count"] == 7
    assert analysis["validation_count"] == 3
    assert analysis["recommendation"] is not None
    assert analysis["recommendation"]["validation_status"] in {"passed", "neutral", "failed", "insufficient"}
    assert analysis["recommendation"]["upper_pct"] - analysis["recommendation"]["lower_pct"] <= 0.5
    assert len(analysis["fixed_candidates"]) == 16
    assert len(analysis["atr_candidates"]) == 6
