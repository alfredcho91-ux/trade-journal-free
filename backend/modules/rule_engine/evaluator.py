"""Pure deterministic evaluation of validated rules against extracted facts."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Any, Mapping, Optional, Union

from pydantic import ValidationError

from backend.modules.rule_engine.explanations import (
    evaluable_explanation,
    not_evaluable_explanation,
)
from backend.modules.rule_engine.models import (
    ConditionFact,
    NotEvaluableReason,
    Observation,
    ObservationFact,
    RuleCategory,
    RuleEvaluationResult,
    RuleEvaluationStatus,
    RuleEvaluator,
)
from backend.modules.rule_engine.numeric import canonical_numeric
from backend.modules.rule_engine.registry import (
    METRIC_REGISTRY,
    MetricDefinition,
    validate_observation_value,
)

ABSOLUTE_TOLERANCE = Decimal("1e-8")
RELATIVE_TOLERANCE = Decimal("1e-8")


def numeric_tolerance(expected: Decimal) -> Decimal:
    """Return the official tolerance without consulting ambient Decimal context.

    Multiplication by 1e-8 is exactly a decimal-exponent shift.  Constructing
    that value from the operand tuple avoids precision-dependent rounding while
    preserving the required ``abs(expected) * Decimal("1e-8")`` semantics.
    """
    magnitude = expected.copy_abs()
    parts = magnitude.as_tuple()
    relative = Decimal((parts.sign, parts.digits, parts.exponent - 8))
    return max(ABSOLUTE_TOLERANCE, relative)


def _finite_decimal(value: Any) -> Decimal:
    try:
        decimal = Decimal(canonical_numeric(value))
    except ValueError as exc:
        raise ValueError("Value is not numeric") from exc
    return decimal


def _canonical_value(metric: MetricDefinition, value: Any) -> Any:
    if metric.value_type == "numeric":
        return canonical_numeric(value)
    if isinstance(value, list):
        return list(value)
    return value


def _condition(metric: MetricDefinition, evaluator: RuleEvaluator) -> ConditionFact:
    return ConditionFact(
        metric_id=metric.id,
        operator=evaluator.operator,
        expected=_canonical_value(metric, evaluator.expected),
        unit=metric.unit,
        value_type=metric.value_type,
    )


def _unavailable_fact(
    reason: NotEvaluableReason, *, metric: Optional[MetricDefinition] = None
) -> ObservationFact:
    return ObservationFact(
        available=False,
        unit=metric.unit if metric else None,
        reason_code=reason,
    )


def _not_evaluable(
    *,
    rule_id: str,
    category: RuleCategory,
    text: str,
    reason: NotEvaluableReason,
    condition: Optional[ConditionFact] = None,
    metric: Optional[MetricDefinition] = None,
) -> RuleEvaluationResult:
    return RuleEvaluationResult(
        rule_id=rule_id,
        category=category,
        text=text,
        status=RuleEvaluationStatus.NOT_EVALUABLE,
        reason_code=reason,
        condition=condition,
        observation=_unavailable_fact(reason, metric=metric),
        explanation=not_evaluable_explanation(reason),
    )


def _validated_evaluator(
    evaluator: Union[RuleEvaluator, Mapping[str, Any]],
) -> Optional[RuleEvaluator]:
    try:
        payload = evaluator.model_dump() if isinstance(evaluator, RuleEvaluator) else evaluator
        return RuleEvaluator.model_validate(payload)
    except (ValidationError, TypeError, ValueError):
        return None


def _compare(
    metric: MetricDefinition,
    evaluator: RuleEvaluator,
    observed: Any,
) -> tuple[RuleEvaluationStatus, Any, bool]:
    validate_observation_value(metric, observed)

    if metric.value_type == "numeric":
        expected_decimal = _finite_decimal(evaluator.expected)
        observed_decimal = _finite_decimal(observed)
        tolerance = numeric_tolerance(expected_decimal)
        expected_exact = Fraction(expected_decimal)
        observed_exact = Fraction(observed_decimal)
        tolerance_exact = Fraction(tolerance)
        if evaluator.operator == "lte":
            satisfies_raw_threshold = observed_exact <= expected_exact
            followed = observed_exact <= expected_exact + tolerance_exact
        elif evaluator.operator == "gte":
            satisfies_raw_threshold = observed_exact >= expected_exact
            followed = observed_exact >= expected_exact - tolerance_exact
        else:
            raise ValueError("Unsupported numeric operator")
        canonical_observed: Any = canonical_numeric(observed_decimal)
        tolerance_assisted = followed and not satisfies_raw_threshold
    elif evaluator.operator == "eq":
        followed = observed == evaluator.expected
        canonical_observed = observed
        tolerance_assisted = False
    elif evaluator.operator == "in":
        followed = observed in evaluator.expected
        canonical_observed = observed
        tolerance_assisted = False
    else:
        raise ValueError("Unsupported operator")

    return (
        RuleEvaluationStatus.FOLLOWED if followed else RuleEvaluationStatus.VIOLATED,
        canonical_observed,
        tolerance_assisted,
    )


def evaluate_rule(
    *,
    rule_id: str,
    category: RuleCategory,
    text: str,
    evaluator: Optional[Union[RuleEvaluator, Mapping[str, Any]]],
    observation: Optional[Observation],
    schema_version: int,
) -> RuleEvaluationResult:
    """Evaluate one rule without reading infrastructure or mutating its inputs."""
    if type(schema_version) is not int or schema_version not in {1, 2}:
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED,
        )
    if evaluator is None:
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.NO_EVALUATOR,
        )
    if schema_version != 2:
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED,
        )

    validated = _validated_evaluator(evaluator)
    if validated is None:
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED,
        )
    metric = METRIC_REGISTRY.get(validated.metric_id)
    if metric is None:
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED,
        )
    condition = _condition(metric, validated)

    if observation is None:
        reason = NotEvaluableReason.MISSING_METRIC
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=reason,
            condition=condition,
            metric=metric,
        )
    if not observation.available:
        reason = observation.reason_code or NotEvaluableReason.MISSING_METRIC
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=reason,
            condition=condition,
            metric=metric,
        )

    try:
        status, canonical_observed, tolerance_assisted = _compare(
            metric, validated, observation.value
        )
    except (TypeError, ValueError, InvalidOperation):
        return _not_evaluable(
            rule_id=rule_id,
            category=category,
            text=text,
            reason=NotEvaluableReason.INVALID_HISTORICAL_DATA,
            condition=condition,
            metric=metric,
        )

    observation_fact = ObservationFact(
        available=True,
        value=canonical_observed,
        unit=metric.unit,
        source=observation.source,
        record_id=observation.record_id,
    )
    return RuleEvaluationResult(
        rule_id=rule_id,
        category=category,
        text=text,
        status=status,
        condition=condition,
        observation=observation_fact,
        explanation=evaluable_explanation(
            status=status,
            metric=metric,
            operator=validated.operator,
            expected=condition.expected,
            observed=canonical_observed,
            tolerance_assisted=tolerance_assisted,
        ),
    )


__all__ = ["evaluate_rule", "numeric_tolerance"]
