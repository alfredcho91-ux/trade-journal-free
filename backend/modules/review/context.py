"""One read transaction, one extraction/evaluation per trade, no derived cache."""

from dataclasses import dataclass

from backend.modules.analytics import repository
from backend.modules.analytics.core import TradeFacts, close_timestamp, group_identities
from backend.modules.analytics.registry import MAX_RULE_RESULTS
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.review.schemas import MAX_MEMBERSHIPS, MAX_REVIEW_TRADES, MAX_VERSION_GROUPS, ReviewRequest
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.service import _evaluate_document
from backend.utils.error_handler import ValidationError


@dataclass(frozen=True)
class ReviewContext:
    current: tuple[TradeFacts, ...]
    previous: tuple[TradeFacts, ...]
    excluded_close_count: int = 0


def previous_filters(request):
    return request.filters.model_copy(update={
        "start_time": request.filters.start_time - request.duration_ms,
        "end_time": request.filters.start_time - 1,
    })


def load_context(request: ReviewRequest, *, db_path=None):
    filters = request.filters
    if request.compare_previous:
        filters = filters.model_copy(update={"start_time": previous_filters(request).start_time})
    snapshot = repository.load_snapshot(AnalyticsQuery(metric="trade_count", filters=filters), db_path=db_path,
                                        include_plans=True, include_unassigned_plans=True)
    if len(snapshot.entries) > MAX_REVIEW_TRADES:
        raise ValidationError("Review trade limit exceeded including comparison period; narrow filters")
    current, previous, rule_count = [], [], 0
    for entry in sorted(snapshot.entries, key=lambda row: (close_timestamp(row), row["id"])):
        assigned = snapshot.assignments.get(entry["id"])
        observations = extract_metric_observations(entry, linked_plan=snapshot.linked_plans.get(entry["id"]))
        rules = tuple(_evaluate_document(assigned["version_rules"], observations)) if assigned else ()
        rule_count += len(rules)
        if rule_count > MAX_RULE_RESULTS:
            raise ValidationError("Review rule result limit exceeded; narrow filters")
        target = current if close_timestamp(entry) >= request.filters.start_time else previous
        target.append(TradeFacts(entry, assigned, observations, rules))
    validate_work_budget(current, request)
    return ReviewContext(tuple(current), tuple(previous), snapshot.excluded_unavailable_close_count)


def validate_work_budget(facts, request):
    """Bound one-dimensional memberships before any repeated aggregations."""
    dimensions = sorted(set(request.pattern_dimensions) | {
        "strategy", "strategy_version", "confidence_score", "focus_score", "fomo", "revenge_trade",
    })
    versions, memberships = set(), 0
    for fact in facts:
        versions.add(fact.assignment["strategy_version_id"] if fact.assignment else None)
        if len(versions) > MAX_VERSION_GROUPS:
            raise ValidationError("Review version group limit exceeded; narrow filters")
        for dimension in dimensions:
            # Rule analytics can contribute each rule to any dimension, while
            # trade analytics contribute only once (overlapping setup tags aside).
            results = (fact.rules or (None,)) if dimension in {"rule", "rule_status"} else (None,)
            for result in results:
                count = len(group_identities(fact, dimension, result))
                memberships += count * (max(1, len(fact.rules)) if result is None and dimension not in {"rule", "rule_status"} else 1)
                if memberships > MAX_MEMBERSHIPS:
                    raise ValidationError("Review dimension membership limit exceeded; narrow filters")
