"""Pure selection, grouping and aggregation over already-loaded historical facts."""

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any, Mapping

from backend.modules.analytics.registry import DIMENSION_REGISTRY, MAX_GROUPS, METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsData, AnalyticsGroup, AnalyticsQuery, GroupIdentity
from backend.modules.journal.performance import _net_return_pct, summarize_performance
from backend.modules.journal.trade_selection import finite_float, timestamp_ms
from backend.modules.rule_engine.models import Observation, RuleEvaluationResult
from backend.modules.rule_engine.summary import summarize_results
from backend.utils.error_handler import ValidationError

PSYCHOLOGY_FIELDS = ("confidence_score", "focus_score", "fomo", "revenge_trade")


@dataclass(frozen=True)
class TradeFacts:
    entry: Mapping[str, Any]
    assignment: Mapping[str, Any] | None
    observations: Mapping[str, Observation]
    rules: tuple[RuleEvaluationResult, ...] = ()


def close_timestamp(entry):
    """Reuse Journal's naive-as-UTC parsing, treating corrupt dates as unavailable."""
    try:
        return timestamp_ms(entry.get("datetime"))
    except (ValueError, OverflowError, TypeError):
        return None


def psychology_state(entry, field):
    value = entry.get(field)
    if value is None:
        return "UNRECORDED"
    if field in {"fomo", "revenge_trade"}:
        return ("TRUE" if value else "FALSE") if type(value) is bool else "INVALID"
    return str(value) if type(value) is int and 1 <= value <= 5 else "INVALID"


def setup_values(entry):
    tags = entry.get("setup_tags")
    if not isinstance(tags, list):
        return ()
    return tuple(sorted({tag.strip() for tag in tags if isinstance(tag, str) and tag.strip()}))


def matches_trade(entry, assignment, filters):
    if not str(entry.get("source") or "").endswith("_position"):
        return False
    close = close_timestamp(entry)
    if close is None or not filters.start_time <= close <= filters.end_time:
        return False
    if filters.assignment == "ASSIGNED" and assignment is None:
        return False
    if filters.assignment == "UNASSIGNED" and assignment is not None:
        return False
    for field, allowed in (("strategy_id", filters.strategy_ids), ("strategy_version_id", filters.strategy_version_ids)):
        if allowed is not None and (assignment is None or assignment[field] not in allowed):
            return False
    for field, allowed in (("symbol", filters.symbols), ("direction", filters.directions)):
        if allowed is not None and entry.get(field) not in allowed:
            return False
    if filters.setups is not None and not set(setup_values(entry)).intersection(filters.setups):
        return False
    return all(getattr(filters, field) is None or psychology_state(entry, field) in getattr(filters, field)
               for field in PSYCHOLOGY_FIELDS)


def _state(state):
    return GroupIdentity(key=f"state:{state}", label=state, state=state)


