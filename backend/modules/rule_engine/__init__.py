"""Versioned, allowlisted Strategy rule-definition primitives."""

from backend.modules.rule_engine.evaluator import evaluate_rule
from backend.modules.rule_engine.models import (
    CategoryEvaluationSummaries,
    EvaluationSummary,
    NotEvaluableReason,
    Observation,
    RuleCategory,
    RuleEvaluationResult,
    RuleEvaluationStatus,
    RuleEvaluator,
)
from backend.modules.rule_engine.registry import METRIC_REGISTRY, MetricDefinition
from backend.modules.rule_engine.summary import summarize_by_category, summarize_results

__all__ = [
    "CategoryEvaluationSummaries",
    "EvaluationSummary",
    "METRIC_REGISTRY",
    "MetricDefinition",
    "NotEvaluableReason",
    "Observation",
    "RuleCategory",
    "RuleEvaluationResult",
    "RuleEvaluationStatus",
    "RuleEvaluator",
    "evaluate_rule",
    "summarize_by_category",
    "summarize_results",
]
