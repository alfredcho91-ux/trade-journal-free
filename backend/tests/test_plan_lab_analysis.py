import pandas as pd

from backend.modules.plan_lab.analysis import (
    _aggregate_group,
    _diagnosis,
    _grouped,
    _largest_execution_gap,
    _optimizer,
    _path_mfe_r,
    _post_exit_outcome,
    evaluate_plan,
    plan_geometry,
)


def _revision(**overrides):
    result = {
        "id": 1,
        "version": 1,
        "entry_price": 100.0,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 98.0,
        "take_profit": 104.0,
        "received_at": "2026-01-01T09:00:00+00:00",
        "setup": "pullback",
    }
    result.update(overrides)
    return result


def _plan(side="Long", revision=None):
    revision = revision or _revision()
    return {"id": 7, "side": side, "source": "VERIFIED_PRETRADE", "revisions": [revision]}


def _entry(**overrides):
    result = {
        "id": 11,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_datetime": "2026-01-01T10:00:00+00:00",
        "datetime": "2026-01-01T12:00:00+00:00",
        "entry_price": 100.0,
        "exit_price": 103.0,
        "invested_amount": 100.0,
        "leverage": 10.0,
        "realized_pnl": 25.0,
    }
    result.update(overrides)
    return result


def _path(*rows):
    return {"path": pd.DataFrame(rows, columns=["high", "low"])}


def _timestamp(value: str) -> int:
    return int(pd.Timestamp(value).timestamp() * 1000)


def _timed_path(*rows):
    return {"path": pd.DataFrame(rows)}


def test_plan_geometry_handles_long_short_and_invalid_plans():
    long_geometry = plan_geometry("Long", _revision())
    short_geometry = plan_geometry(
        "Short",
        _revision(stop_loss=102.0, take_profit=96.0),
    )
    assert long_geometry["valid"] is True
    assert long_geometry["planned_rr"] == 2.0
    assert short_geometry["valid"] is True
    assert short_geometry["planned_rr"] == 2.0
    assert plan_geometry("Long", _revision(stop_loss=101.0))["status"] == "INVALID_PLAN"
    assert plan_geometry("Short", _revision(stop_loss=99.0, take_profit=96.0))["status"] == "INVALID_PLAN"


def test_evaluation_uses_official_usdt_r_and_tp_first():
    result = evaluate_plan(_plan(), _entry(), _path((104.2, 99.5)))
    assert result["evaluation_status"] == "TP_FIRST"
    assert result["planned_result_r"] == 2.0
    assert result["planned_risk_usdt"] == 20.0
    assert result["actual_r"] == 1.25
    assert result["r_basis"] == "usdt"
    assert result["execution_delta_r"] == -0.75
    assert result["execution_delta_usdt"] == -15.0


def test_same_candle_touch_is_ambiguous_and_excluded_from_delta():
    result = evaluate_plan(_plan(), _entry(), _path((104.2, 97.8)))
    assert result["evaluation_status"] == "AMBIGUOUS"
    assert result["planned_result_r"] is None
    assert result["execution_delta_r"] is None


def test_price_r_fallback_is_kept_out_of_official_execution_delta():
    result = evaluate_plan(
        _plan(),
        _entry(invested_amount=None, leverage=None, realized_pnl=None),
        _path((103.5, 99.5)),
    )
    assert result["evaluation_status"] == "UNRESOLVED"
    assert result["r_basis"] == "price"
    assert result["actual_r"] == 1.5
    assert result["execution_delta_r"] is None


def test_post_entry_only_plan_is_not_an_official_plan():
    revision = _revision(received_at="2026-01-01T10:30:00+00:00")
    result = evaluate_plan(_plan(revision=revision), _entry(), _path((104.2, 99.5)))
    assert result["evaluation_status"] == "POST_TRADE_INPUT"
    assert result["plan_effective_at_entry"] is None


