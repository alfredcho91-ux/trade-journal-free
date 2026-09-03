"""Pydantic contracts for Journal StrategyVersion assignments."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class StrategyAssignmentPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_version_id: int = Field(gt=0)


class StrategyAssignmentRecord(BaseModel):
    journal_entry_id: int
    strategy_version_id: int
    strategy_id: int
    strategy_name: str
    strategy_archived_at: Optional[str]
    version_sequence: int
    version_label: str
    version_description: Optional[str]
    version_is_active: bool
    version_retired_at: Optional[str]
    assigned_at: str
    updated_at: str


class StrategyAssignmentEnvelope(BaseModel):
    success: bool
    data: Optional[StrategyAssignmentRecord]
