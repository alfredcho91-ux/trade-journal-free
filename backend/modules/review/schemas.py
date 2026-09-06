"""PR3 bounded requests and structured, non-causal evidence contracts."""

from types import MappingProxyType
from typing import Literal

from pydantic import Field, StrictBool, model_validator

from backend.modules.analytics.schemas import (
    AnalyticsData, AnalyticsFilters, AnalyticsGroup, AnalyticsLimits, Contract, GroupIdentity,
)
from backend.modules.journal.behavior_analysis import MIN_CONCLUSION_SAMPLE
from backend.modules.plan_lab.analysis import ADHERENCE_THRESHOLD, ENTRY_MINOR_DEVIATION_R
from backend.modules.rule_engine.models import EvaluationSummary

Dimension = Literal["strategy", "strategy_version", "setup", "confidence_score", "focus_score",
                    "fomo", "revenge_trade", "symbol", "direction", "rule", "rule_status", "weekday", "hour"]
PatternMetric = Literal["average_r", "net_return_pct", "adherence_pct"]
DIMENSIONS = ("strategy", "strategy_version", "setup", "confidence_score", "focus_score", "fomo",
              "revenge_trade", "symbol", "direction", "rule", "rule_status", "weekday", "hour")
PATTERN_METRICS = ("average_r", "net_return_pct", "adherence_pct")
MAX_REVIEW_TRADES = 2000
MAX_CANDIDATES = 2000
MAX_VERSION_GROUPS = 200
MAX_MEMBERSHIPS = 100000
RuleDiagnosticRole = Literal["EXECUTION_PROCESS", "OUTCOME", "CONTEXT", "PSYCHOLOGY", "NOT_DIAGNOSTIC"]

# This policy deliberately belongs to PR3 diagnosis only. It does not change
# PR2B's truthful evaluation or its overall adherence and coverage summaries.
DIAGNOSIS_RULE_METRIC_ROLES = MappingProxyType({
    "trade.direction": "CONTEXT",
    "trade.symbol": "CONTEXT",
    "plan.recorded_before_entry": "EXECUTION_PROCESS",
    "execution.entry_deviation_r": "EXECUTION_PROCESS",
    "plan.stop_distance_pct": "NOT_DIAGNOSTIC",
    "plan.total_reward_risk_ratio": "NOT_DIAGNOSTIC",
    "plan.max_hold_hours": "NOT_DIAGNOSTIC",
    "journal.confidence_score": "PSYCHOLOGY",
    "journal.focus_score": "PSYCHOLOGY",
    "journal.fomo": "PSYCHOLOGY",
    "journal.revenge_trade": "PSYCHOLOGY",
    "execution.holding_minutes": "OUTCOME",
    "execution.price_return_pct": "OUTCOME",
    "execution.realized_r": "OUTCOME",
})


