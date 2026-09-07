"""Bounded official analytics queries; no expression language or result cache."""
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from backend.modules.analytics.schemas import AnalyticsGroup, AnalyticsQuery, Contract


class Period(Contract):
    start_time: Annotated[StrictInt, Field(ge=1, le=253402300799999)]
    end_time: Annotated[StrictInt, Field(ge=1, le=253402300799999)]

    @model_validator(mode="after")
    def ordered(self):
        if self.start_time > self.end_time:
            raise ValueError("Period start must not exceed end")
        return self


class Criterion(Contract):
    operator: Literal["gte", "lte"]
    basis: Literal["VALUE", "DELTA"]
    target: str = Field(min_length=1, max_length=80)

    @field_validator("target")
    @classmethod
    def numeric_target(cls, value):
        try:
            number = Decimal(value)
        except InvalidOperation:
            raise ValueError("Target must be a finite decimal number") from None
        if not number.is_finite() or abs(number.adjusted()) > 300:
            raise ValueError("Target must be finite with exponent within +/-300")
        return str(number)


class ExperimentDefinition(Contract):
    name: str = Field(min_length=1, max_length=160)
    hypothesis: str = Field(min_length=1, max_length=2000)
    notes: str = Field(default="", max_length=4000)
    query: AnalyticsQuery
    baseline: Period
    group_key: str | None = Field(default=None, min_length=1, max_length=500)
    criterion: Criterion
    minimum_sample: Annotated[StrictInt, Field(ge=5, le=2000)] = 5

    @field_validator("name", "hypothesis")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Text must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def bounded_measurement(self):
        if self.baseline.end_time >= self.query.filters.start_time:
            raise ValueError("Baseline must end before the experiment period starts")
        if self.query.dimension == "all" and self.group_key is not None:
            raise ValueError("All-trades measurement must not specify a group")
        if self.query.dimension != "all" and not self.group_key:
            raise ValueError("Grouped measurement requires an exact official group key")
        if self.group_key and self.query.dimension in {'strategy', 'strategy_version', 'rule'} and not self.group_key.startswith('state:'):
            parts = self.group_key.split(':')
            if len(parts) < 2 or parts[0] != self.query.dimension or not parts[1].isdigit() or int(parts[1]) < 1:
                raise ValueError('Invalid Strategy/Rule group identity')
            field = 'strategy_ids' if self.query.dimension == 'strategy' else 'strategy_version_ids'
            if int(parts[1]) not in (getattr(self.query.filters, field) or []):
                raise ValueError('Strategy/Rule group must explicitly include its exact parent ID filter')
        return self


class DraftUpdate(Contract):
    revision: Annotated[StrictInt, Field(ge=1)]
    definition: ExperimentDefinition


class Transition(Contract):
    revision: Annotated[StrictInt, Field(ge=1)]
    status: Literal["ACTIVE", "COMPLETED", "CANCELLED"]


class Experiment(Contract):
    id: int
    revision: int
    ownership: Literal["USER_OWNED"] = "USER_OWNED"
    status: Literal["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]
    created_at: str
    updated_at: str
    started_at: str | None
    completed_at: str | None
    cancelled_at: str | None
    definition: ExperimentDefinition


class ExperimentEnvelope(Contract):
    success: Literal[True] = True
    data: Experiment


class ExperimentList(Contract):
    success: Literal[True] = True
    data: list[Experiment]


class Measurement(Contract):
    experiment_id: int
    definition_revision: int
    current: AnalyticsGroup | None
    baseline: AnalyticsGroup | None
    delta: str | None
    criterion_status: Literal["MET", "NOT_MET", "NOT_EVALUABLE"]
    reasons: list[str]
    query: AnalyticsQuery
    baseline_query: AnalyticsQuery
    evidence_semantics: Literal["OBSERVED_ASSOCIATION"] = "OBSERVED_ASSOCIATION"
    evaluation_basis: Literal["CURRENT_RECONSTRUCTED"] = "CURRENT_RECONSTRUCTED"
    warnings: list[str]


class MeasurementEnvelope(Contract):
    success: Literal[True] = True
    data: Measurement
