"""Plan Lab API schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


PlanSide = Literal["Long", "Short"]
PlanStatus = Literal["active", "linked", "cancelled"]
PlanSource = Literal["RETROSPECTIVE", "VERIFIED_PRETRADE"]


class PlanRevisionFields(BaseModel):
    entry_price: Optional[float] = Field(default=None, gt=0)
    entry_min: Optional[float] = Field(default=None, gt=0)
    entry_max: Optional[float] = Field(default=None, gt=0)
    stop_loss: float = Field(gt=0)
    take_profit: float = Field(gt=0)
    # TP2 activates the official fixed split rule: TP1 50%, TP2 remaining 50%.
    take_profit_2: Optional[float] = Field(default=None, gt=0)
    setup: Optional[str] = Field(default=None, max_length=120)
    entry_note: Optional[str] = Field(default=None, max_length=1000)
    exit_note: Optional[str] = Field(default=None, max_length=1000)
    memo: Optional[str] = Field(default=None, max_length=2000)
    max_hold_hours: Optional[float] = Field(default=None, gt=0, le=24 * 30)
    client_created_at: Optional[str] = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_entry_shape(self):
        has_exact = self.entry_price is not None
        has_range = self.entry_min is not None or self.entry_max is not None
        if has_exact and has_range:
            raise ValueError("Use either entry_price or entry_min/entry_max")
        if has_range:
            if self.entry_min is None or self.entry_max is None:
                raise ValueError("Both entry_min and entry_max are required")
            if self.entry_min > self.entry_max:
                raise ValueError("entry_min must not exceed entry_max")
        return self


class PlanRevisionInput(PlanRevisionFields):
    @model_validator(mode="after")
    def require_planned_entry(self):
        if self.entry_price is None and self.entry_min is None and self.entry_max is None:
            raise ValueError("Plan entry is required")
        return self


class RetrospectivePlanRevisionInput(PlanRevisionFields):
    """A hindsight plan may omit the user's original entry intention.

    Execution-only analysis uses the linked trade's actual entry without storing
    it as a planned entry.
    """

    @model_validator(mode="after")
    def forbid_planned_entry(self):
        if self.entry_price is not None or self.entry_min is not None or self.entry_max is not None:
            raise ValueError("Retrospective plan entry must be empty")
        return self


class PlanCreate(BaseModel):
    exchange: str = Field(min_length=1, max_length=40)
    symbol: str = Field(min_length=1, max_length=80)
    side: PlanSide
    revision: PlanRevisionInput
    client_created_at: Optional[str] = Field(default=None, max_length=80)


class RetrospectivePlanCreate(BaseModel):
    journal_entry_id: int = Field(gt=0)
    revision: RetrospectivePlanRevisionInput


class PlanRevisionCreate(PlanRevisionInput):
    pass


class PlanLinkRequest(BaseModel):
    journal_entry_id: int = Field(gt=0)


class PlanStatusUpdate(BaseModel):
    status: PlanStatus


class PlanLabQuery(BaseModel):
    start_time: int = Field(ge=1)
    end_time: int = Field(ge=1)
    direction: Optional[PlanSide] = None
    setup: Optional[str] = Field(default=None, max_length=120)
    symbol: Optional[str] = Field(default=None, max_length=80)
    plan_source: Optional[PlanSource] = None


class PlanEnvelope(BaseModel):
    success: bool
    data: Dict[str, Any]


class PlanListEnvelope(BaseModel):
    success: bool
    data: List[Dict[str, Any]]


class PlanLabEnvelope(BaseModel):
    success: bool
    data: Dict[str, Any]
