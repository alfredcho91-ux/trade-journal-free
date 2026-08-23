from backend.modules.journal.quality_analysis import (
    _assign_quality_classes,
    _direction_breakdown,
    _filter_positions_by_net_return,
    _performance_stats,
)


def _item(mfe, mae, realized, post, give_up, capture, pnl=1.0):
    return {
        "realized_pnl": pnl,
        "r_multiple": None,
        "holding_minutes": 60,
        "excursion": {"mfe_pct": mfe, "mae_pct": mae, "realized_move_pct": realized},
        "exit_quality": {
            "additional_profit_potential_pct": post,
            "profit_give_up_pct": give_up,
            "capture_ratio_pct": capture,
        },
    }


def test_quality_classes_use_selected_period_distribution():
    items = [
        _item(0.2, 3.0, -2.0, 0.1, 0.0, -100.0, -10),
        _item(2.0, 0.5, 0.5, 4.0, 1.5, 25.0),
        _item(4.0, 0.5, 1.0, 0.2, 3.0, 25.0),
        _item(3.0, 0.4, 2.8, 0.1, 0.2, 93.0),
    ]

    thresholds = _assign_quality_classes(items)

    assert thresholds["method"] == "selected_period_distribution"
    assert items[0]["quality_class"] == "poor_entry"
    assert items[1]["quality_class"] == "good_entry_early_exit"
    assert items[2]["quality_class"] == "good_entry_late_exit"
    assert items[3]["quality_class"] == "good_entry_good_exit"


def test_performance_stats_does_not_invent_r_multiple():
    stats = _performance_stats([_item(2, 1, 1, 0, 1, 50)])

    assert stats["average_r"] is None
    assert stats["r_sample_count"] == 0
    assert stats["trade_count"] == 1


def test_direction_breakdown_keeps_long_and_short_statistics_separate():
    long_item = _item(2, 1, 1, 0, 1, 50, 10)
    short_item = _item(1, 2, -1, 0, 1, 20, -5)
    for item, direction, regime_id in (
        (long_item, "Long", "aligned_up"),
        (short_item, "Short", "aligned_down"),
    ):
        item.update({
            "direction": direction,
            "quality_class": "good_entry_good_exit",
            "regime_alignment": "aligned",
            "trade_alignment": "with_trend",
            "market_regime": {"id": regime_id, "alignment": "aligned", "trade_bias": "up"},
        })

    breakdown = _direction_breakdown([long_item, short_item])

    assert breakdown["Long"]["summary"]["trade_count"] == 1
    assert breakdown["Short"]["summary"]["trade_count"] == 1
    assert breakdown["Long"]["regimes"][0]["average_pnl"] == 10
    assert breakdown["Short"]["regimes"][0]["average_pnl"] == -5


def test_return_filter_uses_absolute_net_return_on_invested_margin():
    positions = [
        {"id": 1, "realized_pnl": 1.0, "invested_amount": 100.0},
        {"id": 2, "realized_pnl": -0.9, "invested_amount": 100.0},
        {"id": 3, "realized_pnl": -2.0, "invested_amount": 100.0},
        {"id": 4, "realized_pnl": 5.0},
    ]

    included, metadata = _filter_positions_by_net_return(positions, 1.0)

    assert [position["id"] for position in included] == [3]
    assert metadata["basis"] == "net_return_on_invested_margin"
    assert metadata["excluded_below_threshold_count"] == 2
    assert metadata["excluded_return_unavailable_count"] == 1


def test_return_filter_does_not_assume_unleveraged_margin_for_derivative_position():
    positions = [{
        "id": 1,
        "source": "bybit_position",
        "direction": "Long",
        "entry_price": 100.0,
        "exit_price": 110.0,
        "realized_pnl": 10.0,
        "fee": 0.0,
        "funding_fee": 0.0,
        "leverage": None,
        "invested_amount": None,
    }]

    included, metadata = _filter_positions_by_net_return(positions, 1.0)

    assert included == []
    assert metadata["excluded_return_unavailable_count"] == 1
