"""Journal domain schemas."""

import math
from typing import Any, Dict, List, Literal, Optional, Union

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
    planned_stop_pct: Optional[float] = Field(default=None, gt=0, le=100)
    planned_target_pct: Optional[float] = Field(default=None, gt=0, le=500)
    planned_entry_reason: Optional[str] = None
    setup_tags: List[str] = Field(default_factory=list)
    mistake_tags: List[str] = Field(default_factory=list)
    plan_recorded_at: Optional[str] = None
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


class JournalBehaviorUpdate(BaseModel):
    planned_stop_pct: Optional[float] = Field(default=None, gt=0, le=100)
    planned_target_pct: Optional[float] = Field(default=None, gt=0, le=500)
    planned_entry_reason: Optional[str] = Field(default=None, max_length=500)
    setup_tags: Optional[List[str]] = Field(default=None, max_length=20)
    mistake_tags: Optional[List[str]] = Field(default=None, max_length=20)


class JournalBehaviorUpdateEnvelope(BaseModel):
    success: bool
    data: JournalRecord


RuleType = Literal["trend_direction_forbid", "max_stop_pct", "min_rr", "no_scale_in"]


class JournalBehaviorRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rule_type: RuleType
    parameters: Dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class JournalBehaviorRuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    rule_type: Optional[RuleType] = None
    parameters: Optional[Dict[str, Any]] = None
    is_enabled: Optional[bool] = None


class JournalBehaviorRule(BaseModel):
    id: int
    name: str
    rule_type: RuleType
    parameters: Dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class JournalBehaviorRulesEnvelope(BaseModel):
    success: bool
    data: List[JournalBehaviorRule]


class JournalBehaviorRuleEnvelope(BaseModel):
    success: bool
    data: JournalBehaviorRule


class JournalExcursionQuery(BaseModel):
    start_time: int = Field(ge=1)
    end_time: int = Field(ge=1)


class JournalQualityQuery(JournalExcursionQuery):
    """Quality-analysis filter expressed as a net return on invested margin."""

    min_abs_net_return_pct: float = Field(default=0.0, ge=0, le=100)


class JournalBehaviorQuery(JournalQualityQuery):
    """Same closed-trade range and return filter used by trade-quality analysis."""


class JournalBehaviorCondition(BaseModel):
    type: Literal["direction", "symbol", "regime", "setup", "mistake", "rule_status"]
    value: str = Field(min_length=1, max_length=160)


class JournalBehaviorComparisonRequest(JournalQualityQuery):
    left: JournalBehaviorCondition
    right: JournalBehaviorCondition


class JournalBehaviorEnvelope(BaseModel):
    success: bool
    data: Dict[str, Any]


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


class JournalPerformanceGroup(BaseModel):
    id: str
    trade_count: int
    wins: int
    win_rate_pct: Optional[float] = None
    net_pnl: float


class JournalPerformanceTrade(BaseModel):
    journal_id: int
    symbol: Optional[str] = None
    direction: Optional[str] = None
    realized_pnl: Optional[float] = None


class JournalPerformanceData(BaseModel):
    closed_trade_count: int
    evaluated_trade_count: int
    missing_pnl_count: int
    wins: int
    losses: int
    breakevens: int
    win_rate_pct: Optional[float] = None
    net_pnl: float
    net_return_pct: Optional[float] = None
    return_sample_count: int
    gross_profit: float
    gross_loss: float
    profit_factor: Optional[float] = None
    profit_factor_infinite: bool
    average_win: Optional[float] = None
    average_loss: Optional[float] = None
    expectancy: Optional[float] = None
    fee_impact: float
    funding_impact: float
    max_win_streak: int
    max_loss_streak: int
    best_trade: Optional[JournalPerformanceTrade] = None
    worst_trade: Optional[JournalPerformanceTrade] = None
    directions: List[JournalPerformanceGroup]
    symbols: List[JournalPerformanceGroup]


class JournalPerformanceEnvelope(BaseModel):
    success: bool
    data: JournalPerformanceData


