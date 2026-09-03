"""Pydantic contracts for allowlisted Strategy rule evaluators."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from backend.modules.rule_engine.registry import RuleOperator, validate_evaluator_definition


class RuleEvaluator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric_id: str
    operator: RuleOperator
    expected: Any

    @model_validator(mode="after")
    def validate_against_registry(self):
        validate_evaluator_definition(self.metric_id, self.operator, self.expected)
        return self


__all__ = ["RuleEvaluator"]
