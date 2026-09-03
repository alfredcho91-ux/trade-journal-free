"""Closed Metric Registry used to validate executable Strategy rule definitions.

This module deliberately contains metadata and definition validation only.  Trade
value extraction and rule evaluation belong to the next Rule Engine phase.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from types import MappingProxyType
from typing import Any, Literal, Mapping, Optional, Tuple

from backend.modules.plan_lab.repository import normalize_symbol

RuleOperator = Literal["eq", "lte", "gte", "in"]
MetricValueType = Literal["boolean", "numeric", "enum", "normalized_string"]
MetricLifecycle = Literal["ENTRY", "RISK", "REVIEW", "EXIT"]

DEFAULT_MAX_IN_VALUES = 50
DEFAULT_MAX_STRING_LENGTH = 80


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    value_type: MetricValueType
    unit: str
    allowed_operators: frozenset[RuleOperator]
    lifecycle: MetricLifecycle
    enum_values: Tuple[str, ...] = ()
    minimum: Optional[Decimal] = None
    maximum: Optional[Decimal] = None
    max_in_values: int = DEFAULT_MAX_IN_VALUES
    max_string_length: int = DEFAULT_MAX_STRING_LENGTH


def _metric(
    identifier: str,
    value_type: MetricValueType,
    unit: str,
    operators: tuple[RuleOperator, ...],
    lifecycle: MetricLifecycle,
    *,
    enum_values: tuple[str, ...] = (),
    minimum: Optional[str] = None,
    maximum: Optional[str] = None,
) -> MetricDefinition:
    return MetricDefinition(
        id=identifier,
        value_type=value_type,
        unit=unit,
        allowed_operators=frozenset(operators),
        lifecycle=lifecycle,
        enum_values=enum_values,
        minimum=Decimal(minimum) if minimum is not None else None,
        maximum=Decimal(maximum) if maximum is not None else None,
    )


_METRICS = (
    _metric("trade.direction", "enum", "direction", ("eq", "in"), "ENTRY", enum_values=("Long", "Short")),
    _metric("trade.symbol", "normalized_string", "symbol", ("eq", "in"), "ENTRY"),
    _metric("plan.recorded_before_entry", "boolean", "boolean", ("eq",), "ENTRY"),
    _metric("execution.entry_deviation_r", "numeric", "R", ("lte", "gte"), "ENTRY"),
    _metric("plan.stop_distance_pct", "numeric", "percent", ("lte", "gte"), "RISK"),
    _metric("plan.total_reward_risk_ratio", "numeric", "R", ("lte", "gte"), "RISK"),
    _metric("plan.max_hold_hours", "numeric", "hours", ("lte", "gte"), "RISK"),
    _metric("journal.confidence_score", "numeric", "score", ("lte", "gte"), "REVIEW", minimum="1", maximum="5"),
    _metric("journal.focus_score", "numeric", "score", ("lte", "gte"), "REVIEW", minimum="1", maximum="5"),
    _metric("journal.fomo", "boolean", "boolean", ("eq",), "REVIEW"),
    _metric("journal.revenge_trade", "boolean", "boolean", ("eq",), "REVIEW"),
    _metric("execution.holding_minutes", "numeric", "minutes", ("lte", "gte"), "EXIT"),
    _metric("execution.price_return_pct", "numeric", "percent", ("lte", "gte"), "EXIT"),
    _metric("execution.realized_r", "numeric", "R", ("lte", "gte"), "EXIT"),
)

METRIC_REGISTRY: Mapping[str, MetricDefinition] = MappingProxyType(
    {metric.id: metric for metric in _METRICS}
)


def _finite_decimal(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Expected value must be a finite number")
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Expected value must be a finite number") from exc
    if not decimal.is_finite():
        raise ValueError("Expected value must be a finite number")
    return decimal


def _validate_numeric(metric: MetricDefinition, expected: Any) -> None:
    value = _finite_decimal(expected)
    if metric.minimum is not None and value < metric.minimum:
        raise ValueError(f"Expected value for {metric.id} must be at least {metric.minimum}")
    if metric.maximum is not None and value > metric.maximum:
        raise ValueError(f"Expected value for {metric.id} must be at most {metric.maximum}")


def _validate_enum_item(metric: MetricDefinition, value: Any) -> str:
    if not isinstance(value, str) or value not in metric.enum_values:
        allowed = ", ".join(metric.enum_values)
        raise ValueError(f"Expected value for {metric.id} must be one of: {allowed}")
    return value


def _validate_normalized_string(metric: MetricDefinition, value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > metric.max_string_length:
        raise ValueError(f"Expected value for {metric.id} must be a non-empty normalized string")
    normalized = normalize_symbol(value)
    if normalized != value:
        raise ValueError(
            f"Expected value for {metric.id} must already use canonical uppercase alphanumeric form"
        )
    return value


def _validate_scalar(metric: MetricDefinition, expected: Any) -> None:
    if metric.value_type == "boolean":
        if type(expected) is not bool:
            raise ValueError(f"Expected value for {metric.id} must be a boolean")
    elif metric.value_type == "numeric":
        _validate_numeric(metric, expected)
    elif metric.value_type == "enum":
        _validate_enum_item(metric, expected)
    elif metric.value_type == "normalized_string":
        _validate_normalized_string(metric, expected)


def validate_evaluator_definition(metric_id: str, operator: RuleOperator, expected: Any) -> None:
    """Validate one evaluator without executing or normalizing user expressions."""
    metric = METRIC_REGISTRY.get(metric_id)
    if metric is None:
        raise ValueError(f"Unknown Rule Engine metric: {metric_id}")
    if operator not in metric.allowed_operators:
        raise ValueError(f"Operator {operator} is not supported for metric {metric_id}")

    if operator == "in":
        if not isinstance(expected, list) or not expected or len(expected) > metric.max_in_values:
            raise ValueError("Expected value for operator in must be a non-empty bounded list")
        validated = []
        for item in expected:
            validated.append(
                _validate_enum_item(metric, item)
                if metric.value_type == "enum"
                else _validate_normalized_string(metric, item)
            )
        if len(validated) != len(set(validated)):
            raise ValueError("Expected values for operator in must be unique")
        return

    _validate_scalar(metric, expected)


__all__ = [
    "METRIC_REGISTRY",
    "MetricDefinition",
    "MetricLifecycle",
    "MetricValueType",
    "RuleOperator",
    "validate_evaluator_definition",
]
