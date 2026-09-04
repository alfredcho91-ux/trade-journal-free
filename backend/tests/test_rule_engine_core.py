from __future__ import annotations

from dataclasses import FrozenInstanceError
from decimal import Decimal, getcontext, localcontext

import pytest
from pydantic import ValidationError as PydanticValidationError

from backend.modules.rule_engine.evaluator import evaluate_rule, numeric_tolerance
from backend.modules.rule_engine.models import (
    NotEvaluableReason,
    Observation,
    RuleCategory,
    RuleEvaluationStatus,
    RuleEvaluator,
)
from backend.modules.rule_engine.registry import METRIC_REGISTRY
from backend.modules.rule_engine.summary import summarize_by_category, summarize_results


def _available(value, *, source="test_fact", record_id=42):
    return Observation(
        available=True,
        value=value,
        source=source,
        record_id=record_id,
    )


def _unavailable(reason=NotEvaluableReason.MISSING_METRIC):
    return Observation(available=False, reason_code=reason)


def _evaluator(metric_id="journal.fomo", operator="eq", expected=False):
    return RuleEvaluator(metric_id=metric_id, operator=operator, expected=expected)


def _evaluate(
    evaluator=None,
    observation=None,
    *,
    schema_version=2,
    category=RuleCategory.ENTRY,
    rule_id="rule-1",
    text="Follow the rule",
):
    return evaluate_rule(
        rule_id=rule_id,
        category=category,
        text=text,
        evaluator=evaluator,
        observation=observation,
        schema_version=schema_version,
    )


def test_status_and_reason_vocabularies_are_closed():
    assert {status.value for status in RuleEvaluationStatus} == {
        "FOLLOWED",
        "VIOLATED",
        "NOT_EVALUABLE",
    }
    assert {reason.value for reason in NotEvaluableReason} == {
        "NO_EVALUATOR",
        "MISSING_METRIC",
        "MISSING_PLAN",
        "PLAN_NOT_EFFECTIVE_AT_ENTRY",
        "INVALID_PLAN",
        "TRADE_NOT_CLOSED",
        "LEGACY_DATA_UNAVAILABLE",
        "UNSUPPORTED_SOURCE",
        "MARKET_DATA_UNAVAILABLE",
        "INCOMPLETE_MARKET_PATH",
        "INVALID_HISTORICAL_DATA",
        "RULE_SCHEMA_UNSUPPORTED",
    }


@pytest.mark.parametrize("schema_version", [1, 2])
def test_descriptive_rule_is_not_evaluable(schema_version):
    result = _evaluate(schema_version=schema_version)
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.NO_EVALUATOR
    assert result.condition is None
    assert "descriptive" in result.explanation.message


@pytest.mark.parametrize(
    ("expected", "observed", "status"),
    [
        (False, False, RuleEvaluationStatus.FOLLOWED),
        (True, True, RuleEvaluationStatus.FOLLOWED),
        (False, True, RuleEvaluationStatus.VIOLATED),
        (True, False, RuleEvaluationStatus.VIOLATED),
    ],
)
def test_boolean_evaluation(expected, observed, status):
    result = _evaluate(_evaluator(expected=expected), _available(observed))
    assert result.status == status
    assert result.condition.expected is expected
    assert result.observation.value is observed


def test_missing_boolean_observation_is_not_evaluable():
    result = _evaluate(_evaluator(), _unavailable())
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.MISSING_METRIC


def test_null_boolean_observation_never_becomes_false():
    with pytest.raises(PydanticValidationError):
        _available(None)
    result = _evaluate(_evaluator(expected=False), None)
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE


