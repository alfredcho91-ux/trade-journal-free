"""Pure descriptive review over PR2B facts and PR2C aggregates.

No databases, clocks, market fetches, persistent caches or advisory prose.
The diagnosis describes co-occurring outcomes, not a causal decomposition.
"""

from collections import Counter
from decimal import Decimal
from fractions import Fraction

from backend.modules.analytics.core import analyze, group_identities
from backend.modules.analytics.registry import METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.journal.trade_selection import finite_float
from backend.modules.plan_lab.analysis import _mean
from backend.modules.review.context import previous_filters, validate_work_budget
from backend.modules.review.schemas import (
    DIAGNOSIS_RULE_METRIC_ROLES, MAX_CANDIDATES, Diagnosis, DiagnosisData, DiagnosisRuleEvidence, EvidenceQuality, ExecutionSection, ObservationEvidence,
    PatternCandidate, PatternData, PeriodComparison, PeriodMetric, ReviewMetadata, ReviewPolicy, TradingReview,
)
from backend.modules.rule_engine.models import RuleEvaluationStatus
from backend.modules.rule_engine.registry import METRIC_REGISTRY as OBSERVATION_REGISTRY
from backend.modules.rule_engine.summary import summarize_results
from backend.utils.error_handler import ValidationError

PERFORMANCE_METRICS = ("trade_count", "win_rate_pct", "loss_rate_pct", "net_return_pct",
                       "average_return_pct", "total_realized_r", "average_r", "profit_factor")
EXECUTION_METRICS = ("followed_count", "violated_count", "not_evaluable_count", "adherence_pct",
                     "coverage_pct", "average_holding_minutes")
PLAN_METRICS = ("plan.recorded_before_entry", "plan.stop_distance_pct", "plan.total_reward_risk_ratio",
                "plan.max_hold_hours", "execution.entry_deviation_r")
PSYCHOLOGY_FIELDS = ("confidence_score", "focus_score", "fomo", "revenge_trade")


def numeric(value):
    """Preserve the existing public fact exactly; arithmetic uses rational values."""
    if value is None or isinstance(value, bool):
        return None
    decimal = Decimal(str(value))
    return Fraction(decimal) if decimal.is_finite() else None


def exact_decimal(value):
    """Serialize a terminating rational delta without ambient Decimal arithmetic."""
    denominator, twos, fives = value.denominator, 0, 0
    while denominator % 2 == 0:
        denominator //= 2
        twos += 1
    while denominator % 5 == 0:
        denominator //= 5
        fives += 1
    if denominator != 1:
        raise ValueError("Delta must be derived from finite decimal facts")
    scale = max(twos, fives)
    integer = value.numerator * 2 ** (scale - twos) * 5 ** (scale - fives)
    digits = str(abs(integer)).rjust(scale + 1, "0")
    rendered = (digits[:-scale] + "." + digits[-scale:]).rstrip("0").rstrip(".") if scale else digits
    return ("-" if integer < 0 else "") + rendered


def delta(left, right):
    left, right = numeric(left), numeric(right)
    return None if left is None or right is None else exact_decimal(left - right)


def aggregate(facts, request, metric, dimension="all", *, filters=None):
    return analyze(list(facts), AnalyticsQuery(metric=metric, dimension=dimension, filters=filters or request.filters))


def metadata(request):
    return ReviewMetadata(filters=request.filters, warnings=[
        "Historical associations only; classifications do not establish cause or predict future outcomes.",
        "Current Journal annotations and explicit assignments are reconstructed, not an assignment event history; exact assigned versions are preserved.",
        "UTC close-time inclusive periods; setup groups overlap and must not be summed.",
        "Existing Journal PnL/return units are retained without currency conversion.",
        "The segment is included in its cohort baseline; delta is not a causal effect or significance test.",
        "Market paths are not loaded in this batch. MFE/MAE, capture, Plan exit adherence and post-exit opportunity stay distinct and unavailable.",
        "plan.recorded_before_entry=false means no eligible verified pretrade Plan record, not proof that no real-world plan existed.",
        "Entry deviation uses nearest planned-entry boundary divided by actual-entry-to-planned-stop risk distance; means reuse Plan Lab aggregation.",
    ])


def availability_ok(evaluable, total, policy):
    return total > 0 and evaluable * 100 >= total * policy.minimum_availability_pct


def group_reasons(group, policy, prefix):
    reasons = []
    if numeric(group.value) is None:
        reasons.append(f"{prefix}_METRIC_UNAVAILABLE")
    if group.trade_sample < policy.minimum_trade_sample or group.evaluable_sample < policy.minimum_evaluable_sample:
        reasons.append(f"{prefix}_SMALL_SAMPLE")
    if not availability_ok(group.evaluable_sample, group.total_sample, policy):
        reasons.append(f"{prefix}_LOW_AVAILABILITY")
    return reasons


