"""Pure summary calculations for deterministic rule evaluation results."""

from __future__ import annotations

from decimal import Decimal, localcontext
from typing import Iterable, Sequence

from backend.modules.rule_engine.models import (
    CategoryEvaluationSummaries,
    EvaluationSummary,
    RuleCategory,
    RuleEvaluationResult,
    RuleEvaluationStatus,
)
from backend.modules.rule_engine.numeric import canonical_numeric


def _percentage(numerator: int, denominator: int) -> str:
    with localcontext() as context:
        context.prec = 28
        return canonical_numeric(Decimal(numerator) * Decimal(100) / Decimal(denominator))


def summarize_results(results: Iterable[RuleEvaluationResult]) -> EvaluationSummary:
    items = tuple(results)
    followed = sum(item.status == RuleEvaluationStatus.FOLLOWED for item in items)
    violated = sum(item.status == RuleEvaluationStatus.VIOLATED for item in items)
    not_evaluable = sum(
        item.status == RuleEvaluationStatus.NOT_EVALUABLE for item in items
    )
    evaluable = followed + violated
    total = len(items)
    return EvaluationSummary(
        total_rules=total,
        evaluable_rules=evaluable,
        followed_rules=followed,
        violated_rules=violated,
        not_evaluable_rules=not_evaluable,
        adherence_pct=_percentage(followed, evaluable) if evaluable else None,
        coverage_pct=_percentage(evaluable, total) if total else None,
    )


def summarize_by_category(
    results: Sequence[RuleEvaluationResult],
) -> CategoryEvaluationSummaries:
    return CategoryEvaluationSummaries(
        overall=summarize_results(results),
        entry=summarize_results(
            item for item in results if item.category == RuleCategory.ENTRY
        ),
        risk=summarize_results(
            item for item in results if item.category == RuleCategory.RISK
        ),
        exit=summarize_results(
            item for item in results if item.category == RuleCategory.EXIT
        ),
    )


__all__ = ["summarize_by_category", "summarize_results"]
