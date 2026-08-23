"""Contracts for exchange discovery and read-only synchronization."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ExchangeId = Literal["deepcoin", "binance", "bybit", "okx"]
InstrumentType = Literal["SWAP", "SPOT"]


class ExchangeStatus(BaseModel):
    id: ExchangeId
    name: str
    configured: bool
    mode: Literal["read_only"] = "read_only"
    instrument_types: List[InstrumentType]
    requires_passphrase: bool = False
    connector: Literal["native", "ccxt"]
    credential_source: Literal["environment", "keyring", "encrypted_db", "none"] = "none"
    credential_error: Optional[str] = None


class ExchangeListData(BaseModel):
    exchanges: List[ExchangeStatus]


class ExchangeListEnvelope(BaseModel):
    success: bool
    data: ExchangeListData


class ExchangeCredentialDeleteData(ExchangeListData):
    deleted: bool
    environment_override: bool


class ExchangeCredentialDeleteEnvelope(BaseModel):
    success: bool
    data: ExchangeCredentialDeleteData


class ExchangeSyncRequest(BaseModel):
    inst_type: InstrumentType = "SWAP"
    lookback_days: int = Field(default=30, ge=1, le=90)
    symbols: List[str] = Field(default_factory=list, max_length=50)


class ExchangeCredentialsRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=512)
    secret_key: str = Field(min_length=1, max_length=512)
    passphrase: str = Field(default="", max_length=512)


class ExchangeSyncData(BaseModel):
    exchange: ExchangeId
    inst_type: InstrumentType
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
    positions_skipped: int = 0
    positions_ignored: int = 0
    warnings: List[str] = Field(default_factory=list)


class ExchangeSyncEnvelope(BaseModel):
    success: bool
    data: ExchangeSyncData


class ExchangeExecution(BaseModel):
    external_id: str
    datetime: str
    symbol: str
    direction: str
    size: Optional[float] = None
    entry_price: float
    source: str
    exchange: str
    order_id: Optional[str] = None
    notes: Optional[str] = None
    fee: Optional[float] = None
    fee_currency: Optional[str] = None
    indicator_snapshot: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


class ExchangeExecutionEnvelope(BaseModel):
    success: bool
    data: List[ExchangeExecution]


class ExchangeOpenPosition(BaseModel):
    position_id: str
    exchange: ExchangeId
    symbol: str
    direction: Literal["Long", "Short"]
    size: float
    average_price: Optional[float] = None
    last_price: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    leverage: Optional[float] = None
    opened_at: Optional[str] = None
    updated_at: Optional[str] = None


class ExchangeOpenPositionsData(BaseModel):
    positions: List[ExchangeOpenPosition] = Field(default_factory=list)
    unavailable_exchanges: List[ExchangeId] = Field(default_factory=list)


class ExchangeOpenPositionsEnvelope(BaseModel):
    success: bool
    data: ExchangeOpenPositionsData


__all__ = [
    "ExchangeId",
    "ExchangeCredentialsRequest",
    "ExchangeCredentialDeleteEnvelope",
    "ExchangeExecutionEnvelope",
    "ExchangeOpenPositionsEnvelope",
    "ExchangeListEnvelope",
    "ExchangeStatus",
    "ExchangeSyncEnvelope",
    "ExchangeSyncRequest",
    "InstrumentType",
]