class QualityPerformance(BaseModel):
    trade_count: int
    win_rate_pct: Optional[float] = None
    average_r: Optional[float] = None
    r_sample_count: int
    average_pnl: Optional[float] = None
    profit_factor: Optional[float] = None
    average_mfe_pct: Optional[float] = None
    average_mae_pct: Optional[float] = None
    average_holding_minutes: Optional[float] = None
    early_exit_ratio_pct: Optional[float] = None
    late_exit_ratio_pct: Optional[float] = None
    average_capture_ratio_pct: Optional[float] = None
    sample_quality: Literal["low", "medium", "high"]


class QualityHoldAggregate(BaseModel):
    available_count: int
    average_return_pct: Optional[float] = None
    average_r: Optional[float] = None
    r_sample_count: int


class QualityStrategyAggregate(BaseModel):
    triggered_count: int
    eligible_count: int
    trigger_rate_pct: Optional[float] = None
    average_return_pct: Optional[float] = None
    average_r: Optional[float] = None
    r_sample_count: int


class QualityBestExit(BaseModel):
    type: Literal["hold", "strategy"]
    id: str
    average_return_pct: Optional[float] = None
    average_r: Optional[float] = None
    available_count: Optional[int] = None
    triggered_count: Optional[int] = None


class QualityRegime(QualityPerformance):
    id: str
    alignment: str
    trade_bias: str
    hold_results: Dict[str, QualityHoldAggregate]
    best_exit_method: Optional[QualityBestExit] = None


class QualityGroup(QualityPerformance):
    id: str


class QualitySummary(BaseModel):
    trade_count: int
    total_pnl: Optional[float] = None
    win_rate_pct: Optional[float] = None
    average_r: Optional[float] = None
    average_pnl: Optional[float] = None
    profit_factor: Optional[float] = None
    best_regime: Optional[QualityRegime] = None
    worst_regime: Optional[QualityRegime] = None
    quality_counts: Dict[str, int]
    early_exit_ratio_pct: Optional[float] = None
    late_exit_ratio_pct: Optional[float] = None
    average_capture_ratio_pct: Optional[float] = None
    issue_balance: Literal["entry", "exit", "balanced", "insufficient_data"]
    r_available_count: int


class QualityAnalysisSlice(BaseModel):
    summary: QualitySummary
    regimes: List[QualityRegime]
    alignment_stats: List[QualityGroup]
    trade_alignment_stats: List[QualityGroup]
    hold_results: Dict[str, QualityHoldAggregate]
    virtual_exit_strategies: Dict[str, QualityStrategyAggregate]


class QualityMarketRegime(BaseModel):
    id: str
    alignment: str
    trade_bias: str


class QualityItem(BaseModel):
    journal_id: int
    symbol: Optional[str] = None
    direction: Optional[str] = None
    entry_datetime: Optional[str] = None
    exit_datetime: Optional[str] = None
    realized_pnl: Optional[float] = None
    r_multiple: Optional[float] = None
    holding_minutes: float
    excursion: Optional[JournalExcursion] = None
    quality_class: str
    trend_states: Dict[str, Dict[str, Any]]
    market_regime: QualityMarketRegime
    regime_alignment: Optional[str] = None
    trade_alignment: Optional[Literal["with_trend", "counter_trend", "neutral"]] = None
    exit_quality: Dict[str, Any]


class JournalQualityData(QualityAnalysisSlice):
    entry_trend_intervals: List[Literal["1w", "1d", "4h"]]
    exit_interval: Literal["4h"]
    minimum_regime_conclusion_sample: int
    market_data_sources: List[str] = Field(default_factory=list)
    thresholds: Dict[str, Optional[Union[float, str]]]
    direction_stats: List[QualityGroup]
    direction_breakdown: Dict[str, QualityAnalysisSlice]
    items: List[QualityItem]
    return_filter: Dict[str, Any]
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
    "JournalPerformanceEnvelope",
]
