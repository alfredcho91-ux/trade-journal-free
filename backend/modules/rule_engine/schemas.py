"""API contracts for current reconstructed per-trade rule evaluation."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict

from backend.modules.rule_engine.models import (
    CategoryEvaluationSummaries,
    RuleEvaluationResult,
)
from backend.modules.rule_engine.registry import MetricLifecycle, RuleOperator


PublicMetricValueType = Literal["boolean", "numeric", "enum", "string"]
PublicStringFormat = Literal["uppercase_alphanumeric"]


class RuleMetricConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enum_values: List[str]
    minimum: Optional[str]
    maximum: Optional[str]
    max_in_values: Optional[int]
    max_string_length: Optional[int]
    string_format: Optional[PublicStringFormat]


class RuleMetricMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_id: str
    label: str
    value_type: PublicMetricValueType
    unit: Optional[str]
    lifecycle: MetricLifecycle
    allowed_operators: List[RuleOperator]
    constraints: RuleMetricConstraints


class RuleEngineMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    registry_version: Literal[1]
    metrics: List[RuleMetricMetadata]


class RuleEngineMetadataEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: RuleEngineMetadata


class EvaluationStrategyIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    name: str
    archived_at: Optional[str]


class EvaluationStrategyVersionIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    strategy_id: int
    sequence: int
    version_label: str
    description: Optional[str]
    is_active: bool
    retired_at: Optional[str]
    created_at: str
    assigned_at: str
    assignment_updated_at: str


class JournalStrategyEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    journal_entry_id: int
    evaluation_basis: Literal["CURRENT_RECONSTRUCTED"]
    strategy: EvaluationStrategyIdentity
    strategy_version: EvaluationStrategyVersionIdentity
    summary: CategoryEvaluationSummaries
    rules: List[RuleEvaluationResult]


class JournalStrategyEvaluationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: Optional[JournalStrategyEvaluation]


__all__ = [
    "JournalStrategyEvaluationEnvelope",
    "RuleEngineMetadataEnvelope",
    "RuleMetricConstraints",
    "RuleMetricMetadata",
]