def test_retrospective_plan_is_evaluated_but_never_labelled_verified():
    plan = _plan()
    plan["source"] = "RETROSPECTIVE"
    plan["revisions"][0]["received_at"] = "2026-01-02T10:00:00+00:00"
    result = evaluate_plan(plan, _entry(), _path((104.2, 99.5)))
    assert result["plan_source"] == "RETROSPECTIVE"
    assert result["evaluation_status"] == "TP_FIRST"


def test_execution_geometry_uses_actual_entry_not_planned_entry():
    result = evaluate_plan(
        _plan(revision=_revision(entry_price=99.0, stop_loss=98.0, take_profit=106.0)),
        _entry(entry_price=100.0),
        _path((106.2, 99.5)),
    )
    assert result["geometry"]["planned_rr"] == 3.0
    assert result["original_planned_rr"] == 7.0


def test_optimizer_keeps_discovery_and_validation_confidence_separate():
    items = [
        {
            "journal_id": index,
            "exit_datetime": f"2026-01-{index + 1:02d}T00:00:00+00:00",
            "r_basis": "usdt",
            "actual_r": -0.5,
            "planned_result_r": 1.0,
            "primary_execution_category": "EARLY_TP_EXIT",
        }
        for index in range(20)
    ]

    plan_variant = next(
        variant for variant in _optimizer(items)["variants"] if variant["id"] == "PLAN"
    )

    assert plan_variant["discovery"]["trade_count"] == 14
    assert plan_variant["discovery"]["sample_confidence"] == "medium"
    assert plan_variant["validation"]["trade_count"] == 6
    assert plan_variant["validation"]["sample_confidence"] == "low"
    assert plan_variant["validation_status"] == "observed_low_sample"


def test_group_evidence_ids_match_the_official_r_sample():
    items = [
        {"journal_id": 1, "r_basis": "usdt", "actual_r": 0.5, "planned_result_r": 1.0, "execution_delta_r": -0.5, "adherence": {}, "geometry": {}},
        {"journal_id": 2, "r_basis": "price", "actual_r": 0.5, "planned_result_r": 1.0, "execution_delta_r": None, "adherence": {}, "geometry": {}},
        {"journal_id": 3, "r_basis": "unavailable", "actual_r": None, "planned_result_r": None, "execution_delta_r": None, "adherence": {}, "geometry": {}},
    ]

    row = _aggregate_group("pullback", items, denominator=1)

    assert row["official_r_count"] == 1
    assert row["journal_ids"] == [1]
    assert row["all_journal_ids"] == [1, 2, 3]

    for key in ("setup", "side", "market_regime_id"):
        grouped_items = [{**item, key: "same-group"} for item in items]
        grouped_row = _grouped(grouped_items, lambda item, field=key: item.get(field))[0]
        assert grouped_row["official_r_count"] == len(grouped_row["journal_ids"]) == 1
        assert grouped_row["journal_ids"] == [1]


def test_largest_execution_gap_uses_total_delta_not_trade_count():
    rows = [
        {"id": "COMMON", "trade_count": 20, "total_execution_delta_r": -2.0},
        {"id": "COSTLY", "trade_count": 5, "total_execution_delta_r": -8.0},
        {"id": "NOT_EVALUABLE", "trade_count": 2, "total_execution_delta_r": -20.0},
    ]

    assert _largest_execution_gap(rows)["id"] == "COSTLY"
    assert _diagnosis({
        "official_r_count": 10,
        "plan_expectancy_r": 0.2,
        "actual_expectancy_r": 0.2,
    }, rows) == "BEHAVIOR_GAP:COSTLY"


def test_actual_exit_inside_candle_tp_touch_is_uncertain():
    path = _timed_path(
        {
            "open_time": _timestamp("2026-01-01T10:10:00Z"),
            "close_time": _timestamp("2026-01-01T10:15:00Z") - 1,
            "high": 104.5,
            "low": 99.5,
            "boundary_uncertain": False,
        },
        {
            "open_time": _timestamp("2026-01-01T10:15:00Z"),
            "close_time": _timestamp("2026-01-01T10:20:00Z") - 1,
            "high": 103.0,
            "low": 99.5,
            "boundary_uncertain": False,
        },
    )

    assert _post_exit_outcome(
        path,
        plan_geometry("Long", _revision()),
        "Long",
        "2026-01-01T10:12:00Z",
    ) == "NOT_EVALUABLE"


