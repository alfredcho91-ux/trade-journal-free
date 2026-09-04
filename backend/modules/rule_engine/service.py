"""Read-only orchestration for one Journal StrategyVersion evaluation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from backend.modules.rule_engine import repository
from backend.modules.rule_engine.evaluator import evaluate_rule
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.models import RuleCategory, RuleEvaluationResult
from backend.modules.rule_engine.numeric import canonical_numeric
from backend.modules.rule_engine.registry import METRIC_REGISTRY, REGISTRY_VERSION
from backend.modules.rule_engine.schemas import (
    RuleEngineMetadata,
    RuleEngineMetadataEnvelope,
    RuleMetricConstraints,
    RuleMetricMetadata,
)
from backend.modules.rule_engine.summary import summarize_by_category
from backend.modules.strategies.schemas import StrategyRuleDocument
from backend.utils.error_handler import APIError, NotFoundError

RULE_DOCUMENT_ADAPTER = TypeAdapter(StrategyRuleDocument)
PUBLIC_VALUE_TYPES = {
    "boolean": "boolean",
    "numeric": "numeric",
    "enum": "enum",
    "normalized_string": "string",
}
OPERATOR_ORDER = ("eq", "lte", "gte", "in")


def get_rule_engine_metadata_service() -> RuleEngineMetadataEnvelope:
    """Project the immutable Registry into the public authoring contract."""
    metrics = []
    for metric in METRIC_REGISTRY.values():
        supports_in = "in" in metric.allowed_operators
        metrics.append(
            RuleMetricMetadata(
                metric_id=metric.id,
                label=metric.label,
                value_type=PUBLIC_VALUE_TYPES[metric.value_type],
                unit=metric.unit,
                lifecycle=metric.lifecycle,
                allowed_operators=[
                    operator
                    for operator in OPERATOR_ORDER
                    if operator in metric.allowed_operators
                ],
                constraints=RuleMetricConstraints(
                    enum_values=list(metric.enum_values),
                    minimum=(
                        canonical_numeric(metric.minimum)
                        if metric.minimum is not None
                        else None
                    ),
                    maximum=(
                        canonical_numeric(metric.maximum)
                        if metric.maximum is not None
                        else None
                    ),
                    max_in_values=metric.max_in_values if supports_in else None,
                    max_string_length=(
                        metric.max_string_length
                        if metric.value_type == "normalized_string"
                        else None
                    ),
                    string_format=metric.string_format,
                ),
            )
        )
    return RuleEngineMetadataEnvelope(
        success=True,
        data=RuleEngineMetadata(
            registry_version=REGISTRY_VERSION,
            metrics=metrics,
        ),
    )


def _evaluate_document(
    rules_payload: Dict[str, Any],
    observations: Dict[str, Any],
) -> List[RuleEvaluationResult]:
    try:
        document = RULE_DOCUMENT_ADAPTER.validate_python(rules_payload)
    except PydanticValidationError as exc:
        raise APIError("StrategyVersion rules are unavailable", status_code=500) from exc
    results: List[RuleEvaluationResult] = []
    groups = (
        (RuleCategory.ENTRY, document.entry_rules),
        (RuleCategory.RISK, document.risk_rules),
        (RuleCategory.EXIT, document.exit_rules),
    )
    for category, rules in groups:
        for rule in rules:
            evaluator = getattr(rule, "evaluation", None)
            observation = (
                observations.get(evaluator.metric_id)
                if evaluator is not None
                else None
            )
            results.append(
                evaluate_rule(
                    rule_id=rule.id,
                    category=category,
                    text=rule.text,
                    evaluator=evaluator,
                    observation=observation,
                    schema_version=document.schema_version,
                )
            )
    return results


def get_strategy_evaluation_service(
    journal_entry_id: int,
    *,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    snapshot = repository.load_evaluation_snapshot(
        journal_entry_id,
        db_path=db_path,
    )
    if snapshot.journal_entry is None:
        raise NotFoundError("Journal entry", str(journal_entry_id))
    if snapshot.assignment is None:
        return {"success": True, "data": None}

    assignment = snapshot.assignment
    observations = extract_metric_observations(
        snapshot.journal_entry,
        linked_plan=snapshot.linked_plan,
    )
    results = _evaluate_document(assignment["version_rules"], observations)
    summary = summarize_by_category(results)
    return {
        "success": True,
        "data": {
            "journal_entry_id": int(snapshot.journal_entry["id"]),
            "evaluation_basis": "CURRENT_RECONSTRUCTED",
            "strategy": {
                "id": assignment["strategy_id"],
                "name": assignment["strategy_name"],
                "archived_at": assignment["strategy_archived_at"],
            },
            "strategy_version": {
                "id": assignment["strategy_version_id"],
                "strategy_id": assignment["strategy_id"],
                "sequence": assignment["version_sequence"],
                "version_label": assignment["version_label"],
                "description": assignment["version_description"],
                "is_active": assignment["version_is_active"],
                "retired_at": assignment["version_retired_at"],
                "created_at": assignment["version_created_at"],
                "assigned_at": assignment["assigned_at"],
                "assignment_updated_at": assignment["assignment_updated_at"],
            },
            "summary": summary.model_dump(mode="json"),
            "rules": [result.model_dump(mode="json") for result in results],
        },
    }


__all__ = ["get_rule_engine_metadata_service", "get_strategy_evaluation_service"]