@pytest.mark.parametrize(
    ("observed", "status"),
    [
        (Decimal("0.9"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("1"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("1.000000005"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("1.0001"), RuleEvaluationStatus.VIOLATED),
    ],
)
def test_numeric_lte_tolerance(observed, status):
    result = _evaluate(
        _evaluator("plan.stop_distance_pct", "lte", Decimal("1")),
        _available(observed),
    )
    assert result.status == status
    assert result.observation.value == str(observed)


@pytest.mark.parametrize(
    ("observed", "status"),
    [
        (Decimal("1.1"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("1"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("0.999999995"), RuleEvaluationStatus.FOLLOWED),
        (Decimal("0.9999"), RuleEvaluationStatus.VIOLATED),
    ],
)
def test_numeric_gte_tolerance(observed, status):
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", Decimal("1")),
        _available(observed),
    )
    assert result.status == status


@pytest.mark.parametrize(
    "observed",
    [float("nan"), float("inf"), float("-inf"), True],
    ids=["nan", "positive-infinity", "negative-infinity", "boolean"],
)
def test_invalid_numeric_history_is_not_evaluable(observed):
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", 1),
        _available(observed),
    )
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.INVALID_HISTORICAL_DATA


def test_missing_numeric_observation_is_not_evaluable():
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", 1),
        _unavailable(NotEvaluableReason.TRADE_NOT_CLOSED),
    )
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.TRADE_NOT_CLOSED


@pytest.mark.parametrize(
    ("operator", "expected", "observed", "status"),
    [
        ("eq", "Long", "Long", RuleEvaluationStatus.FOLLOWED),
        ("eq", "Long", "Short", RuleEvaluationStatus.VIOLATED),
        ("in", ["Long", "Short"], "Short", RuleEvaluationStatus.FOLLOWED),
        ("in", ["Long"], "Short", RuleEvaluationStatus.VIOLATED),
    ],
)
def test_enum_evaluation(operator, expected, observed, status):
    result = _evaluate(
        _evaluator("trade.direction", operator, expected),
        _available(observed),
    )
    assert result.status == status


@pytest.mark.parametrize(
    ("operator", "expected", "observed", "status"),
    [
        ("eq", "BTCUSDT", "BTCUSDT", RuleEvaluationStatus.FOLLOWED),
        ("eq", "BTCUSDT", "ETHUSDT", RuleEvaluationStatus.VIOLATED),
        ("in", ["BTCUSDT", "ETHUSDT"], "ETHUSDT", RuleEvaluationStatus.FOLLOWED),
        ("in", ["BTCUSDT"], "ETHUSDT", RuleEvaluationStatus.VIOLATED),
    ],
)
def test_normalized_string_evaluation(operator, expected, observed, status):
    result = _evaluate(
        _evaluator("trade.symbol", operator, expected),
        _available(observed),
    )
    assert result.status == status


def test_noncanonical_observed_string_is_invalid_history():
    result = _evaluate(
        _evaluator("trade.symbol", "eq", "BTCUSDT"),
        _available("btc/usdt"),
    )
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.INVALID_HISTORICAL_DATA


@pytest.mark.parametrize(
    "corrupt_evaluator",
    [
        {"metric_id": "unknown.metric", "operator": "eq", "expected": True},
        {"metric_id": "journal.fomo", "operator": "lte", "expected": 1},
    ],
    ids=["unknown-metric", "unsupported-operator"],
)
def test_corrupt_definition_cannot_produce_violation(corrupt_evaluator):
    result = _evaluate(corrupt_evaluator, _available(True))
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED


def test_unsupported_schema_cannot_produce_violation():
    result = _evaluate(_evaluator(), _available(True), schema_version=3)
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED


def test_v1_cannot_smuggle_an_evaluator():
    result = _evaluate(_evaluator(), _available(False), schema_version=1)
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED


def test_numeric_explanation_uses_exact_condition_and_observation_facts():
    result = _evaluate(
        _evaluator("plan.stop_distance_pct", "lte", Decimal("1.25")),
        _available(Decimal("0.85")),
    )
    assert result.condition.expected == "1.25"
    assert result.observation.value == "0.85"
    assert "0.85 percent" in result.explanation.message
    assert "1.25 percent" in result.explanation.message


@pytest.mark.parametrize(
    ("metric_id", "operator", "expected", "observed", "boundary"),
    [
        (
            "plan.stop_distance_pct",
            "lte",
            Decimal("1"),
            Decimal("1.000000005"),
            "maximum",
        ),
        (
            "execution.realized_r",
            "gte",
            Decimal("1"),
            Decimal("0.999999995"),
            "minimum",
        ),
    ],
)
def test_tolerance_assisted_followed_explanation_is_factually_explicit(
    metric_id, operator, expected, observed, boundary
):
    result = _evaluate(
        _evaluator(metric_id, operator, expected),
        _available(observed),
    )
    assert result.status == RuleEvaluationStatus.FOLLOWED
    assert result.observation.value == str(observed)
    assert result.condition.expected == "1"
    assert "within the evaluation tolerance" in result.explanation.message
    assert boundary in result.explanation.message


@pytest.mark.parametrize(
    ("metric_id", "operator", "expected", "observed", "wording"),
    [
        ("plan.stop_distance_pct", "lte", 1, Decimal("0.9"), "within the maximum"),
        ("execution.realized_r", "gte", 1, Decimal("1.1"), "meeting the minimum"),
    ],
)
def test_normal_numeric_followed_explanation_keeps_raw_threshold_wording(
    metric_id, operator, expected, observed, wording
):
    result = _evaluate(
        _evaluator(metric_id, operator, expected),
        _available(observed),
    )
    assert result.status == RuleEvaluationStatus.FOLLOWED
    assert wording in result.explanation.message
    assert "evaluation tolerance" not in result.explanation.message


def test_violated_explanation_uses_exact_facts():
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", Decimal("1.25")),
        _available(Decimal("0.5")),
    )
    assert result.status == RuleEvaluationStatus.VIOLATED
    assert "0.5 R" in result.explanation.message
    assert "1.25 R" in result.explanation.message


@pytest.mark.parametrize("reason", list(NotEvaluableReason))
def test_not_evaluable_explanations_are_bounded(reason):
    result = _evaluate(_evaluator(), _unavailable(reason))
    assert result.status == RuleEvaluationStatus.NOT_EVALUABLE
    assert result.reason_code == reason
    assert result.explanation.template_id == f"not_evaluable.{reason.value.lower()}"
    assert "Traceback" not in result.explanation.message


def test_explanations_make_no_causal_loss_claims():
    results = [
        _evaluate(_evaluator(), _available(True)),
        _evaluate(_evaluator(), _unavailable()),
        _evaluate(
            _evaluator("execution.realized_r", "gte", 1),
            _available(Decimal("0")),
        ),
    ]
    messages = " ".join(item.explanation.message.lower() for item in results)
    assert "caused" not in messages
    assert "cost you" not in messages
    assert "your loss" not in messages


def _status_result(status, *, category=RuleCategory.ENTRY, index=1):
    if status == RuleEvaluationStatus.NOT_EVALUABLE:
        return _evaluate(
            _evaluator(),
            _unavailable(),
            category=category,
            rule_id=f"rule-{index}",
        )
    expected = status == RuleEvaluationStatus.FOLLOWED
    return _evaluate(
        _evaluator(expected=expected),
        _available(True),
        category=category,
        rule_id=f"rule-{index}",
    )


@pytest.mark.parametrize(
    ("statuses", "followed", "violated", "adherence"),
    [
        ([RuleEvaluationStatus.FOLLOWED] * 3, 3, 0, "100"),
        ([RuleEvaluationStatus.VIOLATED] * 3, 0, 3, "0"),
        (
            [RuleEvaluationStatus.FOLLOWED, RuleEvaluationStatus.VIOLATED],
            1,
            1,
            "50",
        ),
    ],
)
def test_summary_evaluable_mix(statuses, followed, violated, adherence):
    summary = summarize_results(
        _status_result(status, index=index) for index, status in enumerate(statuses)
    )
    assert summary.followed_rules == followed
    assert summary.violated_rules == violated
    assert summary.evaluable_rules == followed + violated
    assert summary.adherence_pct == adherence


def test_not_evaluable_is_excluded_from_adherence_but_included_in_total():
    summary = summarize_results(
        [
            _status_result(RuleEvaluationStatus.FOLLOWED, index=1),
            _status_result(RuleEvaluationStatus.VIOLATED, index=2),
            _status_result(RuleEvaluationStatus.NOT_EVALUABLE, index=3),
        ]
    )
    assert summary.total_rules == 3
    assert summary.evaluable_rules == 2
    assert summary.not_evaluable_rules == 1
    assert summary.adherence_pct == "50"
    assert summary.coverage_pct == "66.66666666666666666666666667"


def test_coverage_is_independent_from_adherence():
    summary = summarize_results(
        [
            _status_result(RuleEvaluationStatus.FOLLOWED, index=1),
            _status_result(RuleEvaluationStatus.NOT_EVALUABLE, index=2),
        ]
    )
    assert summary.adherence_pct == "100"
    assert summary.coverage_pct == "50"


def test_zero_evaluable_with_rules_has_null_adherence_and_zero_coverage():
    summary = summarize_results(
        [_status_result(RuleEvaluationStatus.NOT_EVALUABLE, index=index) for index in range(3)]
    )
    assert summary.total_rules == 3
    assert summary.adherence_pct is None
    assert summary.coverage_pct == "0"


def test_zero_total_rules_has_null_percentages():
    summary = summarize_results([])
    assert summary.total_rules == 0
    assert summary.adherence_pct is None
    assert summary.coverage_pct is None


def test_category_summaries_are_independent_and_overall_is_their_union():
    results = [
        _status_result(RuleEvaluationStatus.FOLLOWED, category=RuleCategory.ENTRY, index=1),
        _status_result(RuleEvaluationStatus.VIOLATED, category=RuleCategory.RISK, index=2),
        _status_result(
            RuleEvaluationStatus.NOT_EVALUABLE,
            category=RuleCategory.EXIT,
            index=3,
        ),
    ]
    summaries = summarize_by_category(results)
    assert summaries.entry.followed_rules == 1
    assert summaries.risk.violated_rules == 1
    assert summaries.exit.not_evaluable_rules == 1
    assert summaries.overall.total_rules == 3
    assert summaries.overall.total_rules == sum(
        item.total_rules for item in (summaries.entry, summaries.risk, summaries.exit)
    )


def test_summary_count_invariants_hold():
    summary = summarize_results(
        [
            _status_result(RuleEvaluationStatus.FOLLOWED, index=1),
            _status_result(RuleEvaluationStatus.VIOLATED, index=2),
            _status_result(RuleEvaluationStatus.NOT_EVALUABLE, index=3),
        ]
    )
    assert summary.total_rules == (
        summary.followed_rules
        + summary.violated_rules
        + summary.not_evaluable_rules
    )
    assert summary.evaluable_rules == summary.followed_rules + summary.violated_rules


def test_adherence_preserves_deterministic_precision():
    statuses = [RuleEvaluationStatus.FOLLOWED] * 5 + [RuleEvaluationStatus.VIOLATED]
    summary = summarize_results(
        _status_result(status, index=index) for index, status in enumerate(statuses)
    )
    assert summary.adherence_pct == "83.33333333333333333333333333"


def test_float_artifact_is_removed_from_comparison_fact_and_explanation():
    result = _evaluate(
        _evaluator("plan.stop_distance_pct", "gte", Decimal("0.85")),
        _available(0.8500000000000001),
    )
    assert result.condition.expected == "0.85"
    assert result.observation.value == "0.85"
    assert result.status == RuleEvaluationStatus.FOLLOWED
    assert "0.8500000000000001" not in result.explanation.message
    assert "0.85 percent" in result.explanation.message


def test_decimal_string_preserves_exact_numeric_meaning_without_float_rounding():
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", Decimal("0")),
        _available("0.1234567890123456789"),
    )
    assert result.observation.value == "0.1234567890123456789"


