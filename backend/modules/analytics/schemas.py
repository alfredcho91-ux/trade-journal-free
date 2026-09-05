"""Typed bounded query and evidence contract for the future Analysis Builder."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from backend.modules.analytics.registry import (
    DIMENSION_REGISTRY, MAX_GROUPS, MAX_PLAN_ROWS, MAX_RULE_RESULTS, MAX_TRADES, METRIC_REGISTRY,
)
from backend.modules.rule_engine.models import EvaluationSummary, RuleEvaluationStatus

Identifier = Annotated[StrictInt, Field(gt=0)]
Text = Annotated[str, Field(min_length=1, max_length=160)]
ScoreState = Literal["1", "2", "3", "4", "5", "UNRECORDED", "INVALID"]
FlagState = Literal["TRUE", "FALSE", "UNRECORDED", "INVALID"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyticsFilters(Contract):
    start_time: Annotated[StrictInt, Field(ge=1, le=253402300799999)]
    end_time: Annotated[StrictInt, Field(ge=1, le=253402300799999)]
    strategy_ids: list[Identifier] | None = Field(default=None, min_length=1, max_length=50)
    strategy_version_ids: list[Identifier] | None = Field(default=None, min_length=1, max_length=50)
    assignment: Literal["ALL", "ASSIGNED", "UNASSIGNED"] = "ALL"
    symbols: list[Text] | None = Field(default=None, min_length=1, max_length=50)
    directions: list[Literal["Long", "Short"]] | None = Field(default=None, min_length=1, max_length=2)
    setups: list[Text] | None = Field(default=None, min_length=1, max_length=50)
    confidence_score: list[ScoreState] | None = Field(default=None, min_length=1, max_length=7)
    focus_score: list[ScoreState] | None = Field(default=None, min_length=1, max_length=7)
    fomo: list[FlagState] | None = Field(default=None, min_length=1, max_length=4)
    revenge_trade: list[FlagState] | None = Field(default=None, min_length=1, max_length=4)
    rule_statuses: list[RuleEvaluationStatus] | None = Field(default=None, min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_filters(self):
        if self.start_time > self.end_time:
            raise ValueError("start_time must not exceed end_time")
        if self.assignment == "UNASSIGNED" and (self.strategy_ids or self.strategy_version_ids):
            raise ValueError("UNASSIGNED cannot be combined with Strategy/version IDs")
        for name in type(self).model_fields:
            value = getattr(self, name)
            if isinstance(value, list):
                if len(value) != len(set(value)):
                    raise ValueError(f"{name} must contain unique values")
                if any(isinstance(item, str) and (not item.strip() or item != item.strip()) for item in value):
                    raise ValueError(f"{name} values must be nonblank and trimmed")
        return self


class AnalyticsQuery(Contract):
    metric: str
    dimension: str = "all"
    filters: AnalyticsFilters

    @model_validator(mode="after")
    def validate_registry(self):
        metric = METRIC_REGISTRY.get(self.metric)
        if metric is None:
            raise ValueError("Unsupported analytics metric")
        if self.dimension not in DIMENSION_REGISTRY:
            raise ValueError("Unsupported analytics dimension")
        if self.dimension not in metric.supported_dimensions:
            raise ValueError("Unsupported metric and dimension combination")
        if self.filters.rule_statuses and metric.sample_unit != "trade_rule":
            raise ValueError("rule_statuses only applies to rule metrics")
        return self


class MetricMetadata(Contract):
    id: str
    label: str
    unit: str
    sample_unit: Literal["trade", "trade_rule"]
    aggregation: str
    availability: str
    supported_dimensions: list[str]


class DimensionMetadata(Contract):
    id: str
    label: str
    semantics: str
    multi_membership: bool


class GroupIdentity(Contract):
    key: str
    label: str
    state: Literal["RECORDED", "ALL", "UNASSIGNED", "UNRECORDED", "INVALID", "NO_RULES"] = "RECORDED"
    strategy_id: int | None = None
    strategy_version_id: int | None = None
    rule_id: str | None = None
    rule_category: str | None = None


class AnalyticsGroup(Contract):
    identity: GroupIdentity
    value: int | float | str | None
    total_sample: int
    evaluable_sample: int
    unavailable_sample: int
    trade_sample: int
    unassigned_trade_count: int
    assigned_without_rules_count: int
    unavailable_reason: str | None = None
    unavailable_reasons: dict[str, int] = Field(default_factory=dict)
    profit_factor_infinite: bool = False
    rule_summary: EvaluationSummary | None = None
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"

    @model_validator(mode="after")
    def validate_sample_invariants(self):
        if self.total_sample != self.evaluable_sample + self.unavailable_sample:
            raise ValueError("Total sample must equal evaluable plus unavailable")
        if any(count < 0 for count in (self.total_sample, self.evaluable_sample, self.unavailable_sample,
                                      self.trade_sample, self.unassigned_trade_count, self.assigned_without_rules_count)):
            raise ValueError("Sample counts cannot be negative")
        if sum(self.unavailable_reasons.values()) != self.unavailable_sample:
            raise ValueError("Unavailable reasons must account for unavailable samples")
        return self


class AnalyticsLimits(Contract):
    journal_snapshot_rows: int = MAX_TRADES
    plan_snapshot_rows_per_table: int = MAX_PLAN_ROWS
    reconstructed_rule_results: int = MAX_RULE_RESULTS
    groups: int = MAX_GROUPS
    max_filter_list: int = 50


class AnalyticsData(Contract):
    registry_version: Literal[1] = 1
    metric: MetricMetadata
    dimension: DimensionMetadata
    filters: AnalyticsFilters
    groups: list[AnalyticsGroup]
    selected_trade_count: int
    excluded_unavailable_close_count: int
    timezone: Literal["UTC"] = "UTC"
    time_basis: Literal["CLOSE_DATETIME_INCLUSIVE"] = "CLOSE_DATETIME_INCLUSIVE"
    population: Literal["JOURNAL_CLOSED_POSITIONS"] = "JOURNAL_CLOSED_POSITIONS"
    evaluation_basis: Literal["CURRENT_RECONSTRUCTED"] = "CURRENT_RECONSTRUCTED"
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"
    warnings: list[str]
    limits: AnalyticsLimits = Field(default_factory=AnalyticsLimits)


class AnalyticsEnvelope(Contract):
    success: Literal[True] = True
    data: AnalyticsData
