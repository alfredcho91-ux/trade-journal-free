"""Read-only metadata and batch orchestration for accepted analytics contracts."""

from dataclasses import asdict
from pathlib import Path

from backend.modules.analytics import repository
from backend.modules.analytics.core import TradeFacts, analyze
from backend.modules.analytics.registry import DIMENSION_REGISTRY, MAX_RULE_RESULTS, METRIC_REGISTRY, REGISTRY_VERSION
from backend.modules.analytics.schemas import (
    AnalyticsEnvelope, AnalyticsFilters, AnalyticsMetadataEnvelope, AnalyticsQuery,
    FILTER_APPLICABLE_SAMPLE_UNITS, FILTER_TIME_ORDER, UNASSIGNED_FORBIDDEN_FILTERS,
)
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.service import _evaluate_document
from backend.utils.error_handler import ValidationError


def _resolve_schema(schema: dict, root: dict) -> dict:
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].removeprefix("#/").split("/"):
            node = node[part]
        return node
    return schema


def _filter_metadata() -> list[dict]:
    """Project public filter metadata from the validating Pydantic contract."""
    root = AnalyticsFilters.model_json_schema(mode="validation")
    required = set(root.get("required", []))
    result = []
    for identifier in AnalyticsFilters.model_fields:
        public = root["properties"][identifier]
        choices = public.get("anyOf", [public])
        nullable = any(choice.get("type") == "null" for choice in choices)
        contract = next(choice for choice in choices if choice.get("type") != "null")
        input_mode = "list" if contract.get("type") == "array" else "scalar"
        value_contract = _resolve_schema(contract.get("items", contract), root)
        result.append({
            "id": identifier,
            "label": public["title"],
            "description": public["description"],
            "value_type": public["value_type"],
            "input_mode": input_mode,
            "required": identifier in required,
            "nullable": nullable,
            "minimum": value_contract.get("minimum"),
            "maximum": value_contract.get("maximum"),
            "exclusive_minimum": value_contract.get("exclusiveMinimum"),
            "min_items": contract.get("minItems"),
            "max_items": contract.get("maxItems"),
            "min_length": value_contract.get("minLength"),
            "max_length": value_contract.get("maxLength"),
            "enum_values": value_contract.get("enum", []),
            "option_source": public["option_source"],
            "null_semantics": public["null_semantics"],
            "applicable_sample_units": FILTER_APPLICABLE_SAMPLE_UNITS[identifier],
        })
    return result


def get_analytics_metadata_service() -> AnalyticsMetadataEnvelope:
    """Return deterministic, DB-independent discovery metadata."""
    return AnalyticsMetadataEnvelope(data={
        "registry_version": REGISTRY_VERSION,
        "metrics": [asdict(item) for item in METRIC_REGISTRY.values()],
        "dimensions": [asdict(item) for item in DIMENSION_REGISTRY.values()],
        "filters": _filter_metadata(),
        "filter_constraints": [
            {
                "id": "close_time_order",
                "kind": "ORDER",
                "fields": list(FILTER_TIME_ORDER),
                "description": "start_time must be less than or equal to end_time.",
            },
            {
                "id": "unassigned_excludes_strategy_ids",
                "kind": "FORBIDS_WHEN",
                "fields": ["assignment", *UNASSIGNED_FORBIDDEN_FILTERS],
                "value": "UNASSIGNED",
                "description": "UNASSIGNED cannot be combined with Strategy or StrategyVersion IDs.",
            },
        ],
    })


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
