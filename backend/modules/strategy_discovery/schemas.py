"""Strict request and persisted evidence contracts."""

from typing import Literal
from pydantic import Field, StrictInt, model_validator

from backend.modules.analytics.schemas import AnalyticsGroup, Contract
from backend.modules.strategies.schemas import StrategyCreate, StrategyRuleDocumentV2
from backend.modules.plan_lab.repository import normalize_symbol


class RunRequest(Contract):
    start_time: StrictInt = Field(ge=1, le=253402300799999)
    end_time: StrictInt = Field(ge=1, le=253402300799999)
    symbols: list[str] | None = Field(default=None, min_length=1, max_length=32)
    directions: list[Literal["Long", "Short"]] | None = Field(default=None, min_length=1, max_length=2)
    primary_metric: Literal["average_return_pct", "average_r"] = "average_return_pct"

    @model_validator(mode="after")
    def validate_scope(self):
        if self.end_time - self.start_time < 2:
            raise ValueError("Choose a period of at least three milliseconds")
        for values in (self.symbols, self.directions):
            if values is not None and (len(values) != len(set(values)) or any(
                not value.strip() or value != value.strip() or len(value) > 80 for value in values
            )):
                raise ValueError("Filters must be unique, trimmed and at most 80 characters")
        if self.symbols is not None:
            normalized = [normalize_symbol(value) for value in self.symbols]
            if any(not value for value in normalized) or len(set(normalized)) != len(normalized):
                raise ValueError("Symbols must be nonempty and unique after Rule Engine normalization")
            self.symbols = sorted(normalized)
        if self.directions is not None:
            self.directions = sorted(self.directions)
        return self


class Condition(Contract):
    field: Literal["symbol", "direction"]
    operator: Literal["eq", "in"] = "eq"
    value: str | list[str]


class Segment(Contract):
    sample: int
    metrics: dict[str, AnalyticsGroup]
    baseline: dict[str, AnalyticsGroup]
    primary_delta: str | None
    trade_ids: list[int]


class AdoptionRecord(Contract):
    strategy_id: int
    version_id: int
    rules_modified: bool
    evidence_applies_to_saved_rules: bool
    saved_rules_fingerprint: str
    created_at: str


class Candidate(Contract):
    id: int | None = None
    run_id: int | None = None
    rank: int
    name: str
    conditions: list[Condition]
    rules: StrategyRuleDocumentV2
    discovery: Segment
    validation: Segment
    validation_state: Literal["CONSISTENT", "WEAKENED", "INSUFFICIENT_EVIDENCE"]
    reasons: list[str]
    adoption: AdoptionRecord | None = None


class RunSummary(Contract):
    selected_trades: int
    discovery_trades: int
    validation_trades: int
    excluded: dict[str, int]
    split_time: int
    searched_conditions: int
    shortlisted_candidates: int
    candidate_count: int
    state: Literal["AVAILABLE", "NO_CANDIDATES", "INSUFFICIENT_EVIDENCE"]
    baseline_discovery: dict[str, AnalyticsGroup]
    baseline_validation: dict[str, AnalyticsGroup]


class RunRecord(Contract):
    id: int
    request: RunRequest
    engine_version: int
    policy_version: int
    input_fingerprint: str
    created_at: str
    summary: RunSummary


class RunDetail(RunRecord):
    candidates: list[Candidate]


class RunPage(Contract):
    items: list[RunRecord]
    offset: int
    has_more: bool


class AdoptionRequest(Contract):
    strategy: StrategyCreate


class EvidenceTrade(Contract):
    journal_id: int
    external_id: str | None
    symbol: str | None
    direction: str | None
    entry_datetime: str | None
    datetime: str | None
    average_return_pct: float | None
    realized_r: str | None
    segment: Literal["DISCOVERY", "VALIDATION"]


class EvidencePage(Contract):
    items: list[EvidenceTrade]
    offset: int
    has_more: bool


class RunEnvelope(Contract):
    success: Literal[True] = True
    data: RunDetail


class RunPageEnvelope(Contract):
    success: Literal[True] = True
    data: RunPage


class CandidateEnvelope(Contract):
    success: Literal[True] = True
    data: Candidate


class AdoptionEnvelope(Contract):
    success: Literal[True] = True
    data: AdoptionRecord


class EvidenceEnvelope(Contract):
    success: Literal[True] = True
    data: EvidencePage
