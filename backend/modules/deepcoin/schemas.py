"""Request and response contracts for Deepcoin trade-history synchronization."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class DeepcoinStatusData(BaseModel):
    configured: bool
    mode: Literal["read_only"] = "read_only"


class DeepcoinStatusEnvelope(BaseModel):
    success: bool
    data: DeepcoinStatusData


class DeepcoinSyncRequest(BaseModel):
    inst_type: Literal["SWAP", "SPOT"] = "SWAP"
    lookback_days: int = Field(default=7, ge=1, le=90)


class DeepcoinSyncData(BaseModel):
    inst_type: Literal["SWAP", "SPOT"]
    lookback_days: int
    fetched: int
    imported: int
    skipped: int
    ignored: int
    complete_snapshots: int
    partial_snapshots: int
    positions_fetched: int = 0
    positions_imported: int = 0
    positions_updated: int = 0
    fills_updated: int = 0
    positions_skipped: int = 0
    positions_ignored: int = 0
    warnings: List[str] = Field(default_factory=list)


class DeepcoinSyncEnvelope(BaseModel):
    success: bool
    data: DeepcoinSyncData


class DeepcoinTradeMarker(BaseModel):
    datetime: str
    price: float
    size: Optional[float] = None
    order_id: Optional[str] = None
    label: str


class DeepcoinTradeMarkersData(BaseModel):
    source: Literal["deepcoin_trigger_order_history"]
    take_profits: List[DeepcoinTradeMarker] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class DeepcoinTradeMarkersEnvelope(BaseModel):
    success: bool
    data: DeepcoinTradeMarkersData


__all__ = [
    "DeepcoinStatusData",
    "DeepcoinStatusEnvelope",
    "DeepcoinTradeMarker",
    "DeepcoinTradeMarkersData",
    "DeepcoinTradeMarkersEnvelope",
    "DeepcoinSyncData",
    "DeepcoinSyncEnvelope",
    "DeepcoinSyncRequest",
]