def test_negative_expected_uses_absolute_magnitude_for_tolerance():
    expected = Decimal("-100")
    assert numeric_tolerance(expected) == Decimal("0.00000100")
    result = _evaluate(
        _evaluator("execution.realized_r", "gte", expected),
        _available(Decimal("-100.0000005")),
    )
    assert result.status == RuleEvaluationStatus.FOLLOWED


def test_zero_expected_uses_absolute_tolerance_floor():
    assert numeric_tolerance(Decimal("0")) == Decimal("1e-8")
    result = _evaluate(
        _evaluator("execution.realized_r", "lte", Decimal("0")),
        _available(Decimal("0.000000005")),
    )
    assert result.status == RuleEvaluationStatus.FOLLOWED


@pytest.mark.parametrize(
    ("operator", "observed", "status"),
    [
        ("lte", Decimal("0"), RuleEvaluationStatus.FOLLOWED),
        ("lte", Decimal("0.00000001"), RuleEvaluationStatus.FOLLOWED),
        ("lte", Decimal("0.00000001000000001"), RuleEvaluationStatus.VIOLATED),
        ("gte", Decimal("0"), RuleEvaluationStatus.FOLLOWED),
        ("gte", Decimal("-0.00000001"), RuleEvaluationStatus.FOLLOWED),
        ("gte", Decimal("-0.00000001000000001"), RuleEvaluationStatus.VIOLATED),
    ],
)
def test_zero_threshold_exact_within_and_outside_tolerance(operator, observed, status):
    result = _evaluate(
        _evaluator("execution.realized_r", operator, Decimal("0")),
        _available(observed),
    )
    assert result.status == status


