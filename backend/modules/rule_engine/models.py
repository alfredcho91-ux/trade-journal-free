"""Pydantic contracts for Rule Engine definitions and pure evaluation facts."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from backend.modules.rule_engine.registry import (
    MetricValueType,
    RuleOperator,
    validate_evaluator_definition,
)


class RuleEvaluator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_id: str
    operator: RuleOperator
    expected: Any

    @model_validator(mode="after")
    def validate_against_registry(self):
        validate_evaluator_definition(self.metric_id, self.operator, self.expected)
        return self


class RuleEvaluationStatus(str, Enum):
    FOLLOWED = "FOLLOWED"
    VIOLATED = "VIOLATED"
    NOT_EVALUABLE = "NOT_EVALUABLE"


class NotEvaluableReason(str, Enum):
    NO_EVALUATOR = "NO_EVALUATOR"
    MISSING_METRIC = "MISSING_METRIC"
    MISSING_PLAN = "MISSING_PLAN"
    PLAN_NOT_EFFECTIVE_AT_ENTRY = "PLAN_NOT_EFFECTIVE_AT_ENTRY"
    INVALID_PLAN = "INVALID_PLAN"
    TRADE_NOT_CLOSED = "TRADE_NOT_CLOSED"
    LEGACY_DATA_UNAVAILABLE = "LEGACY_DATA_UNAVAILABLE"
    UNSUPPORTED_SOURCE = "UNSUPPORTED_SOURCE"
    MARKET_DATA_UNAVAILABLE = "MARKET_DATA_UNAVAILABLE"
    INCOMPLETE_MARKET_PATH = "INCOMPLETE_MARKET_PATH"
    INVALID_HISTORICAL_DATA = "INVALID_HISTORICAL_DATA"
    RULE_SCHEMA_UNSUPPORTED = "RULE_SCHEMA_UNSUPPORTED"


class RuleCategory(str, Enum):
    ENTRY = "ENTRY"
    RISK = "RISK"
    EXIT = "EXIT"


class Observation(BaseModel):
    """An already-extracted fact; extraction and lifecycle decisions live elsewhere."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    available: StrictBool
    value: Any = None
    source: Optional[str] = Field(default=None, min_length=1, max_length=120)
    record_id: Optional[Union[int, str]] = None
    reason_code: Optional[NotEvaluableReason] = None

    @model_validator(mode="after")
    def require_consistent_availability(self):
        if self.available:
            if self.value is None or self.source is None or self.reason_code is not None:
                raise ValueError(
                    "Available observations require value and source without a reason code"
                )
        elif (
            self.reason_code is None
            or self.value is not None
            or self.source is not None
            or self.record_id is not None
        ):
            raise ValueError(
                "Unavailable observations require only a bounded reason code"
            )
        return self


class ConditionFact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    metric_id: str
    operator: RuleOperator
    expected: Any
    unit: str
    value_type: MetricValueType


class ObservationFact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    available: StrictBool
    value: Any = None
    unit: Optional[str] = None
    source: Optional[str] = None
    record_id: Optional[Union[int, str]] = None
    reason_code: Optional[NotEvaluableReason] = None

    @model_validator(mode="after")
    def require_consistent_availability(self):
        if self.available:
            if (
                self.value is None
                or self.unit is None
                or self.source is None
                or self.reason_code is not None
            ):
                raise ValueError(
                    "Available observation facts require value, unit, and source"
                )
        elif (
            self.reason_code is None
            or self.value is not None
            or self.source is not None
            or self.record_id is not None
        ):
            raise ValueError(
                "Unavailable observation facts cannot contain an observed value"
            )
        return self


class RuleExplanation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    template_id: str
    message: str


class RuleEvaluationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_id: str
    category: RuleCategory
    text: str
    status: RuleEvaluationStatus
    reason_code: Optional[NotEvaluableReason] = None
    condition: Optional[ConditionFact] = None
    observation: ObservationFact
    explanation: RuleExplanation

    @model_validator(mode="after")
    def require_status_consistency(self):
        if self.status == RuleEvaluationStatus.NOT_EVALUABLE:
            if (
                self.reason_code is None
                or self.observation.available
                or self.observation.reason_code != self.reason_code
            ):
                raise ValueError("NOT_EVALUABLE results require a reason code")
        elif (
            self.reason_code is not None
            or not self.observation.available
            or self.condition is None
        ):
            raise ValueError(
                "Evaluable results require condition and available observation facts"
            )
        return self


class EvaluationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    total_rules: int = Field(ge=0)
    evaluable_rules: int = Field(ge=0)
    followed_rules: int = Field(ge=0)
    violated_rules: int = Field(ge=0)
    not_evaluable_rules: int = Field(ge=0)
    adherence_pct: Optional[str]
    coverage_pct: Optional[str]

    @model_validator(mode="after")
    def require_count_invariants(self):
        if self.evaluable_rules != self.followed_rules + self.violated_rules:
            raise ValueError("Evaluable count must equal followed plus violated")
        if self.total_rules != self.evaluable_rules + self.not_evaluable_rules:
            raise ValueError("Total count must equal evaluable plus not evaluable")
        return self


class CategoryEvaluationSummaries(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    overall: EvaluationSummary
    entry: EvaluationSummary
    risk: EvaluationSummary
    exit: EvaluationSummary


__all__ = [
    "CategoryEvaluationSummaries",
    "ConditionFact",
    "EvaluationSummary",
    "NotEvaluableReason",
    "Observation",
    "ObservationFact",
    "RuleCategory",
    "RuleEvaluationResult",
    "RuleEvaluationStatus",
    "RuleEvaluator",
    "RuleExplanation",
]
