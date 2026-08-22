"""Internal models shared by exchange adapters and synchronization."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ExchangeCredentials:
    api_key: str
    secret_key: str
    passphrase: str = ""


@dataclass(frozen=True)
class NormalizedTrade:
    external_id: str
    timestamp_ms: int
    symbol: str
    coin: str
    side: str
    amount: float
    price: float
    fee: float
    fee_currency: Optional[str]
    order_id: Optional[str]
    position_side: Optional[str]
    contract_size: float


@dataclass
class PositionState:
    signed_amount: float = 0.0
    average_price: float = 0.0
    entry_timestamp_ms: int = 0
    entry_external_id: str = ""
    open_fee: float = 0.0
    closed_amount: float = 0.0
    weighted_exit_total: float = 0.0
    realized_pnl: float = 0.0
    closed_fee: float = 0.0
    last_close_timestamp_ms: int = 0
    last_order_id: Optional[str] = None
    fee_currency: Optional[str] = None


@dataclass(frozen=True)
class SnapshotEvent:
    external_id: str
    timestamp_ms: int
    coin: str
    event_type: str


@dataclass(frozen=True)
class TradeFetchResult:
    trades: List[Dict[str, Any]]
    truncated_symbols: List[str]


__all__ = [
    "ExchangeCredentials",
    "NormalizedTrade",
    "PositionState",
    "SnapshotEvent",
    "TradeFetchResult",
]