def test_large_expected_uses_relative_tolerance():
    expected = Decimal("1000000000")
    assert numeric_tolerance(expected) == Decimal("10.00000000")
    within = _evaluate(
        _evaluator("execution.realized_r", "lte", expected),
        _available(Decimal("1000000009")),
    )
    outside = _evaluate(
        _evaluator("execution.realized_r", "lte", expected),
        _available(Decimal("1000000011")),
    )
    assert within.status == RuleEvaluationStatus.FOLLOWED
    assert outside.status == RuleEvaluationStatus.VIOLATED


def test_evaluation_does_not_mutate_definition_or_observation():
    evaluator = _evaluator("trade.direction", "in", ["Long", "Short"])
    observation = _available("Long")
    evaluator_before = evaluator.model_dump()
    observation_before = observation.model_dump()

    _evaluate(evaluator, observation)

    assert evaluator.model_dump() == evaluator_before
    assert observation.model_dump() == observation_before


def test_repeated_evaluation_with_identical_inputs_is_equal():
    evaluator = _evaluator("plan.stop_distance_pct", "lte", Decimal("1"))
    observation = _available(Decimal("1.000000005"))

    first = _evaluate(evaluator, observation)
    second = _evaluate(evaluator, observation)

    assert first == second
    assert first.model_dump() == second.model_dump()