def group_identities(fact, dimension, result=None):
    entry, assignment = fact.entry, fact.assignment
    if dimension == "all":
        return [GroupIdentity(key="all", label="All selected trades", state="ALL")]
    if dimension in {"strategy", "strategy_version"}:
        if assignment is None:
            return [_state("UNASSIGNED")]
        strategy_id = assignment["strategy_id"]
        if dimension == "strategy":
            return [GroupIdentity(key=f"strategy:{strategy_id}", label=assignment["strategy_name"], strategy_id=strategy_id)]
        version_id = assignment["strategy_version_id"]
        return [GroupIdentity(key=f"strategy_version:{version_id}",
                              label=f"{assignment['strategy_name']} / {assignment['version_label']}",
                              strategy_id=strategy_id, strategy_version_id=version_id)]
    if dimension in {"rule", "rule_status"}:
        if result is None:
            return [_state("UNASSIGNED" if assignment is None else "NO_RULES")]
        if dimension == "rule_status":
            return [GroupIdentity(key=f"status:{result.status.value}", label=result.status.value)]
        version_id = assignment["strategy_version_id"]
        return [GroupIdentity(key=f"rule:{version_id}:{result.category.value}:{result.rule_id}", label=result.text,
                              strategy_id=assignment["strategy_id"], strategy_version_id=version_id,
                              rule_id=result.rule_id, rule_category=result.category.value)]
    if dimension == "setup":
        tags = setup_values(entry)
        return [GroupIdentity(key=f"value:{tag}", label=tag) for tag in tags] if tags else [_state("UNRECORDED")]
    if dimension in PSYCHOLOGY_FIELDS:
        value = psychology_state(entry, dimension)
        return [_state(value)] if value in {"UNRECORDED", "INVALID"} else [GroupIdentity(key=f"value:{value}", label=value)]
    if dimension in {"symbol", "direction"}:
        value = entry.get(dimension)
        if value is None or value == "":
            return [_state("UNRECORDED")]
        if not isinstance(value, str) or (dimension == "direction" and value not in {"Long", "Short"}):
            return [_state("INVALID")]
        return [GroupIdentity(key=f"value:{value}", label=value)]
    close = datetime.fromtimestamp(close_timestamp(entry) / 1000, tz=timezone.utc)
    iso_year, iso_week, _ = close.isocalendar()
    values = {
        "day": close.date().isoformat(), "week": f"{iso_year:04d}-W{iso_week:02d}",
        "month": f"{close.year:04d}-{close.month:02d}", "weekday": str(close.weekday()),
        "hour": f"{close.hour:02d}",
    }
    return [GroupIdentity(key=f"value:{values[dimension]}", label=values[dimension])]


def _observed_values(facts, metric):
    values, reasons = [], Counter()
    for fact in facts:
        observation = fact.observations[metric]
        value = finite_float(observation.value) if observation.available else None
        if value is not None:
            values.append(value)
        else:
            reasons[observation.reason_code.value if observation.reason_code else "NONFINITE_VALUE"] += 1
    return values, dict(reasons)


def _trade_aggregate(facts, metric):
    entries = [dict(fact.entry) for fact in facts]
    total = len(entries)
    if metric == "trade_count":
        return total, total, {}, None, False
    if metric in {"total_realized_r", "average_r", "average_holding_minutes"}:
        observation_id = "execution.holding_minutes" if metric == "average_holding_minutes" else "execution.realized_r"
        values, reasons = _observed_values(facts, observation_id)
        value = sum(values) if values else None
        if values and metric != "total_realized_r":
            value /= len(values)
        return value, len(values), reasons, None, False
    if metric == "average_return_pct":
        values = [value for entry in entries if (value := finite_float(_net_return_pct(entry))) is not None]
        return (sum(values) / len(values) if values else None), len(values), {"MISSING_NET_RETURN": total - len(values)}, None, False
    stats = summarize_performance(entries)
    sample = stats["return_sample_count"] if metric == "net_return_pct" else stats["evaluated_trade_count"]
    if metric == "loss_rate_pct":
        value = stats["losses"] / sample * 100 if sample else None
    else:
        value = stats[metric]
    reason = "NO_LOSSES" if metric == "profit_factor" and sample and stats["gross_loss"] == 0 else None
    missing_reason = "MISSING_NET_RETURN" if metric == "net_return_pct" else "MISSING_PNL"
    return value, sample, {missing_reason: total - sample}, reason, stats["profit_factor_infinite"] if metric == "profit_factor" else False