def test_actual_exit_exact_boundary_allows_later_tp():
    path = _timed_path(
        {
            "open_time": _timestamp("2026-01-01T10:10:00Z"),
            "close_time": _timestamp("2026-01-01T10:15:00Z") - 1,
            "high": 103.0,
            "low": 99.5,
            "boundary_uncertain": False,
        },
        {
            "open_time": _timestamp("2026-01-01T10:15:00Z"),
            "close_time": _timestamp("2026-01-01T10:20:00Z") - 1,
            "high": 104.5,
            "low": 99.5,
            "boundary_uncertain": False,
        },
    )

    assert _post_exit_outcome(
        path,
        plan_geometry("Long", _revision()),
        "Long",
        "2026-01-01T10:15:00Z",
    ) == "POST_EXIT_TP"


def test_actual_exit_partial_candle_without_barrier_allows_later_tp():
    path = _timed_path(
        {
            "open_time": _timestamp("2026-01-01T10:10:00Z"),
            "close_time": _timestamp("2026-01-01T10:15:00Z") - 1,
            "high": 103.0,
            "low": 99.5,
            "boundary_uncertain": False,
        },
        {
            "open_time": _timestamp("2026-01-01T10:15:00Z"),
            "close_time": _timestamp("2026-01-01T10:20:00Z") - 1,
            "high": 104.5,
            "low": 99.5,
            "boundary_uncertain": False,
        },
    )

    assert _post_exit_outcome(
        path,
        plan_geometry("Long", _revision()),
        "Long",
        "2026-01-01T10:12:00Z",
    ) == "POST_EXIT_TP"


def test_actual_exit_partial_candle_possible_sl_blocks_later_tp():
    path = _timed_path(
        {
            "open_time": _timestamp("2026-01-01T10:10:00Z"),
            "close_time": _timestamp("2026-01-01T10:15:00Z") - 1,
            "high": 103.0,
            "low": 97.5,
            "boundary_uncertain": False,
        },
        {
            "open_time": _timestamp("2026-01-01T10:15:00Z"),
            "close_time": _timestamp("2026-01-01T10:20:00Z") - 1,
            "high": 104.5,
            "low": 99.5,
            "boundary_uncertain": False,
        },
    )

    assert _post_exit_outcome(
        path,
        plan_geometry("Long", _revision()),
        "Long",
        "2026-01-01T10:12:00Z",
    ) == "NOT_EVALUABLE"


def test_post_exit_uncertain_is_not_added_to_early_exit_optimizer():
    path = _timed_path({
        "open_time": _timestamp("2026-01-01T10:10:00Z"),
        "close_time": _timestamp("2026-01-01T10:15:00Z") - 1,
        "high": 104.5,
        "low": 99.5,
        "boundary_uncertain": False,
    })
    result = evaluate_plan(
        _plan(),
        _entry(datetime="2026-01-01T10:12:00+00:00", exit_price=101.0),
        path,
    )

    assert result["post_exit_outcome"] == "NOT_EVALUABLE"
    assert result["primary_execution_category"] == "NOT_EVALUABLE"
    variant = next(
        item for item in _optimizer([result])["variants"]
        if item["id"] == "PLAN_TP_ON_EARLY_EXIT"
    )
    assert variant["overall"]["expectancy_r"] == result["actual_r"]


def test_mfe_boundary_does_not_use_unobservable_partial_extreme():
    path = _timed_path(
        {"high": 150.0, "low": 90.0, "boundary_uncertain": True},
        {"high": 103.0, "low": 99.0, "boundary_uncertain": False},
    )

    assert _path_mfe_r(path, plan_geometry("Long", _revision()), "Long") == 1.5
