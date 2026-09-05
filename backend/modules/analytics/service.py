"""Read-only batch orchestration; reuse the accepted PR2B evaluator and extractors."""

from pathlib import Path

from backend.modules.analytics import repository
from backend.modules.analytics.core import TradeFacts, analyze
from backend.modules.analytics.registry import MAX_RULE_RESULTS, METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsEnvelope, AnalyticsQuery
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.service import _evaluate_document
from backend.utils.error_handler import ValidationError


def query_analytics(query: AnalyticsQuery, *, db_path: Path | None = None) -> AnalyticsEnvelope:
    rule_metric = METRIC_REGISTRY[query.metric].sample_unit == "trade_rule"
    snapshot = repository.load_snapshot(query, db_path=db_path, include_plans=rule_metric)
    facts = []
    result_count = 0
    for entry in snapshot.entries:
        assignment = snapshot.assignments.get(entry["id"])
        needs_observations = rule_metric or query.metric in {"total_realized_r", "average_r", "average_holding_minutes"}
        observations = extract_metric_observations(entry, linked_plan=snapshot.linked_plans.get(entry["id"])) if needs_observations else {}
        results = _evaluate_document(assignment["version_rules"], observations) if rule_metric and assignment else []
        result_count += len(results)
        if result_count > MAX_RULE_RESULTS:
            raise ValidationError("Analytics rule-result limit exceeded; narrow filters")
        facts.append(TradeFacts(entry, assignment, observations, tuple(results)))
    return AnalyticsEnvelope(data=analyze(facts, query, excluded_unavailable_close_count=snapshot.excluded_unavailable_close_count))
