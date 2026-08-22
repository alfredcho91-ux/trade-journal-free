from __future__ import annotations

import pytest

from backend.modules.journal.behavior_analysis import (
    _behavior_item,
    _biggest_leaks,
    _planned_comparison,
    _rule_result,
    _tag_stats,
    performance_stats,
)


def test_planned_comparison_uses_existing_price_excursion_without_creating_risk():
    comparison = _planned_comparison(
        {"planned_stop_pct": 1.5, "planned_target_pct": 3.0},
        {"excursion": {"realized_move_pct": -3.2, "mfe_pct": 3.5, "mae_pct": 4.0}},
    )

    assert comparison["planned_rr"] == pytest.approx(2.0)
    assert comparison["stop_status"] == "overrun"
    assert comparison["target_status"] == "gave_back_after_hit"


def test_plan_after_exit_is_not_eligible_for_rule_compliance_or_leak_attribution():
    comparison = _planned_comparison(
        {
            "entry_datetime": "2026-08-01T00:00:00+00:00",
            "datetime": "2026-08-01T04:00:00+00:00",
            "plan_recorded_at": "2026-08-02T00:00:00+00:00",
            "planned_stop_pct": 1.0,
            "planned_target_pct": 2.0,
        },
        {"excursion": {"realized_move_pct": -2.0, "mfe_pct": 2.5, "mae_pct": 2.0}},
    )
    result = _rule_result(
        {"id": 1, "name": "최대 손절", "rule_type": "max_stop_pct", "parameters": {"max_stop_pct": 1.5}},
        {"direction": "Long", "trend_states": {}, "plan": comparison, "mistake_tags": []},
    )

    assert comparison["recording_phase"] == "after_exit"
    assert comparison["eligible_for_exit_plan_review"] is False
    assert result["status"] == "unknown"


def test_stop_touch_is_not_reported_as_within_plan_when_trade_later_recovers():
    comparison = _planned_comparison(
        {
            "entry_datetime": "2026-08-01T00:00:00+00:00",
            "datetime": "2026-08-01T04:00:00+00:00",
            "plan_recorded_at": "2026-07-31T23:00:00+00:00",
            "planned_stop_pct": 1.0,
        },
        {"excursion": {"realized_move_pct": 1.0, "mfe_pct": 2.0, "mae_pct": 1.2}},
    )

    assert comparison["stop_status"] == "touched_not_executed"


def test_trend_rule_uses_entry_time_states_only():
    item = {
        "direction": "Short",
        "trend_states": {
            "1w": {"direction": "up"},
            "1d": {"direction": "up"},
            "4h": {"direction": "up"},
        },
        "plan": {"planned_stop_pct": None, "planned_rr": None},
        "mistake_tags": [],
    }
    result = _rule_result(
        {
            "id": 1,
            "name": "상승 정렬 SHORT 금지",
            "rule_type": "trend_direction_forbid",
            "parameters": {"market_direction": "up", "forbidden_direction": "Short"},
        },
        item,
    )

    assert result["status"] == "violation"


def test_biggest_leaks_split_one_trade_loss_across_multiple_causes():
    rows = _biggest_leaks([
        {
            "journal_id": 1,
            "exit_datetime": "2026-08-01T00:00:00+00:00",
            "realized_pnl": -100.0,
            "r_multiple": -2.0,
            "issues": [
                {"id": "mistake:late_stop", "label": "늦은 손절"},
                {"id": "early_exit", "label": "조기청산"},
            ],
        }
    ])

    assert [row["loss_impact_pnl"] for row in rows] == pytest.approx([50.0, 50.0])
    assert sum(row["loss_impact_pnl"] for row in rows) == pytest.approx(100.0)


def test_performance_stats_calculates_chronological_drawdown_from_net_pnl():
    stats = performance_stats([
        {"exit_datetime": "2026-08-01T00:00:00+00:00", "realized_pnl": 10.0},
        {"exit_datetime": "2026-08-02T00:00:00+00:00", "realized_pnl": -30.0},
        {"exit_datetime": "2026-08-03T00:00:00+00:00", "realized_pnl": 5.0},
    ])

    assert stats["max_drawdown_pnl"] == pytest.approx(30.0)


def test_mistake_stats_show_largest_loss_first_and_zero_loss_is_not_a_leak():
    items = [
        {"journal_id": 1, "exit_datetime": "2026-08-01", "realized_pnl": -30.0, "mistake_tags": ["늦은 손절"], "issues": []},
        {"journal_id": 2, "exit_datetime": "2026-08-02", "realized_pnl": -10.0, "mistake_tags": ["조기청산"], "issues": []},
    ]
    assert [row["tag"] for row in _tag_stats(items, "mistake_tags")] == ["늦은 손절", "조기청산"]
    assert _biggest_leaks([{**items[0], "realized_pnl": 10.0, "issues": [{"id": "mistake:x", "label": "x"}]}]) == []


def test_manual_and_automatic_issue_with_same_label_is_counted_once():
    item = _behavior_item(
        {
            "id": 1,
            "direction": "Long",
            "realized_pnl": -10.0,
            "mistake_tags": ["조기청산"],
        },
        {
            "quality_class": "good_entry_early_exit",
            "excursion": {"realized_move_pct": -1.0, "mfe_pct": 2.0, "mae_pct": 1.0},
        },
        [],
    )

    assert [issue["label"] for issue in item["issues"]] == ["조기청산"]


def test_biggest_leak_keeps_realized_loss_and_exit_opportunity_separate():
    rows = _biggest_leaks([
        {
            "journal_id": 1,
            "exit_datetime": "2026-08-01",
            "realized_pnl": 20.0,
            "r_multiple": None,
            "post_exit_opportunity_pct": 3.5,
            "profit_give_up_pct": 1.0,
            "issues": [{"id": "early_exit", "label": "조기청산"}],
        },
    ])

    assert rows[0]["loss_impact_pnl"] == 0.0
    assert rows[0]["opportunity_sample_count"] == 1
    assert rows[0]["average_opportunity_pct"] == pytest.approx(3.5)