def detect_patterns(facts, request):
    validate_work_budget(facts, request)
    policy, candidates = ReviewPolicy(), []
    for metric in sorted(request.pattern_metrics):
        baseline = aggregate(facts, request, metric).groups[0]
        for dimension in sorted(request.pattern_dimensions):
            if dimension not in METRIC_REGISTRY[metric].supported_dimensions:
                continue
            evaluable_trades = {}
            if METRIC_REGISTRY[metric].sample_unit == "trade_rule":
                for fact in facts:
                    for rule in fact.rules:
                        if rule.status != RuleEvaluationStatus.NOT_EVALUABLE:
                            for identity in group_identities(fact, dimension, rule):
                                evaluable_trades.setdefault(identity.key, set()).add(fact.entry["id"])
            for observed in aggregate(facts, request, metric, dimension).groups:
                if len(candidates) >= MAX_CANDIDATES:
                    raise ValidationError("Review candidate limit exceeded; narrow filters or dimensions")
                reasons = group_reasons(observed, policy, "SEGMENT") + group_reasons(baseline, policy, "BASELINE")
                rule_metric = METRIC_REGISTRY[metric].sample_unit == "trade_rule"
                sample = len(evaluable_trades.get(observed.identity.key, ())) if rule_metric else observed.evaluable_sample
                baseline_sample = evaluable_rule_trades(facts) if rule_metric else baseline.evaluable_sample
                if sample < policy.minimum_trade_sample:
                    reasons.append("SEGMENT_INSUFFICIENT_EVALUABLE_TRADES")
                if baseline_sample < policy.minimum_trade_sample:
                    reasons.append("BASELINE_INSUFFICIENT_EVALUABLE_TRADES")
                if not availability_ok(sample, observed.trade_sample, policy):
                    reasons.append("SEGMENT_LOW_TRADE_AVAILABILITY")
                if not availability_ok(baseline_sample, baseline.trade_sample, policy):
                    reasons.append("BASELINE_LOW_TRADE_AVAILABILITY")
                if observed.identity.state in {"UNASSIGNED", "UNRECORDED", "INVALID", "NO_RULES"}:
                    reasons.append("SEGMENT_IDENTITY_UNAVAILABLE")
                signed = delta(observed.value, baseline.value)
                candidates.append(PatternCandidate(
                    metric=metric, dimension=dimension, observed=observed, baseline=baseline,
                    signed_delta=signed, absolute_delta=exact_decimal(abs(numeric(signed))) if signed is not None else None,
                    status="INSUFFICIENT_EVIDENCE" if reasons else "ELIGIBLE", reasons=reasons,
                    evaluable_trade_sample=sample, baseline_evaluable_trade_sample=baseline_sample,
                ))
    # Magnitudes are ranked only within a metric, never across R vs percentage.
    candidates.sort(key=lambda item: (item.metric, item.status != "ELIGIBLE",
                                     -(numeric(item.absolute_delta) or Fraction(0)), -item.observed.trade_sample,
                                     item.dimension, item.observed.identity.key))
    eligible = sum(item.status == "ELIGIBLE" for item in candidates)
    return PatternData(metadata=metadata(request), candidates=candidates, eligible_count=eligible,
                       insufficient_count=len(candidates) - eligible, state="AVAILABLE" if facts else "EMPTY_PERIOD")


def observation_evidence(facts, metric):
    observations = [fact.observations[metric] for fact in facts]
    available = [item for item in observations if item.available]
    reasons = dict(sorted(Counter(item.reason_code.value for item in observations if not item.available).items()))
    definition = OBSERVATION_REGISTRY[metric]
    is_numeric = definition.value_type == "numeric"
    mean = finite_float(_mean(item.value for item in available)) if is_numeric else None
    extra = {}
    if metric == "plan.recorded_before_entry" or metric in {"journal.fomo", "journal.revenge_trade"}:
        extra = {"true_sample": sum(item.value is True for item in available),
                 "false_sample": sum(item.value is False for item in available)}
    if metric == "execution.entry_deviation_r":
        limit = numeric(ReviewPolicy().entry_deviation_limit_r)
        within = sum(numeric(item.value) <= limit for item in available)
        extra = {"within_entry_limit_sample": within, "outside_entry_limit_sample": len(available) - within}
    missing_reason = None if available else ("EMPTY_SAMPLE" if not facts else "NO_EVALUABLE_SAMPLE")
    if is_numeric and available and mean is None:
        missing_reason = "NUMERIC_OVERFLOW"
    return ObservationEvidence(metric=metric, unit=definition.unit, aggregation="MEAN" if is_numeric else "BOOLEAN_COUNTS",
                               value=mean, total_sample=len(facts), evaluable_sample=len(available),
                               unavailable_sample=len(facts) - len(available), unavailable_reasons=reasons,
                               unavailable_reason=missing_reason, **extra)


