"""Bounded deterministic explanation templates for Rule Engine facts."""

from __future__ import annotations

from typing import Any

from backend.modules.rule_engine.models import (
    NotEvaluableReason,
    RuleEvaluationStatus,
    RuleExplanation,
)
from backend.modules.rule_engine.registry import MetricDefinition, RuleOperator


_NOT_EVALUABLE_MESSAGES = {
    NotEvaluableReason.NO_EVALUATOR: (
        "This rule is descriptive and is not automatically evaluable."
    ),
    NotEvaluableReason.MISSING_METRIC: "The required recorded value is unavailable.",
    NotEvaluableReason.MISSING_PLAN: "A required plan record is unavailable.",
    NotEvaluableReason.PLAN_NOT_EFFECTIVE_AT_ENTRY: (
        "No plan effective at entry is available for this rule."
    ),
    NotEvaluableReason.INVALID_PLAN: "The relevant plan record is invalid.",
    NotEvaluableReason.TRADE_NOT_CLOSED: (
        "This rule requires a closed trade observation."
    ),
    NotEvaluableReason.LEGACY_DATA_UNAVAILABLE: (
        "The required historical value was not recorded."
    ),
    NotEvaluableReason.UNSUPPORTED_SOURCE: (
        "The observation source is not supported for this rule."
    ),
    NotEvaluableReason.MARKET_DATA_UNAVAILABLE: (
        "The required market observation is unavailable."
    ),
    NotEvaluableReason.INCOMPLETE_MARKET_PATH: (
        "The recorded market path is incomplete."
    ),
    NotEvaluableReason.INVALID_HISTORICAL_DATA: (
        "The recorded value is invalid and was not evaluated."
    ),
    NotEvaluableReason.RULE_SCHEMA_UNSUPPORTED: (
        "The stored rule definition is unsupported and was not evaluated."
    ),
}


def not_evaluable_explanation(reason: NotEvaluableReason) -> RuleExplanation:
    return RuleExplanation(
        template_id=f"not_evaluable.{reason.value.lower()}",
        message=_NOT_EVALUABLE_MESSAGES[reason],
    )


def _render(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ", ".join(_render(item) for item in value)
    return str(value)


def evaluable_explanation(
    *,
    status: RuleEvaluationStatus,
    metric: MetricDefinition,
    operator: RuleOperator,
    expected: Any,
    observed: Any,
    tolerance_assisted: bool = False,
) -> RuleExplanation:
    outcome = "followed" if status == RuleEvaluationStatus.FOLLOWED else "violated"
    template_id = f"{metric.value_type}.{operator}.{outcome}"
    observed_text = _render(observed)
    expected_text = _render(expected)
    unit = f" {metric.unit}" if metric.unit not in {"boolean", "direction", "symbol"} else ""

    if metric.value_type == "boolean":
        message = (
            "Recorded value matched the rule requirement."
            if status == RuleEvaluationStatus.FOLLOWED
            else "Recorded value did not match the rule requirement."
        )
    elif operator == "lte":
        if tolerance_assisted:
            relation = "within the evaluation tolerance of the"
        else:
            relation = (
                "within the maximum of"
                if status == RuleEvaluationStatus.FOLLOWED
                else "above the maximum of"
            )
        message = (
            f"{metric.label} was {observed_text}{unit}, "
            f"{relation} {expected_text}{unit} maximum."
            if tolerance_assisted
            else f"{metric.label} was {observed_text}{unit}, "
            f"{relation} {expected_text}{unit}."
        )
    elif operator == "gte":
        if tolerance_assisted:
            relation = "within the evaluation tolerance of the"
        else:
            relation = (
                "meeting the minimum of"
                if status == RuleEvaluationStatus.FOLLOWED
                else "below the minimum of"
            )
        message = (
            f"{metric.label} was {observed_text}{unit}, "
            f"{relation} {expected_text}{unit} minimum."
            if tolerance_assisted
            else f"{metric.label} was {observed_text}{unit}, "
            f"{relation} {expected_text}{unit}."
        )
    elif operator == "in":
        relation = "was within" if status == RuleEvaluationStatus.FOLLOWED else "was outside"
        message = (
            f"{metric.label} was {observed_text}, {relation} the allowed values: "
            f"{expected_text}."
        )
    else:
        relation = "matched" if status == RuleEvaluationStatus.FOLLOWED else "did not match"
        message = (
            f"{metric.label} was {observed_text} and {relation} "
            f"the required value {expected_text}."
        )

    return RuleExplanation(template_id=template_id, message=message)


__all__ = ["evaluable_explanation", "not_evaluable_explanation"]
