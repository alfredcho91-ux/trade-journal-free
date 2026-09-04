"""Read-only orchestration for one Journal StrategyVersion evaluation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from backend.modules.rule_engine import repository
from backend.modules.rule_engine.evaluator import evaluate_rule
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.models import RuleCategory, RuleEvaluationResult
from backend.modules.rule_engine.summary import summarize_by_category
from backend.modules.strategies.schemas import StrategyRuleDocument
from backend.utils.error_handler import APIError, NotFoundError

RULE_DOCUMENT_ADAPTER = TypeAdapter(StrategyRuleDocument)


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


__all__ = ["get_strategy_evaluation_service"]