class ReviewRequest(Contract):
    filters: AnalyticsFilters
    compare_previous: StrictBool = False
    pattern_dimensions: list[Dimension] = Field(default_factory=lambda: list(DIMENSIONS), min_length=1, max_length=13)
    pattern_metrics: list[PatternMetric] = Field(default_factory=lambda: list(PATTERN_METRICS), min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_request(self):
        for values in (self.pattern_dimensions, self.pattern_metrics):
            if len(values) != len(set(values)):
                raise ValueError("Pattern dimensions/metrics must be unique")
        # One review composes both trade and trade-rule metrics. Status filtering
        # would select incompatible denominators and hide unknown evidence.
        if self.filters.rule_statuses is not None:
            raise ValueError("Review does not accept rule_statuses; use the rule_status dimension")
        if self.compare_previous and self.filters.start_time - self.duration_ms < 1:
            raise ValueError("The preceding equal-length period is outside supported timestamps")
        return self

    @property
    def duration_ms(self):
        return self.filters.end_time - self.filters.start_time + 1


class ReviewPolicy(Contract):
    version: Literal[1] = 1
    minimum_trade_sample: int = MIN_CONCLUSION_SAMPLE
    minimum_evaluable_sample: int = MIN_CONCLUSION_SAMPLE
    minimum_availability_pct: int = 80
    healthy_rule_adherence_pct: float = ADHERENCE_THRESHOLD
    entry_deviation_limit_r: float = ENTRY_MINOR_DEVIATION_R
    healthy_entry_alignment_pct: int = 80
    strategy_positive_boundary: int = 0
    strategy_signals: tuple[str, ...] = ("average_r", "net_return_pct")
    strategy_signal_policy: str = "Both strictly positive or both strictly negative; zero or disagreement is INCONCLUSIVE."
    execution_signal_policy: str = "Rule adherence and within-limit entry-deviation share must agree; unknown or low coverage is INCONCLUSIVE."
    execution_rule_metric_roles: dict[str, RuleDiagnosticRole] = Field(
        default_factory=lambda: dict(DIAGNOSIS_RULE_METRIC_ROLES),
        description="PR3 diagnosis-only rule roles. Only EXECUTION_PROCESS contributes to execution-rule adherence and coverage.",
    )
    pattern_baseline: str = "ALL_SELECTED_TRADES_INCLUDING_SEGMENT; same metric, sample unit and filters"
    pattern_eligibility: str = "Minimum independent trades and evaluable samples, >=80% availability, finite segment/baseline; missing identities remain limited evidence."
    pattern_order: str = "metric ID ASC, eligible first, absolute delta DESC, trade sample DESC, dimension ASC, group key ASC; never compare magnitudes across units"
    threshold_semantics: str = "Descriptive review policy, not statistical significance, causality, confidence or predicted performance. Entry limit/adherence threshold reuse Plan Lab conventions."
    selected_trades_including_previous: int = MAX_REVIEW_TRADES
    candidate_limit: int = MAX_CANDIDATES
    version_group_limit: int = MAX_VERSION_GROUPS
    dimension_membership_limit: int = MAX_MEMBERSHIPS
    source_limits: AnalyticsLimits = Field(default_factory=AnalyticsLimits)


class CurrentPeriodRequest(ReviewRequest):
    """Patterns and diagnoses are current-cohort views; comparison is trading-only."""
    compare_previous: Literal[False] = False


class ReviewMetadata(Contract):
    filters: AnalyticsFilters
    policy: ReviewPolicy = Field(default_factory=ReviewPolicy)
    timezone: Literal["UTC"] = "UTC"
    time_basis: Literal["CLOSE_DATETIME_INCLUSIVE"] = "CLOSE_DATETIME_INCLUSIVE"
    evaluation_basis: Literal["CURRENT_RECONSTRUCTED"] = "CURRENT_RECONSTRUCTED"
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"
    warnings: list[str]


class PatternCandidate(Contract):
    metric: PatternMetric
    dimension: Dimension
    observed: AnalyticsGroup
    baseline: AnalyticsGroup
    signed_delta: str | None
    absolute_delta: str | None
    status: Literal["ELIGIBLE", "INSUFFICIENT_EVIDENCE"]
    reasons: list[str]
    evaluable_trade_sample: int
    baseline_evaluable_trade_sample: int
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"


class PatternData(Contract):
    metadata: ReviewMetadata
    candidates: list[PatternCandidate]
    eligible_count: int
    insufficient_count: int
    state: Literal["AVAILABLE", "EMPTY_PERIOD"]


class ObservationEvidence(Contract):
    metric: str
    unit: str
    aggregation: Literal["MEAN", "BOOLEAN_COUNTS", "UNAVAILABLE"] = "UNAVAILABLE"
    value: float | None = None
    total_sample: int
    evaluable_sample: int
    unavailable_sample: int
    unavailable_reasons: dict[str, int]
    unavailable_reason: str | None = None
    true_sample: int | None = None
    false_sample: int | None = None
    within_entry_limit_sample: int | None = None
    outside_entry_limit_sample: int | None = None
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"

    @model_validator(mode="after")
    def validate_counts(self):
        if self.total_sample != self.evaluable_sample + self.unavailable_sample:
            raise ValueError("Inconsistent observation sample counts")
        if sum(self.unavailable_reasons.values()) != self.unavailable_sample:
            raise ValueError("Missing observation reason counts")
        return self


Classification = Literal["STRATEGY_POSITIVE_EXECUTION_HEALTHY", "STRATEGY_POSITIVE_EXECUTION_DRAG",
                         "STRATEGY_WEAK_EXECUTION_HEALTHY", "STRATEGY_WEAK_EXECUTION_DRAG", "INCONCLUSIVE"]


class DiagnosisRuleEvidence(Contract):
    """Subset summary used only by Strategy-vs-Execution diagnosis."""
    total_rule_count: int
    execution_eligible_rule_count: int
    execution_evaluable_rule_count: int
    excluded_rule_count: int
    excluded_rule_counts_by_role: dict[RuleDiagnosticRole, int]
    summary: EvaluationSummary

    @model_validator(mode="after")
    def validate_rule_subset(self):
        if self.total_rule_count != self.execution_eligible_rule_count + self.excluded_rule_count:
            raise ValueError("Diagnosis rule counts must account for every rule")
        if self.summary.total_rules != self.execution_eligible_rule_count:
            raise ValueError("Diagnosis summary must use eligible rules only")
        if self.summary.evaluable_rules != self.execution_evaluable_rule_count:
            raise ValueError("Diagnosis evaluable count must use eligible rules only")
        if sum(self.excluded_rule_counts_by_role.values()) != self.excluded_rule_count:
            raise ValueError("Excluded diagnosis rules require role counts")
        return self


class Diagnosis(Contract):
    identity: GroupIdentity
    classification: Classification
    reasons: list[str]
    strategy_evidence: list[AnalyticsData]
    execution_rule_evidence: DiagnosisRuleEvidence
    entry_deviation: ObservationEvidence
    evaluable_rule_trade_sample: int
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"


class DiagnosisData(Contract):
    metadata: ReviewMetadata
    diagnoses: list[Diagnosis]
    state: Literal["AVAILABLE", "EMPTY_PERIOD"]


class PeriodMetric(Contract):
    metric: str
    current: AnalyticsGroup
    comparison: AnalyticsGroup
    signed_delta: str | None
    unavailable_reason: str | None


class PeriodComparison(Contract):
    state: Literal["NOT_REQUESTED", "AVAILABLE", "INSUFFICIENT_EVIDENCE"]
    filters: AnalyticsFilters | None = None
    metrics: list[PeriodMetric] = Field(default_factory=list)


class ExecutionSection(Contract):
    rule_and_holding_metrics: list[AnalyticsData]
    observations: list[ObservationEvidence]
    market_dependent: list[ObservationEvidence]


class EvidenceQuality(Contract):
    selected_trade_count: int
    unassigned_trade_count: int
    assigned_without_rules_count: int
    evaluable_rule_trade_count: int
    excluded_close_time_count_all_stored_positions: int
    observations: list[ObservationEvidence]


class TradingReview(Contract):
    metadata: ReviewMetadata
    state: Literal["AVAILABLE", "EMPTY_PERIOD"]
    performance: list[AnalyticsData]
    strategy: list[AnalyticsData]
    execution: ExecutionSection
    psychology: list[AnalyticsData]
    patterns: PatternData
    strategy_execution: DiagnosisData
    evidence_quality: EvidenceQuality
    period_comparison: PeriodComparison


class TradingEnvelope(Contract):
    success: Literal[True] = True
    data: TradingReview


class PatternEnvelope(Contract):
    success: Literal[True] = True
    data: PatternData


class DiagnosisEnvelope(Contract):
    success: Literal[True] = True
    data: DiagnosisData
