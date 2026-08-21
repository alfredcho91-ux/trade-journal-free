"""Journal domain schemas."""

import math
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class JournalEntry(BaseModel):
    datetime: Optional[str] = None
    entry_datetime: Optional[str] = None
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    direction: Optional[str] = None
    entry_reason_1_indicator: Optional[str] = None
    entry_reason_1: Optional[str] = None
    entry_reason_2_indicator: Optional[str] = None
    entry_reason_2: Optional[str] = None
    entry_reason_3_indicator: Optional[str] = None
    entry_reason_3: Optional[str] = None
    size: Optional[float] = None
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    pnl_pct: Optional[float] = None
    r_multiple: Optional[float] = None
    outcome: Optional[str] = None
    emotion: Optional[str] = None
    tags: Optional[str] = None
    mistakes: Optional[str] = None
    notes: Optional[str] = None
    source: Optional[str] = None
    external_id: Optional[str] = None
    exchange: Optional[str] = None
    order_id: Optional[str] = None
    fee: Optional[float] = None
    fee_currency: Optional[str] = None
    funding_fee: Optional[float] = None
    realized_pnl: Optional[float] = None
    leverage: Optional[float] = None
    invested_amount: Optional[float] = None
    pnl_calculation_version: Optional[int] = None
    indicator_snapshot: Optional[Dict[str, Any]] = None


class JournalRecord(JournalEntry):
    id: int
    indicators: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None


class JournalListEnvelope(BaseModel):
    success: bool
    data: List[JournalRecord]


class JournalDeleteEnvelope(BaseModel):
    success: bool
    message: str


class JournalExcursionQuery(BaseModel):
    start_time: int = Field(ge=1)
    end_time: int = Field(ge=1)


class JournalSlTpQuery(JournalExcursionQuery):
    sl_min: float = Field(default=0.5, ge=0.1, le=50)
    sl_max: float = Field(default=5.0, ge=0.1, le=50)
    sl_step: float = Field(default=0.5, ge=0.1, le=10)
    tp_min: float = Field(default=0.5, ge=0.1, le=100)
    tp_max: float = Field(default=10.0, ge=0.1, le=100)
    tp_step: float = Field(default=0.5, ge=0.1, le=20)

    @model_validator(mode="after")
    def validate_grid(self):
        if self.sl_min > self.sl_max:
            raise ValueError("sl_min must not exceed sl_max")
        if self.tp_min > self.tp_max:
            raise ValueError("tp_min must not exceed tp_max")
        sl_count = math.floor((self.sl_max - self.sl_min) / self.sl_step + 1e-9) + 1
        tp_count = math.floor((self.tp_max - self.tp_min) / self.tp_step + 1e-9) + 1
        if sl_count * tp_count > 800:
            raise ValueError("SL/TP grid cannot exceed 800 combinations")
        return self


class JournalExcursion(BaseModel):
    journal_id: int
    mfe_pct: float
    mae_pct: float
    realized_move_pct: float
    capture_pct: Optional[float] = None
    classification: Literal["good_entry_poor_exit", "poor_entry", "balanced"]
    candle_count: int


class JournalExcursionData(BaseModel):
    interval: Literal["15m"]
    items: List[JournalExcursion]
    warnings: List[str]


class JournalExcursionEnvelope(BaseModel):
    success: bool
    data: JournalExcursionData


class JournalQualityData(BaseModel):
    entry_trend_intervals: List[Literal["1w", "1d", "4h"]]
    exit_interval: Literal["4h"]
    minimum_regime_conclusion_sample: int
    summary: Dict[str, Any]
    thresholds: Dict[str, Any]
    regimes: List[Dict[str, Any]]
    alignment_stats: List[Dict[str, Any]]
    trade_alignment_stats: List[Dict[str, Any]]
    direction_stats: List[Dict[str, Any]]
    direction_breakdown: Dict[str, Dict[str, Any]]
    hold_results: Dict[str, Dict[str, Any]]
    virtual_exit_strategies: Dict[str, Dict[str, Any]]
    items: List[Dict[str, Any]]
    warnings: List[str]


class JournalQualityEnvelope(BaseModel):
    success: bool
    data: JournalQualityData


class JournalStopLossData(BaseModel):
    interval: Literal["4h"]
    horizons: List[int]
    criteria: Dict[str, Any]
    summary: Dict[str, Any]
    regime_patterns: List[Dict[str, Any]]
    direction_breakdown: Dict[str, Dict[str, Any]]
    coverage: Dict[str, Any]
    items: List[Dict[str, Any]]
    warnings: List[str]


class JournalStopLossEnvelope(BaseModel):
    success: bool
    data: JournalStopLossData


class JournalStopOptimizationData(BaseModel):
    interval: Literal["15m"]
    methodology: Dict[str, Any]
    direction_breakdown: Dict[str, Dict[str, Any]]
    regime_breakdown: Dict[str, List[Dict[str, Any]]]
    coverage: Dict[str, int]
    warnings: List[str]


class JournalStopOptimizationEnvelope(BaseModel):
    success: bool
    data: JournalStopOptimizationData


class JournalSlTpData(BaseModel):
    interval: Literal["5m"]
    sl_values: List[float]
    tp_values: List[float]
    methodology: Dict[str, Any]
    direction_breakdown: Dict[str, Dict[str, Any]]
    coverage: Dict[str, int]
    warnings: List[str]


class JournalSlTpEnvelope(BaseModel):
    success: bool
    data: JournalSlTpData


class JournalCurrentMarketData(BaseModel):
    symbol: str
    as_of: str
    indicator_snapshot: Dict[str, Any]
    trend_states: Dict[str, Dict[str, Any]]
    market_regime: Dict[str, str]
    warnings: List[str]


class JournalCurrentMarketEnvelope(BaseModel):
    success: bool
    data: JournalCurrentMarketData


__all__ = [
    "JournalDeleteEnvelope",
    "JournalCurrentMarketEnvelope",
    "JournalEntry",
    "JournalExcursionEnvelope",
    "JournalExcursionQuery",
    "JournalQualityEnvelope",
    "JournalSlTpEnvelope",
    "JournalSlTpQuery",
    "JournalStopLossEnvelope",
    "JournalStopOptimizationEnvelope",
    "JournalListEnvelope",
]