def aggregate_group(identity, facts, rules, metric):
    rule_metric = METRIC_REGISTRY[metric].sample_unit == "trade_rule"
    summary = summarize_results(rules) if rule_metric else None
    reason, infinite = None, False
    if summary is not None:
        total, evaluable = summary.total_rules, summary.evaluable_rules
        values = {"followed_count": summary.followed_rules, "violated_count": summary.violated_rules,
                  "not_evaluable_count": summary.not_evaluable_rules, "adherence_pct": summary.adherence_pct,
                  "coverage_pct": summary.coverage_pct}
        value = values[metric]
        reasons = dict(Counter(result.reason_code.value for result in rules if result.reason_code is not None))
    else:
        total = len(facts)
        value, evaluable, reasons, reason, infinite = _trade_aggregate(facts, metric)
    if isinstance(value, float) and not math.isfinite(value):
        value, reason = None, "NUMERIC_OVERFLOW"
    if value is None and reason is None:
        reason = "EMPTY_SAMPLE" if total == 0 else "NO_EVALUABLE_SAMPLE"
    return AnalyticsGroup(
        identity=identity, value=value, total_sample=total, evaluable_sample=evaluable,
        unavailable_sample=total - evaluable, trade_sample=len(facts),
        unassigned_trade_count=sum(fact.assignment is None for fact in facts),
        assigned_without_rules_count=sum(fact.assignment is not None and not fact.rules for fact in facts) if rule_metric else 0,
        unavailable_reason=reason, unavailable_reasons={key: count for key, count in reasons.items() if count},
        profit_factor_infinite=infinite, rule_summary=summary,
    )


def analyze(facts: list[TradeFacts], query: AnalyticsQuery, *, excluded_unavailable_close_count=0) -> AnalyticsData:
    """Stable ordering; no input mutation. Rule filters select trade-rule results, not trades."""
    selected = sorted((fact for fact in facts if matches_trade(fact.entry, fact.assignment, query.filters)),
                      key=lambda fact: (close_timestamp(fact.entry), int(fact.entry["id"])))
    buckets = {}
    rule_metric = METRIC_REGISTRY[query.metric].sample_unit == "trade_rule"
    if query.dimension == "all":
        buckets["all"] = (GroupIdentity(key="all", label="All selected trades", state="ALL"), {}, [])
    for fact in selected:
        results = (fact.rules or (None,)) if rule_metric else (None,)
        for result in results:
            if query.filters.rule_statuses and (result is None or result.status not in query.filters.rule_statuses):
                continue
            for identity in group_identities(fact, query.dimension, result):
                if identity.key not in buckets:
                    if len(buckets) >= MAX_GROUPS:
                        raise ValidationError("Analytics group limit exceeded; narrow filters")
                    buckets[identity.key] = (identity, {}, [])
                _, trades, rules = buckets[identity.key]
                trades[int(fact.entry["id"])] = fact
                if rule_metric and result is not None:
                    rules.append(result)
    groups = [aggregate_group(identity, list(trades.values()), rules, query.metric)
              for _, (identity, trades, rules) in sorted(buckets.items())]
    metric = METRIC_REGISTRY[query.metric]
    dimension = DIMENSION_REGISTRY[query.dimension]
    return AnalyticsData(
        metric={
            "id": metric.id, "label": metric.label, "unit": metric.unit,
            "sample_unit": metric.sample_unit, "aggregation": metric.aggregation,
            "availability": metric.availability, "supported_dimensions": metric.supported_dimensions,
        },
        dimension={
            "id": dimension.id, "label": dimension.label, "semantics": dimension.semantics,
            "multi_membership": dimension.multi_membership,
        },
        filters=query.filters, groups=groups, selected_trade_count=len(selected),
        excluded_unavailable_close_count=excluded_unavailable_close_count,
        warnings=[
            "Descriptive historical association; does not establish causation or predict future performance.",
            "Current Journal annotations and current explicit assignments are reconstructed; past assignment edits are not an event history.",
            "UTC close-time buckets; naive Journal timestamps mean UTC. Session buckets are not supported.",
            "PnL and invested amounts retain existing Journal units; no currency conversion is performed.",
            "Rule status filters apply to individual rule results; selected_trade_count is the cohort before this rule filter.",
            "excluded_unavailable_close_count covers all stored Journal positions with missing or invalid close time; they cannot be assigned to a requested date range.",
        ] + (["Setup groups overlap for trades with multiple tags; do not sum group totals."] if query.dimension == "setup" else []),
    )
