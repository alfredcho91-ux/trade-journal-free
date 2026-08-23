"""Indicator-domain request and response schemas."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class VPVRSourcePathParams(BaseModel):
    """Market selection for Binance candles used to build a VPVR."""

    coin: str = Field(default="BTC", min_length=2, max_length=15, pattern=r"^[A-Za-z0-9]+$")
    interval: str = Field(default="4h", min_length=2, max_length=4)


class VPVRSourceQueryParams(BaseModel):
    """Requested Binance candle window for a VPVR calculation."""

    candles: Optional[int] = Field(default=None, ge=50, le=3000)


class VPVROHLCVCandle(BaseModel):
    """One normalized Binance OHLCV candle, ready for price-bin allocation."""

    open_time: int
    open_time_iso: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time: int
    quote_volume: float
    trade_count: int
    taker_buy_base_volume: float
    taker_buy_quote_volume: float


class VPVRSourceData(BaseModel):
    """Raw Binance data contract retained for VPVR data inspection."""

    source: Literal["binance"]
    symbol: str
    interval: str
    requested_candles: int
    count: int
    candles: List[VPVROHLCVCandle]


class VPVRSourceEnvelope(BaseModel):
    success: bool
    data: VPVRSourceData


class VPVRQueryParams(BaseModel):
    """Optional VPVR calculation parameters."""

    candles: Optional[int] = Field(default=None, ge=50, le=3000)
    bin_count: int = Field(default=24, ge=8, le=100)
    price_range: float = Field(
        default=10_000,
        gt=0,
        le=1_000_000,
        description="Maximum visible price range in USDT",
    )


class VPVRPriceBin(BaseModel):
    price_low: float
    price_high: float
    volume: float
    buy_volume: float
    sell_volume: float
    delta: float
    volume_pct: float
    is_poc: bool
    is_value_area: bool
    is_current: bool


class VPVRData(BaseModel):
    source: Literal["binance"]
    symbol: str
    interval: str
    requested_candles: int
    candle_count: int
    bin_count: int
    price_low: float
    price_high: float
    current_price: float
    vwap: Optional[float]
    total_quote_volume: float
    poc_price_low: float
    poc_price_high: float
    value_area_low: float
    value_area_high: float
    value_area_pct: float
    price_range: Optional[float]  # Effective visible price range in USDT.
    allocation_method: Literal["candle_range_proportional"]
    bins: List[VPVRPriceBin]


class VPVREnvelope(BaseModel):
    success: bool
    data: VPVRData


class TradeReportQueryParams(BaseModel):
    """Historical window and point-in-time reference for a trade report."""

    limit: int = Field(default=300, ge=100, le=1000)
    end_time: Optional[int] = Field(default=None, ge=1)
    as_of: Optional[int] = Field(default=None, ge=1)
    profile_candles: int = Field(default=300, ge=50, le=1000)
    bin_count: int = Field(default=24, ge=8, le=100)


class TradeReportEnvelope(BaseModel):
    success: bool
    data: Dict[str, Any]


class IndicatorProjectionValues(BaseModel):
    rsi_30: Optional[float] = None
    rsi_70: Optional[float] = None


class IndicatorProjectionVWAP(BaseModel):
    anchor: Literal["day", "week", "month", "quarter", "year"]
    value: Optional[float] = None


class IndicatorProjectionRollingVWAP(BaseModel):
    window: int
    value: Optional[float] = None


class IndicatorProjectionVWAPDeviation(BaseModel):
    anchor: Literal["month"]
    length: int
    sample_count: int
    source: str
    vwap: float
    standard_deviation: float
    current_price: float
    sigma: Optional[float] = None
    zone: str
    bands: Dict[str, float]


class IndicatorProjectionPayload(BaseModel):
    current_price: float
    current_rsi: Optional[float] = None
    vwaps: List[IndicatorProjectionVWAP]
    rolling_vwaps: List[IndicatorProjectionRollingVWAP]
    vwap_deviation: Optional[IndicatorProjectionVWAPDeviation] = None
    projections: IndicatorProjectionValues


class IndicatorProjectionEnvelope(BaseModel):
    success: bool
    coin: str
    interval: str
    data: IndicatorProjectionPayload


__all__ = [
    "IndicatorProjectionEnvelope",
    "IndicatorProjectionPayload",
    "IndicatorProjectionRollingVWAP",
    "IndicatorProjectionValues",
    "IndicatorProjectionVWAP",
    "IndicatorProjectionVWAPDeviation",
    "VPVRSourceData",
    "VPVRSourceEnvelope",
    "VPVRSourcePathParams",
    "VPVRSourceQueryParams",
    "VPVRData",
    "VPVREnvelope",
    "VPVRPriceBin",
    "VPVRQueryParams",
    "TradeReportEnvelope",
    "TradeReportQueryParams",
]
