"""API contracts for current reconstructed per-trade rule evaluation."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict

from backend.modules.rule_engine.models import (
    CategoryEvaluationSummaries,
    RuleEvaluationResult,
)


class EvaluationStrategyIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    name: str
    archived_at: Optional[str]


class EvaluationStrategyVersionIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    strategy_id: int
    sequence: int
    version_label: str
    description: Optional[str]
    is_active: bool
    retired_at: Optional[str]
    created_at: str
    assigned_at: str
    assignment_updated_at: str


class JournalStrategyEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    journal_entry_id: int
    evaluation_basis: Literal["CURRENT_RECONSTRUCTED"]
    strategy: EvaluationStrategyIdentity
    strategy_version: EvaluationStrategyVersionIdentity
    summary: CategoryEvaluationSummaries
    rules: List[RuleEvaluationResult]


class JournalStrategyEvaluationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: Optional[JournalStrategyEvaluation]


__all__ = ["JournalStrategyEvaluationEnvelope"]
