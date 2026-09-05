"""Typed bounded query and evidence contract for the future Analysis Builder."""

from types import MappingProxyType
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
FILTER_APPLICABLE_SAMPLE_UNITS = MappingProxyType({
    identifier: (("trade_rule",) if identifier == "rule_statuses" else ("trade", "trade_rule"))
    for identifier in (
        "start_time", "end_time", "strategy_ids", "strategy_version_ids", "assignment", "symbols",
        "directions", "setups", "confidence_score", "focus_score", "fomo", "revenge_trade", "rule_statuses",
    )
})
FILTER_TIME_ORDER = ("start_time", "end_time")
UNASSIGNED_FORBIDDEN_FILTERS = ("strategy_ids", "strategy_version_ids")


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyticsFilters(Contract):
    start_time: Annotated[StrictInt, Field(ge=1, le=253402300799999, title="Start time", description="Inclusive UTC close/exit timestamp in Unix milliseconds.", json_schema_extra={"value_type": "timestamp_ms", "option_source": "USER_INPUT", "null_semantics": "Required."})]
    end_time: Annotated[StrictInt, Field(ge=1, le=253402300799999, title="End time", description="Inclusive UTC close/exit timestamp in Unix milliseconds.", json_schema_extra={"value_type": "timestamp_ms", "option_source": "USER_INPUT", "null_semantics": "Required."})]
    strategy_ids: list[Identifier] | None = Field(default=None, min_length=1, max_length=50, title="Strategies", description="Exact Strategy IDs; archived Strategies remain addressable.", json_schema_extra={"value_type": "positive_integer", "option_source": "STRATEGIES", "null_semantics": "No Strategy ID filter."})
    strategy_version_ids: list[Identifier] | None = Field(default=None, min_length=1, max_length=50, title="Strategy versions", description="Exact historical StrategyVersion IDs.", json_schema_extra={"value_type": "positive_integer", "option_source": "STRATEGY_VERSIONS", "null_semantics": "No StrategyVersion ID filter."})
    assignment: Literal["ALL", "ASSIGNED", "UNASSIGNED"] = Field(default="ALL", title="Assignment state", description="Include all, assigned, or unassigned trades.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "Not nullable; defaults to ALL."})
    symbols: list[Text] | None = Field(default=None, min_length=1, max_length=50, title="Symbols", description="Exact stored Journal symbols.", json_schema_extra={"value_type": "text", "option_source": "JOURNAL_SYMBOLS", "null_semantics": "No symbol filter."})
    directions: list[Literal["Long", "Short"]] | None = Field(default=None, min_length=1, max_length=2, title="Directions", description="Recorded Long or Short direction.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No direction filter."})
    setups: list[Text] | None = Field(default=None, min_length=1, max_length=50, title="Setups", description="Exact recorded setup tags.", json_schema_extra={"value_type": "text", "option_source": "JOURNAL_SETUPS", "null_semantics": "No setup filter."})
    confidence_score: list[ScoreState] | None = Field(default=None, min_length=1, max_length=7, title="Confidence", description="Recorded score states; UNRECORDED and INVALID remain distinct.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No confidence filter."})
    focus_score: list[ScoreState] | None = Field(default=None, min_length=1, max_length=7, title="Focus", description="Recorded score states; UNRECORDED and INVALID remain distinct.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No focus filter."})
    fomo: list[FlagState] | None = Field(default=None, min_length=1, max_length=4, title="FOMO", description="Recorded boolean states; UNRECORDED and INVALID remain distinct.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No FOMO filter."})
    revenge_trade: list[FlagState] | None = Field(default=None, min_length=1, max_length=4, title="Revenge trade", description="Recorded boolean states; UNRECORDED and INVALID remain distinct.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No revenge-trade filter."})
    rule_statuses: list[RuleEvaluationStatus] | None = Field(default=None, min_length=1, max_length=3, title="Rule statuses", description="PR2B evaluation status; NOT_EVALUABLE remains neutral. Applies only to rule metrics.", json_schema_extra={"value_type": "enum", "option_source": "STATIC", "null_semantics": "No rule-status filter."})

    @model_validator(mode="after")
    def validate_filters(self):
        start_field, end_field = FILTER_TIME_ORDER
        if getattr(self, start_field) > getattr(self, end_field):
            raise ValueError("start_time must not exceed end_time")
        if self.assignment == "UNASSIGNED" and any(getattr(self, field) for field in UNASSIGNED_FORBIDDEN_FILTERS):
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
        for filter_id, sample_units in FILTER_APPLICABLE_SAMPLE_UNITS.items():
            if getattr(self.filters, filter_id) and metric.sample_unit not in sample_units:
                raise ValueError(f"{filter_id} does not apply to {metric.sample_unit} metrics")
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


class AnalyticsDiscoveryMetricMetadata(MetricMetadata):
    value_type: Literal["integer", "decimal"]


class AnalyticsDiscoveryDimensionMetadata(DimensionMetadata):
    category: Literal["aggregate", "strategy", "trade", "psychology", "rule", "time"]
    time_basis: Literal["CLOSE_DATETIME"] | None
    timezone: Literal["UTC"] | None


class FilterMetadata(Contract):
    id: str
    label: str
    description: str
    value_type: Literal["timestamp_ms", "positive_integer", "text", "enum"]
    input_mode: Literal["scalar", "list"]
    required: bool
    nullable: bool
    minimum: int | None = None
    maximum: int | None = None
    exclusive_minimum: int | None = None
    min_items: int | None = None
    max_items: int | None = None
    min_length: int | None = None
    max_length: int | None = None
    enum_values: list[str]
    option_source: Literal["STATIC", "USER_INPUT", "STRATEGIES", "STRATEGY_VERSIONS", "JOURNAL_SYMBOLS", "JOURNAL_SETUPS"]
    null_semantics: str
    applicable_sample_units: list[Literal["trade", "trade_rule"]]


class FilterConstraintMetadata(Contract):
    id: str
    kind: Literal["ORDER", "FORBIDS_WHEN"]
    fields: list[str]
    value: str | None = None
    description: str


class AnalyticsMetadata(Contract):
    registry_version: Literal[1] = 1
    metrics: list[AnalyticsDiscoveryMetricMetadata]
    dimensions: list[AnalyticsDiscoveryDimensionMetadata]
    filters: list[FilterMetadata]
    filter_constraints: list[FilterConstraintMetadata]
    timezone: Literal["UTC"] = "UTC"
    time_basis: Literal["CLOSE_DATETIME_INCLUSIVE"] = "CLOSE_DATETIME_INCLUSIVE"


class AnalyticsMetadataEnvelope(Contract):
    success: Literal[True] = True
    data: AnalyticsMetadata


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
