"""Contracts for exchange discovery and read-only synchronization."""

from typing import List, Literal, Optional

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


class ExchangeListData(BaseModel):
    exchanges: List[ExchangeStatus]


class ExchangeListEnvelope(BaseModel):
    success: bool
    data: ExchangeListData


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


__all__ = [
    "ExchangeId",
    "ExchangeCredentialsRequest",
    "ExchangeListEnvelope",
    "ExchangeStatus",
    "ExchangeSyncEnvelope",
    "ExchangeSyncRequest",
    "InstrumentType",
]
