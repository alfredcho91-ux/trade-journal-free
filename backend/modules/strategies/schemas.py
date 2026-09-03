"""Pydantic contracts for the Strategy Playbook API."""

from __future__ import annotations

import re
import unicodedata
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RULE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")


class StrategyRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        normalized = value.strip()
        if not RULE_ID_PATTERN.fullmatch(normalized):
            raise ValueError(
                "Rule id must use letters, numbers, dot, underscore, colon, or hyphen"
            )
        return normalized

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = unicodedata.normalize("NFKC", value).strip()
        if not normalized:
            raise ValueError("Rule text must not be empty")
        return normalized


class StrategyRuleDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    entry_rules: List[StrategyRule] = Field(default_factory=list, max_length=100)
    risk_rules: List[StrategyRule] = Field(default_factory=list, max_length=100)
    exit_rules: List[StrategyRule] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def require_unique_rule_ids(self):
        ids = [
            rule.id
            for rules in (self.entry_rules, self.risk_rules, self.exit_rules)
            for rule in rules
        ]
        if len(ids) != len(set(ids)):
            raise ValueError("Rule ids must be unique within a version")
        return self


class StrategyVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_label: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=2000)
    rules: StrategyRuleDocument = Field(default_factory=StrategyRuleDocument)


class StrategyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=240)
    description: Optional[str] = Field(default=None, max_length=2000)
    initial_version: StrategyVersionCreate


class StrategyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=240)
    description: Optional[str] = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("At least one Strategy field is required")
        return self


class StrategyRecord(BaseModel):
    id: int
    name: str
    description: Optional[str]
    archived_at: Optional[str]
    active_version_id: Optional[int]
    created_at: str
    updated_at: str


class StrategyVersionRecord(BaseModel):
    id: int
    strategy_id: int
    sequence: int
    version_label: str
    description: Optional[str]
    rules: StrategyRuleDocument
    is_active: bool
    retired_at: Optional[str]
    created_at: str


class StrategyEnvelope(BaseModel):
    success: bool
    data: StrategyRecord


class StrategyListEnvelope(BaseModel):
    success: bool
    data: List[StrategyRecord]


class StrategyVersionEnvelope(BaseModel):
    success: bool
    data: StrategyVersionRecord


class StrategyVersionListEnvelope(BaseModel):
    success: bool
    data: List[StrategyVersionRecord]