@pytest.mark.parametrize(
    ("metric_id", "operator", "expected", "observed", "status"),
    [
        (
            "plan.stop_distance_pct",
            "lte",
            Decimal("1"),
            Decimal("1.000000005"),
            RuleEvaluationStatus.FOLLOWED,
        ),
        (
            "execution.realized_r",
            "gte",
            Decimal("1"),
            Decimal("0.999999995"),
            RuleEvaluationStatus.FOLLOWED,
        ),
        (
            "plan.stop_distance_pct",
            "lte",
            Decimal("1"),
            Decimal("1.00000002"),
            RuleEvaluationStatus.VIOLATED,
        ),
        (
            "execution.realized_r",
            "lte",
            Decimal("0"),
            Decimal("0.000000005"),
            RuleEvaluationStatus.FOLLOWED,
        ),
        (
            "execution.realized_r",
            "gte",
            Decimal("-100"),
            Decimal("-100.0000005"),
            RuleEvaluationStatus.FOLLOWED,
        ),
        (
            "plan.stop_distance_pct",
            "lte",
            Decimal("123456789.123456789123456789"),
            Decimal("123456791"),
            RuleEvaluationStatus.VIOLATED,
        ),
        (
            "plan.stop_distance_pct",
            "gte",
            Decimal("0.85"),
            0.8500000000000001,
            RuleEvaluationStatus.FOLLOWED,
        ),
    ],
)
def test_numeric_evaluation_is_independent_of_ambient_decimal_precision(
    metric_id, operator, expected, observed, status
):
    results = []
    for precision in (6, 12, 28, 50):
        with localcontext() as context:
            context.prec = precision
            results.append(
                _evaluate(
                    _evaluator(metric_id, operator, expected),
                    _available(observed),
                )
            )

    first = results[0]
    assert first.status == status
    for result in results[1:]:
        assert result.status == first.status
        assert result.condition == first.condition
        assert result.observation == first.observation
        assert result.explanation == first.explanation
        assert result.model_dump() == first.model_dump()


def test_evaluator_does_not_mutate_caller_decimal_context():
    with localcontext() as caller_context:
        caller_context.prec = 6
        caller_context.clear_flags()
        before = (
            caller_context.prec,
            caller_context.rounding,
            caller_context.Emin,
            caller_context.Emax,
            caller_context.capitals,
            caller_context.clamp,
            dict(caller_context.flags),
            dict(caller_context.traps),
        )

        result = _evaluate(
            _evaluator(
                "plan.stop_distance_pct",
                "lte",
                Decimal("123456789.123456789123456789"),
            ),
            _available(Decimal("123456791")),
        )

        active_context = getcontext()
        after = (
            active_context.prec,
            active_context.rounding,
            active_context.Emin,
            active_context.Emax,
            active_context.capitals,
            active_context.clamp,
            dict(active_context.flags),
            dict(active_context.traps),
        )
        assert result.status == RuleEvaluationStatus.VIOLATED
        assert after == before


def test_metric_registry_and_definitions_are_read_only():
    metric = METRIC_REGISTRY["journal.fomo"]
    with pytest.raises(TypeError):
        METRIC_REGISTRY["new.metric"] = metric
    with pytest.raises(FrozenInstanceError):
        metric.unit = "user-controlled"


@pytest.mark.parametrize(
    "payload",
    [
        {"available": True, "value": False, "source": "record", "reason_code": "MISSING_METRIC"},
        {"available": True, "value": False},
        {"available": False, "reason_code": "MISSING_METRIC", "value": False},
        {"available": False},
        {"available": 1, "value": False, "source": "record"},
        {"available": "false", "reason_code": "MISSING_METRIC"},
    ],
)
def test_observation_rejects_contradictory_states(payload):
    with pytest.raises(PydanticValidationError):
        Observation.model_validate(payload)
