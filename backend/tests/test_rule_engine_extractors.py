from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from backend.modules.rule_engine.evaluator import evaluate_rule
from backend.modules.rule_engine.extractors import (
    SUPPORTED_METRIC_IDS,
    extract_metric_observations,
)
from backend.modules.rule_engine.models import (
    NotEvaluableReason,
    RuleCategory,
    RuleEvaluationStatus,
    RuleEvaluator,
)


def _entry(**overrides):
    result = {
        "id": 41,
        "external_id": "binance:position:stable-41",
        "source": "binance_position",
        "entry_datetime": "2026-01-01T10:00:00+00:00",
        "datetime": "2026-01-01T11:30:00+00:00",
        "symbol": "BTC/USDT:USDT",
        "direction": "Long",
        "entry_price": 100.0,
        "exit_price": 104.0,
        "r_multiple": 1.5,
        "confidence_score": 4,
        "focus_score": 5,
        "fomo": False,
        "revenge_trade": True,
        "setup_tags": ["breakout"],
    }
    result.update(overrides)
    return result


def _revision(version=1, received_at="2026-01-01T09:00:00+00:00", **overrides):
    result = {
        "id": 10 + version,
        "plan_id": 7,
        "version": version,
        "entry_price": 100.0,
        "entry_min": None,
        "entry_max": None,
        "stop_loss": 98.0,
        "take_profit": 104.0,
        "take_profit_2": None,
        "max_hold_hours": 12.0,
        "received_at": received_at,
        "created_at": received_at,
    }
    result.update(overrides)
    return result


def _plan(*, source="VERIFIED_PRETRADE", revisions=None, **overrides):
    result = {
        "id": 7,
        "symbol": "BTC/USDT",
        "symbol_key": "BTCUSDT",
        "side": "Long",
        "source": source,
        "revisions": revisions or [_revision()],
        "link": {
            "journal_entry_id": 41,
            "journal_external_id": "binance:position:stable-41",
            "link_status": "LINKED",
        },
    }
    result.update(overrides)
    return result


def _facts(entry=None, plan=None):
    return extract_metric_observations(
        entry or _entry(),
        linked_plan=_plan() if plan is None else plan,
    )


def test_extracts_exactly_the_14_approved_metrics():
    observations = _facts()
    assert tuple(observations) == SUPPORTED_METRIC_IDS
    assert len(observations) == 14


def test_trade_direction_and_symbol_use_existing_canonical_values():
    observations = _facts()
    assert observations["trade.direction"].value == "Long"
    assert observations["trade.symbol"].value == "BTCUSDT"
    assert observations["trade.direction"].source == "journal_entry"
    assert observations["trade.symbol"].record_id == 41