def _rule_metric_id(fact, result):
    """Recover an evaluator identity even when PR2B result is NOT_EVALUABLE."""
    if result.condition is not None:
        return result.condition.metric_id
    assignment = fact.assignment or {}
    category_key = f"{result.category.value.lower()}_rules"
    for rule in assignment.get("version_rules", {}).get(category_key, ()):
        if rule.get("id") == result.rule_id:
            evaluator = rule.get("evaluation")
            return evaluator.get("metric_id") if isinstance(evaluator, dict) else None
    return None


def diagnosis_rule_evidence(facts):
    eligible, excluded = [], Counter()
    total = 0
    for fact in facts:
        for result in fact.rules:
            total += 1
            role = DIAGNOSIS_RULE_METRIC_ROLES.get(_rule_metric_id(fact, result), "NOT_DIAGNOSTIC")
            if role == "EXECUTION_PROCESS":
                eligible.append(result)
            else:
                excluded[role] += 1
    summary = summarize_results(eligible)
    return DiagnosisRuleEvidence(
        total_rule_count=total,
        execution_eligible_rule_count=len(eligible),
        execution_evaluable_rule_count=summary.evaluable_rules,
        excluded_rule_count=total - len(eligible),
        excluded_rule_counts_by_role=dict(sorted(excluded.items())),
        summary=summary,
    )


def evaluable_execution_rule_trades(facts):
    return sum(any(
        DIAGNOSIS_RULE_METRIC_ROLES.get(_rule_metric_id(fact, rule), "NOT_DIAGNOSTIC") == "EXECUTION_PROCESS"
        and rule.status != RuleEvaluationStatus.NOT_EVALUABLE
        for rule in fact.rules
    ) for fact in facts)


def evaluable_rule_trades(facts):
    """General PR2B evidence count; deliberately includes every rule metric."""
    return sum(any(rule.status != RuleEvaluationStatus.NOT_EVALUABLE for rule in fact.rules) for fact in facts)


def diagnose(facts, request):
    validate_work_budget(facts, request)
    groups, diagnoses, policy = {}, [], ReviewPolicy()
    for fact in facts:
        identity = group_identities(fact, "strategy_version")[0]
        groups.setdefault(identity.key, (identity, []))[1].append(fact)
    for _, (identity, cohort) in sorted(groups.items()):
        strategy = [aggregate(cohort, request, metric) for metric in ("average_r", "net_return_pct", "total_realized_r", "profit_factor", "win_rate_pct", "loss_rate_pct")]
        entry = observation_evidence(cohort, "execution.entry_deviation_r")
        rule_evidence = diagnosis_rule_evidence(cohort)
        rule_trade_sample = evaluable_execution_rule_trades(cohort)
        reasons = []
        if identity.state == "UNASSIGNED":
            reasons.append("NO_ASSIGNED_STRATEGY_VERSION")
        for data in strategy[:2]:
            reasons.extend(f"{data.metric.id.upper()}_{reason}" for reason in group_reasons(data.groups[0], policy, "STRATEGY"))
        signals = [numeric(data.groups[0].value) for data in strategy[:2]]
        strategy_signal = None
        if all(value is not None for value in signals):
            boundary = numeric(policy.strategy_positive_boundary)
            if all(value > boundary for value in signals):
                strategy_signal = "POSITIVE"
            elif all(value < boundary for value in signals):
                strategy_signal = "WEAK"
            else:
                reasons.append("STRATEGY_SIGNALS_CONFLICT_OR_NEUTRAL")
        adherence = rule_evidence.summary
        if not rule_evidence.execution_eligible_rule_count:
            if not rule_evidence.total_rule_count:
                reasons.append("NO_RULES")
            reasons.append("NO_EXECUTION_ELIGIBLE_RULES")
        elif not adherence.evaluable_rules:
            reasons.append("NO_EVALUABLE_RULES")
            reasons.append("NO_EVALUABLE_EXECUTION_RULES")
        if rule_trade_sample < policy.minimum_trade_sample:
            reasons.append("INSUFFICIENT_RULE_TRADE_SAMPLE")
        if not availability_ok(rule_trade_sample, len(cohort), policy) or not availability_ok(adherence.evaluable_rules, adherence.total_rules, policy):
            reasons.append("LOW_RULE_COVERAGE")
        if entry.evaluable_sample < policy.minimum_trade_sample:
            reasons.append("INSUFFICIENT_PLAN_ENTRY_SAMPLE")
        if not availability_ok(entry.evaluable_sample, entry.total_sample, policy):
            reasons.append("LOW_PLAN_ENTRY_COVERAGE")
        execution_signal = None
        if adherence.adherence_pct is not None and entry.evaluable_sample:
            rule_healthy = numeric(adherence.adherence_pct) >= numeric(policy.healthy_rule_adherence_pct)
            entry_healthy = entry.within_entry_limit_sample * 100 >= entry.evaluable_sample * policy.healthy_entry_alignment_pct
            if rule_healthy == entry_healthy:
                execution_signal = "HEALTHY" if rule_healthy else "DRAG"
            else:
                reasons.append("EXECUTION_SIGNALS_CONFLICT")
        classification = "INCONCLUSIVE"
        if not reasons and strategy_signal and execution_signal:
            classification = f"STRATEGY_{strategy_signal}_EXECUTION_{execution_signal}"
            reasons = [f"OBSERVED_STRATEGY_{strategy_signal}", f"OBSERVED_EXECUTION_{execution_signal}"]
        diagnoses.append(Diagnosis(identity=identity, classification=classification, reasons=reasons,
                                   strategy_evidence=strategy, execution_rule_evidence=rule_evidence, entry_deviation=entry,
                                   evaluable_rule_trade_sample=rule_trade_sample))
    return DiagnosisData(metadata=metadata(request), diagnoses=diagnoses, state="AVAILABLE" if facts else "EMPTY_PERIOD")


