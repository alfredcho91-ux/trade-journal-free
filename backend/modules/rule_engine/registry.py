"""Closed Metric Registry used to validate executable Strategy rule definitions.

This module deliberately contains metadata and definition validation only.  Trade
value extraction and rule evaluation belong to the next Rule Engine phase.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType
from typing import Any, Literal, Mapping, Optional, Tuple

from backend.modules.rule_engine.numeric import canonical_numeric

RuleOperator = Literal["eq", "lte", "gte", "in"]
MetricValueType = Literal["boolean", "numeric", "enum", "normalized_string"]
MetricLifecycle = Literal["ENTRY", "RISK", "REVIEW", "EXIT"]
MetricStringFormat = Literal["uppercase_alphanumeric"]

REGISTRY_VERSION = 1
DEFAULT_MAX_IN_VALUES = 50
DEFAULT_MAX_STRING_LENGTH = 80


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    label: str
    value_type: MetricValueType
    unit: str
    allowed_operators: frozenset[RuleOperator]
    lifecycle: MetricLifecycle
    enum_values: Tuple[str, ...] = ()
    minimum: Optional[Decimal] = None
    maximum: Optional[Decimal] = None
    max_in_values: int = DEFAULT_MAX_IN_VALUES
    max_string_length: int = DEFAULT_MAX_STRING_LENGTH
    string_format: Optional[MetricStringFormat] = None


def _metric(
    identifier: str,
    label: str,
    value_type: MetricValueType,
    unit: str,
    operators: tuple[RuleOperator, ...],
    lifecycle: MetricLifecycle,
    *,
    enum_values: tuple[str, ...] = (),
    minimum: Optional[str] = None,
    maximum: Optional[str] = None,
    string_format: Optional[MetricStringFormat] = None,
) -> MetricDefinition:
    return MetricDefinition(
        id=identifier,
        label=label,
        value_type=value_type,
        unit=unit,
        allowed_operators=frozenset(operators),
        lifecycle=lifecycle,
        enum_values=enum_values,
        minimum=Decimal(minimum) if minimum is not None else None,
        maximum=Decimal(maximum) if maximum is not None else None,
        string_format=string_format,
    )


_METRICS = (
    _metric("trade.direction", "Trade direction", "enum", "direction", ("eq", "in"), "ENTRY", enum_values=("Long", "Short")),
    _metric(
        "trade.symbol",
        "Trade symbol",
        "normalized_string",
        "symbol",
        ("eq", "in"),
        "ENTRY",
        string_format="uppercase_alphanumeric",
    ),
    _metric("plan.recorded_before_entry", "Plan recorded before entry", "boolean", "boolean", ("eq",), "ENTRY"),
    _metric("execution.entry_deviation_r", "Entry deviation", "numeric", "R", ("lte", "gte"), "ENTRY"),
    _metric("plan.stop_distance_pct", "Stop distance", "numeric", "percent", ("lte", "gte"), "RISK"),
    _metric("plan.total_reward_risk_ratio", "Total reward-risk ratio", "numeric", "R", ("lte", "gte"), "RISK"),
    _metric("plan.max_hold_hours", "Maximum hold time", "numeric", "hours", ("lte", "gte"), "RISK"),
    _metric("journal.confidence_score", "Confidence score", "numeric", "score", ("lte", "gte"), "REVIEW", minimum="1", maximum="5"),
    _metric("journal.focus_score", "Focus score", "numeric", "score", ("lte", "gte"), "REVIEW", minimum="1", maximum="5"),
    _metric("journal.fomo", "FOMO recorded", "boolean", "boolean", ("eq",), "REVIEW"),
    _metric("journal.revenge_trade", "Revenge trade recorded", "boolean", "boolean", ("eq",), "REVIEW"),
    _metric("execution.holding_minutes", "Holding time", "numeric", "minutes", ("lte", "gte"), "EXIT"),
    _metric("execution.price_return_pct", "Price return", "numeric", "percent", ("lte", "gte"), "EXIT"),
    _metric("execution.realized_r", "Realized result", "numeric", "R", ("lte", "gte"), "EXIT"),
)

METRIC_REGISTRY: Mapping[str, MetricDefinition] = MappingProxyType(
    {metric.id: metric for metric in _METRICS}
)


def _finite_decimal(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Expected value must be a finite number")
    try:
        decimal = Decimal(canonical_numeric(value))
    except ValueError as exc:
        raise ValueError("Expected value must be a finite number") from exc
    return decimal


def _validate_numeric_range(metric: MetricDefinition, value: Decimal) -> None:
    if metric.minimum is not None and value < metric.minimum:
        raise ValueError(f"Expected value for {metric.id} must be at least {metric.minimum}")
    if metric.maximum is not None and value > metric.maximum:
        raise ValueError(f"Expected value for {metric.id} must be at most {metric.maximum}")


def _validate_numeric(metric: MetricDefinition, expected: Any) -> None:
    _validate_numeric_range(metric, _finite_decimal(expected))


def _validate_enum_item(metric: MetricDefinition, value: Any) -> str:
    if not isinstance(value, str) or value not in metric.enum_values:
        allowed = ", ".join(metric.enum_values)
        raise ValueError(f"Expected value for {metric.id} must be one of: {allowed}")
    return value


def _validate_normalized_string(metric: MetricDefinition, value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > metric.max_string_length:
        raise ValueError(f"Expected value for {metric.id} must be a non-empty normalized string")
    if metric.string_format != "uppercase_alphanumeric":
        raise ValueError(f"String validation contract is unavailable for metric {metric.id}")
    if not value.isascii() or not value.isalnum() or value != value.upper():
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


def validate_observation_value(metric: MetricDefinition, value: Any) -> None:
    """Validate one already-extracted scalar against registry-owned semantics."""
    if metric.value_type == "numeric":
        try:
            decimal = Decimal(canonical_numeric(value))
        except ValueError as exc:
            raise ValueError("Observed value must be a finite number") from exc
        _validate_numeric_range(metric, decimal)
    else:
        _validate_scalar(metric, value)


__all__ = [
    "METRIC_REGISTRY",
    "MetricDefinition",
    "MetricLifecycle",
    "MetricStringFormat",
    "MetricValueType",
    "REGISTRY_VERSION",
    "RuleOperator",
    "validate_evaluator_definition",
    "validate_observation_value",
]