@pytest.mark.parametrize("field", ["direction", "symbol"])
def test_missing_trade_context_is_unavailable(field):
    observations = _facts(_entry(**{field: None}))
    observation = observations[f"trade.{field}"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


def test_invalid_direction_is_not_guessed_from_buy_or_sell():
    observation = _facts(_entry(direction="BUY"))["trade.direction"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.INVALID_HISTORICAL_DATA


@pytest.mark.parametrize(
    ("field", "value"),
    [("confidence_score", 4), ("focus_score", 5)],
)
def test_journal_scores_preserve_available_self_reports(field, value):
    observation = _facts()[f"journal.{field}"]
    assert observation.available
    assert observation.value == str(value)
    assert observation.source == "journal_entry"


@pytest.mark.parametrize("field", ["confidence_score", "focus_score"])
def test_null_journal_score_is_unavailable(field):
    observation = _facts(_entry(**{field: None}))[f"journal.{field}"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("confidence_score", 0),
        ("confidence_score", 6),
        ("focus_score", 0),
        ("focus_score", 6),
        ("fomo", "false"),
        ("revenge_trade", 1),
    ],
)
def test_invalid_historical_psychology_values_are_never_coerced(field, value):
    metric_id = f"journal.{field}"
    observation = _facts(_entry(**{field: value}))[metric_id]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.INVALID_HISTORICAL_DATA


@pytest.mark.parametrize("field", ["fomo", "revenge_trade"])
@pytest.mark.parametrize("value", [True, False])
def test_journal_boolean_self_reports_preserve_true_and_false(field, value):
    observation = _facts(_entry(**{field: value}))[f"journal.{field}"]
    assert observation.available
    assert observation.value is value


@pytest.mark.parametrize("field", ["fomo", "revenge_trade"])
def test_null_journal_boolean_is_unavailable_not_false(field):
    observation = _facts(_entry(**{field: None}))[f"journal.{field}"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


def test_verified_pretrade_revision_supplies_plan_metrics():
    observations = _facts()
    assert observations["plan.recorded_before_entry"].value is True
    assert observations["plan.recorded_before_entry"].record_id == 11
    assert observations["plan.stop_distance_pct"].value == "2"
    assert observations["plan.total_reward_risk_ratio"].value == "2"
    assert observations["plan.max_hold_hours"].value == "12"
    assert observations["execution.entry_deviation_r"].value == "0"
    for metric_id in (
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
        "plan.max_hold_hours",
        "execution.entry_deviation_r",
    ):
        assert observations[metric_id].source == "plan_revision"
        assert observations[metric_id].record_id == 11


def test_short_plan_geometry_uses_existing_plan_lab_semantics():
    revision = _revision(stop_loss=103.0, take_profit=94.0)
    observations = _facts(
        _entry(direction="Short", entry_price=100.0),
        _plan(side="Short", revisions=[revision]),
    )
    assert observations["plan.stop_distance_pct"].value == "3"
    assert observations["plan.total_reward_risk_ratio"].value == "2"
    for metric_id in (
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
    ):
        assert observations[metric_id].source == "plan_revision"
        assert observations[metric_id].record_id == 11


def test_no_plan_is_evaluable_false_only_for_recorded_before_entry():
    observations = extract_metric_observations(_entry(), linked_plan=None)
    recorded = observations["plan.recorded_before_entry"]
    assert recorded.available
    assert recorded.value is False
    assert recorded.source == "plan_provenance"
    for metric_id in (
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
        "plan.max_hold_hours",
        "execution.entry_deviation_r",
    ):
        assert not observations[metric_id].available
        assert observations[metric_id].reason_code == NotEvaluableReason.MISSING_PLAN


def test_ambiguous_or_wrong_trade_link_is_not_accepted_as_plan_evidence():
    ambiguous = _plan()
    ambiguous["link"] = {**ambiguous["link"], "link_status": "AMBIGUOUS_LINK"}
    wrong_trade = _plan()
    wrong_trade["link"] = {
        **wrong_trade["link"],
        "journal_entry_id": 999,
        "journal_external_id": "binance:position:other",
    }

    for plan in (ambiguous, wrong_trade):
        observations = _facts(plan=plan)
        assert observations["plan.recorded_before_entry"].value is False
        assert (
            observations["plan.stop_distance_pct"].reason_code
            == NotEvaluableReason.MISSING_PLAN
        )


@pytest.mark.parametrize("source", ["IN_TRADE", "RETROSPECTIVE"])
def test_non_pretrade_plan_cannot_masquerade_as_pretrade(source):
    observations = _facts(plan=_plan(source=source))
    assert observations["plan.recorded_before_entry"].value is False
    assert (
        observations["plan.stop_distance_pct"].reason_code
        == NotEvaluableReason.PLAN_NOT_EFFECTIVE_AT_ENTRY
    )


def test_revision_at_or_after_entry_is_not_pretrade_evidence():
    observations = _facts(
        plan=_plan(
            revisions=[
                _revision(received_at="2026-01-01T10:00:00+00:00")
            ]
        )
    )
    assert observations["plan.recorded_before_entry"].value is False
    assert (
        observations["plan.stop_distance_pct"].reason_code
        == NotEvaluableReason.PLAN_NOT_EFFECTIVE_AT_ENTRY
    )


def test_latest_effective_pre_entry_revision_is_used_consistently():
    revisions = [
        _revision(1, "2026-01-01T08:00:00+00:00", entry_price=100.0, stop_loss=99.0),
        _revision(2, "2026-01-01T09:30:00+00:00", entry_price=100.0, stop_loss=98.0),
        _revision(3, "2026-01-01T10:30:00+00:00", entry_price=100.0, stop_loss=95.0),
    ]
    observations = _facts(plan=_plan(revisions=revisions))
    assert observations["plan.recorded_before_entry"].record_id == 12
    assert observations["plan.stop_distance_pct"].value == "2"
    assert observations["plan.stop_distance_pct"].record_id == 12
    assert observations["plan.total_reward_risk_ratio"].record_id == 12
    assert observations["plan.max_hold_hours"].record_id == 12
    assert observations["execution.entry_deviation_r"].record_id == 12


def test_same_received_at_uses_higher_version_from_repository_ordering():
    same_received_at = "2026-01-01T09:00:00+00:00"
    # get_plan() returns revisions in version ASC order.  annotate_revisions()
    # then selects the last qualifying revision, so version 2 wins this tie.
    revisions = [
        _revision(1, same_received_at, stop_loss=99.0, take_profit=104.0),
        _revision(2, same_received_at, stop_loss=98.0, take_profit=106.0, max_hold_hours=24.0),
    ]
    observations = _facts(plan=_plan(revisions=revisions))
    assert observations["plan.stop_distance_pct"].value == "2"
    assert observations["plan.total_reward_risk_ratio"].value == "3"
    assert observations["plan.max_hold_hours"].value == "24"
    assert observations["execution.entry_deviation_r"].value == "0"
    for metric_id in (
        "plan.recorded_before_entry",
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
        "plan.max_hold_hours",
        "execution.entry_deviation_r",
    ):
        assert observations[metric_id].record_id == 12


@pytest.mark.parametrize(
    "revision",
    [
        _revision(stop_loss=None),
        _revision(stop_loss=100.0),
        _revision(stop_loss=101.0),
    ],
)
def test_invalid_or_missing_stop_geometry_is_not_evaluable(revision):
    observations = _facts(plan=_plan(revisions=[revision]))
    for metric_id in (
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
        "execution.entry_deviation_r",
    ):
        assert not observations[metric_id].available
        assert observations[metric_id].reason_code == NotEvaluableReason.INVALID_PLAN


@pytest.mark.parametrize(
    "revision",
    [_revision(take_profit=None), _revision(take_profit=100.0)],
)
def test_missing_or_non_positive_reward_geometry_is_not_evaluable(revision):
    observation = _facts(plan=_plan(revisions=[revision]))[
        "plan.total_reward_risk_ratio"
    ]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.INVALID_PLAN


def test_missing_max_hold_is_unavailable_without_fabricated_default():
    observation = _facts(
        plan=_plan(revisions=[_revision(max_hold_hours=None)])
    )["plan.max_hold_hours"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


@pytest.mark.parametrize(
    ("side", "stop_loss", "take_profit", "actual_entry", "expected"),
    [
        ("Long", 97.0, 104.0, 100.0, "0"),
        ("Long", 97.0, 104.0, 102.0, "0.2"),
        ("Long", 97.0, 104.0, 98.0, "1"),
        ("Short", 103.0, 94.0, 100.0, "0"),
        ("Short", 103.0, 94.0, 98.0, "0.2"),
        ("Short", 103.0, 94.0, 102.0, "1"),
    ],
)
def test_entry_deviation_r_uses_absolute_range_distance_over_execution_risk(
    side, stop_loss, take_profit, actual_entry, expected
):
    revision = _revision(
        entry_price=None,
        entry_min=99.0,
        entry_max=101.0,
        stop_loss=stop_loss,
        take_profit=take_profit,
    )
    observation = _facts(
        _entry(direction=side, entry_price=actual_entry),
        _plan(side=side, revisions=[revision]),
    )["execution.entry_deviation_r"]
    assert observation.available
    assert observation.value == expected


def test_entry_deviation_r_with_zero_execution_risk_is_invalid_plan():
    observation = _facts(
        _entry(entry_price=100.0),
        _plan(revisions=[_revision(stop_loss=100.0)]),
    )["execution.entry_deviation_r"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.INVALID_PLAN


def test_missing_actual_entry_makes_entry_deviation_unavailable():
    observation = _facts(_entry(entry_price=None))["execution.entry_deviation_r"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


def test_open_trade_makes_all_closed_only_metrics_neutral():
    observations = _facts(_entry(datetime=None, exit_price=None, r_multiple=9.25))
    for metric_id in (
        "execution.holding_minutes",
        "execution.price_return_pct",
        "execution.realized_r",
    ):
        assert not observations[metric_id].available
        assert observations[metric_id].reason_code == NotEvaluableReason.TRADE_NOT_CLOSED


def test_holding_minutes_uses_repository_timestamp_convention():
    observation = _facts()["execution.holding_minutes"]
    assert observation.available
    assert observation.value == "90"


def test_negative_holding_duration_is_invalid_historical_data():
    observation = _facts(
        _entry(datetime="2026-01-01T09:59:59+00:00")
    )["execution.holding_minutes"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.INVALID_HISTORICAL_DATA


@pytest.mark.parametrize(
    ("direction", "exit_price", "expected"),
    [("Long", 105.0, "5"), ("Short", 95.0, "5")],
)
def test_price_return_is_direction_aware(direction, exit_price, expected):
    observation = _facts(
        _entry(direction=direction, exit_price=exit_price),
        _plan(side=direction),
    )["execution.price_return_pct"]
    assert observation.available
    assert observation.value == expected


def test_realized_r_uses_stored_authoritative_value():
    observation = _facts(_entry(r_multiple=-1.25))["execution.realized_r"]
    assert observation.available
    assert observation.value == "-1.25"


def test_null_legacy_realized_r_is_not_reconstructed():
    observation = _facts(_entry(r_multiple=None))["execution.realized_r"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.LEGACY_DATA_UNAVAILABLE


def test_missing_prices_do_not_become_zero_return():
    observation = _facts(_entry(exit_price=None))["execution.price_return_pct"]
    assert not observation.available
    assert observation.reason_code == NotEvaluableReason.MISSING_METRIC


def test_extracted_observation_feeds_phase2_without_mutation():
    entry = _entry()
    plan = _plan()
    before_entry = deepcopy(entry)
    before_plan = deepcopy(plan)
    observations = extract_metric_observations(entry, linked_plan=plan)
    observation_before = observations["plan.stop_distance_pct"].model_dump()

    result = evaluate_rule(
        rule_id="risk-1",
        category=RuleCategory.RISK,
        text="Keep stop distance within two percent",
        evaluator=RuleEvaluator(
            metric_id="plan.stop_distance_pct",
            operator="lte",
            expected=Decimal("2"),
        ),
        observation=observations["plan.stop_distance_pct"],
        schema_version=2,
    )

    assert result.status == RuleEvaluationStatus.FOLLOWED
    assert observations["plan.stop_distance_pct"].model_dump() == observation_before
    assert entry == before_entry
    assert plan == before_plan


def test_repeated_same_facts_produce_identical_observations():
    entry = _entry()
    plan = _plan()
    first = extract_metric_observations(entry, linked_plan=plan)
    second = extract_metric_observations(entry, linked_plan=plan)
    assert first == second
    assert {
        key: value.model_dump() for key, value in first.items()
    } == {
        key: value.model_dump() for key, value in second.items()
    }


def test_setup_tags_are_never_used_to_infer_direction_or_plan():
    observations = extract_metric_observations(
        _entry(direction=None, setup_tags=["Short", "verified-plan"]),
        linked_plan=None,
    )
    assert not observations["trade.direction"].available
    assert observations["plan.recorded_before_entry"].value is False
    assert not observations["plan.stop_distance_pct"].available