def compare_periods(context, request, performance):
    if not request.compare_previous:
        return PeriodComparison(state="NOT_REQUESTED")
    filters, metrics = previous_filters(request), []
    for data in performance:
        current = data.groups[0]
        previous = aggregate(context.previous, request, data.metric.id, filters=filters).groups[0]
        signed = delta(current.value, previous.value)
        metrics.append(PeriodMetric(metric=data.metric.id, current=current, comparison=previous, signed_delta=signed,
                                    unavailable_reason="METRIC_UNAVAILABLE" if signed is None else None))
    return PeriodComparison(state="AVAILABLE" if context.current and context.previous else "INSUFFICIENT_EVIDENCE",
                             filters=filters, metrics=metrics)


def build_review(context, request):
    facts = context.current
    performance = [aggregate(facts, request, metric) for metric in PERFORMANCE_METRICS]
    # Market-dependent modules perform separate Journal loads and candle reads,
    # and some consult wall-clock time. Do not call them from a coherent review.
    # Explicit unavailability is not a zero, a failed exit, or opportunity cost.
    market = [ObservationEvidence(metric=metric, unit="percent" if metric != "plan_exit_adherence" else "score",
                                  total_sample=len(facts), evaluable_sample=0,
                                  unavailable_sample=len(facts), unavailable_reasons={"MARKET_PATH_NOT_IN_SNAPSHOT": len(facts)} if facts else {},
                                  unavailable_reason="MARKET_PATH_NOT_IN_SNAPSHOT")
              for metric in ("mfe_pct", "mae_pct", "mfe_capture_efficiency", "plan_exit_adherence", "post_exit_opportunity")]
    return TradingReview(
        metadata=metadata(request), state="AVAILABLE" if facts else "EMPTY_PERIOD", performance=performance,
        strategy=[aggregate(facts, request, metric, dimension) for dimension in ("strategy", "strategy_version")
                  for metric in ("trade_count", "average_r", "net_return_pct")],
        execution=ExecutionSection(rule_and_holding_metrics=[aggregate(facts, request, metric) for metric in EXECUTION_METRICS],
                                   observations=[observation_evidence(facts, metric) for metric in PLAN_METRICS], market_dependent=market),
        psychology=[aggregate(facts, request, metric, dimension) for dimension in PSYCHOLOGY_FIELDS
                    for metric in ("trade_count", "average_r", "net_return_pct")],
        patterns=detect_patterns(facts, request), strategy_execution=diagnose(facts, request),
        evidence_quality=EvidenceQuality(
            selected_trade_count=len(facts), unassigned_trade_count=sum(fact.assignment is None for fact in facts),
            assigned_without_rules_count=sum(fact.assignment is not None and not fact.rules for fact in facts),
            evaluable_rule_trade_count=evaluable_rule_trades(facts), excluded_close_time_count_all_stored_positions=context.excluded_close_count,
            observations=[observation_evidence(facts, metric) for metric in (*PLAN_METRICS, *(f"journal.{field}" for field in PSYCHOLOGY_FIELDS))],
        ), period_comparison=compare_periods(context, request, performance),
    )
