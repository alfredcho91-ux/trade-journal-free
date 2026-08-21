"""Exchange registry and CCXT-backed read-only trade import."""

from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import ccxt

from backend.config.settings import DeepcoinCredentials, get_deepcoin_credentials
from backend.modules.exchanges.credentials import save_local_exchange_credentials
from backend.modules.deepcoin.service import sync_deepcoin_fills_service
from backend.modules.deepcoin.snapshot import build_indicator_snapshots
from backend.modules.journal.repository import add_entries_if_new_external_ids, existing_external_ids
from backend.utils.error_handler import BusinessLogicError, DataLoadError

SUPPORTED_EXCHANGES: Dict[str, Dict[str, Any]] = {
    "deepcoin": {
        "name": "Deepcoin",
        "connector": "native",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": True,
    },
    "binance": {
        "name": "Binance",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": False,
    },
    "bybit": {
        "name": "Bybit",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": False,
    },
    "okx": {
        "name": "OKX",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": True,
    },
}


@dataclass(frozen=True)
class _Credentials:
    api_key: str
    secret_key: str
    passphrase: str = ""


@dataclass(frozen=True)
class _SnapshotEvent:
    external_id: str
    timestamp_ms: int
    coin: str
    event_type: str


@dataclass(frozen=True)
class _Trade:
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
class _PositionState:
    signed_amount: float = 0.0
    average_price: float = 0.0
    entry_timestamp_ms: int = 0
    open_fee: float = 0.0
    closed_amount: float = 0.0
    weighted_exit_total: float = 0.0
    realized_pnl: float = 0.0
    closed_fee: float = 0.0
    last_close_timestamp_ms: int = 0
    last_order_id: Optional[str] = None
    fee_currency: Optional[str] = None


def _finite(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _credentials(exchange_id: str) -> Optional[_Credentials]:
    prefix = exchange_id.upper()
    api_key = os.getenv(f"{prefix}_API_KEY", "").strip()
    secret_key = os.getenv(f"{prefix}_SECRET_KEY", "")
    passphrase = os.getenv(f"{prefix}_PASSPHRASE", "")
    requires_passphrase = bool(SUPPORTED_EXCHANGES[exchange_id]["requires_passphrase"])
    if not api_key or not secret_key or (requires_passphrase and not passphrase):
        return None
    return _Credentials(api_key, secret_key, passphrase)


def exchange_status_service() -> Dict[str, Any]:
    statuses = []
    for exchange_id, definition in SUPPORTED_EXCHANGES.items():
        configured = (
            get_deepcoin_credentials() is not None
            if exchange_id == "deepcoin"
            else _credentials(exchange_id) is not None
        )
        statuses.append({"id": exchange_id, "configured": configured, "mode": "read_only", **definition})
    return {"success": True, "data": {"exchanges": statuses}}


def configure_exchange_credentials_service(
    exchange_id: str,
    api_key: str,
    secret_key: str,
    passphrase: str = "",
) -> Dict[str, Any]:
    """Verify read access before persisting a selected exchange's credentials."""
    definition = SUPPORTED_EXCHANGES[exchange_id]
    if definition["requires_passphrase"] and not passphrase.strip():
        raise BusinessLogicError(f"{definition['name']} requires a passphrase", error_code="EXCHANGE_PASSPHRASE_REQUIRED")
    credentials = _Credentials(api_key.strip(), secret_key.strip(), passphrase.strip())
    try:
        if exchange_id == "deepcoin":
            from backend.modules.deepcoin.service import DeepcoinClient

            DeepcoinClient(DeepcoinCredentials(credentials.api_key, credentials.secret_key, credentials.passphrase)).get_fills(
                inst_type="SWAP", lookback_days=1
            )
        else:
            client = _exchange_client(exchange_id, credentials, "SPOT")
            client.fetch_balance()
    except (ccxt.BaseError, DataLoadError, ValueError, AttributeError) as exc:
        raise BusinessLogicError(
            "Connection could not be verified. Check the API key, passphrase, IP allowlist, and read permission.",
            error_code="EXCHANGE_CONNECTION_FAILED",
        ) from exc
    try:
        save_local_exchange_credentials(exchange_id, credentials.api_key, credentials.secret_key, credentials.passphrase)
    except (OSError, ValueError) as exc:
        raise BusinessLogicError("Credentials could not be saved locally.", error_code="EXCHANGE_CREDENTIAL_SAVE_FAILED") from exc
    return exchange_status_service()


def _exchange_client(exchange_id: str, credentials: _Credentials, inst_type: str):
    class_name = "binanceusdm" if exchange_id == "binance" and inst_type == "SWAP" else exchange_id
    exchange_class = getattr(ccxt, class_name, None)
    if exchange_class is None:
        raise BusinessLogicError(f"Unsupported exchange connector: {exchange_id}")
    config: Dict[str, Any] = {
        "apiKey": credentials.api_key,
        "secret": credentials.secret_key,
        "enableRateLimit": True,
        "options": {"defaultType": "swap" if inst_type == "SWAP" else "spot"},
    }
    if credentials.passphrase:
        config["password"] = credentials.passphrase
    return exchange_class(config)


def _resolve_symbol(client: Any, value: str, inst_type: str) -> str:
    normalized = value.strip().upper().replace("-", "/")
    if not normalized:
        raise ValueError("Empty symbol")
    if normalized in client.markets:
        return normalized
    base, _, quote_part = normalized.partition("/")
    quote = quote_part.split(":", 1)[0]
    for market in client.markets.values():
        if market.get("base") != base or market.get("quote") != quote:
            continue
        if inst_type == "SWAP" and market.get("swap") and market.get("linear", True):
            return str(market["symbol"])
        if inst_type == "SPOT" and market.get("spot"):
            return str(market["symbol"])
    raise BusinessLogicError(f"{value} is not available as {inst_type} on {client.name}")


def _requested_symbols(exchange_id: str, symbols: Sequence[str]) -> List[str]:
    configured = os.getenv(f"{exchange_id.upper()}_SYMBOLS", "")
    values = list(symbols) or configured.split(",")
    normalized = [value.strip() for value in values if value.strip()]
    if not normalized:
        raise BusinessLogicError(
            "At least one symbol is required (for example BTC/USDT). "
            f"Set {exchange_id.upper()}_SYMBOLS or enter symbols in the journal."
        )
    return list(dict.fromkeys(normalized))


def _fetch_trades(client: Any, symbols: Sequence[str], since: int) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    seen = set()
    for requested in symbols:
        symbol = _resolve_symbol(client, requested, "SWAP" if client.options.get("defaultType") == "swap" else "SPOT")
        cursor = since
        for _ in range(30):
            try:
                page = client.fetch_my_trades(symbol, cursor, 1000)
            except ccxt.BaseError as exc:
                raise DataLoadError(f"{client.name} trade history is temporarily unavailable") from exc
            if not page:
                break
            newest = cursor
            for trade in page:
                trade_id = str(trade.get("id") or "")
                timestamp_ms = int(trade.get("timestamp") or 0)
                unique_key = (symbol, trade_id or timestamp_ms, trade.get("order"), trade.get("side"))
                if unique_key not in seen:
                    seen.add(unique_key)
                    output.append(trade)
                newest = max(newest, timestamp_ms + 1)
            if len(page) < 1000 or newest <= cursor:
                break
            cursor = newest
    return sorted(output, key=lambda item: int(item.get("timestamp") or 0))


def _position_side(raw: Dict[str, Any]) -> Optional[str]:
    info = raw.get("info") if isinstance(raw.get("info"), dict) else {}
    value = str(info.get("positionSide") or info.get("posSide") or "").strip().upper()
    return value if value in {"LONG", "SHORT"} else None


def _normalize_trades(exchange_id: str, client: Any, raw_trades: Iterable[Dict[str, Any]]) -> Tuple[List[_Trade], int]:
    trades: List[_Trade] = []
    ignored = 0
    for raw in raw_trades:
        timestamp_ms = int(raw.get("timestamp") or 0)
        amount = _finite(raw.get("amount"))
        price = _finite(raw.get("price"))
        side = str(raw.get("side") or "").lower()
        symbol = str(raw.get("symbol") or "")
        market = client.markets.get(symbol, {})
        coin = str(market.get("base") or symbol.split("/")[0]).upper()
        quote = str(market.get("quote") or "USDT").upper()
        if timestamp_ms <= 0 or amount is None or amount <= 0 or price is None or price <= 0 or side not in {"buy", "sell"}:
            ignored += 1
            continue
        fee_data = raw.get("fee") if isinstance(raw.get("fee"), dict) else {}
        fee_cost = abs(_finite(fee_data.get("cost")) or 0.0)
        fee_currency = str(fee_data.get("currency") or quote).upper()
        if fee_currency == coin:
            fee = fee_cost * price
            normalized_fee_currency = quote
        elif fee_currency == quote:
            fee = fee_cost
            normalized_fee_currency = quote
        else:
            fee = 0.0
            normalized_fee_currency = None
        stable = str(raw.get("id") or "").strip()
        if not stable:
            digest = hashlib.sha256(json.dumps({
                "timestamp": timestamp_ms,
                "symbol": symbol,
                "side": side,
                "amount": amount,
                "price": price,
                "order": raw.get("order"),
            }, sort_keys=True).encode("utf-8")).hexdigest()
            stable = digest
        trades.append(_Trade(
            external_id=f"{exchange_id}:fill:{stable}",
            timestamp_ms=timestamp_ms,
            symbol=f"{coin}/{quote}",
            coin=coin,
            side=side,
            amount=amount,
            price=price,
            fee=fee,
            fee_currency=normalized_fee_currency,
            order_id=str(raw.get("order") or "") or None,
            position_side=_position_side(raw),
            contract_size=_finite(market.get("contractSize")) or 1.0,
        ))
    return trades, ignored


def _trade_sign(trade: _Trade) -> float:
    if trade.position_side == "LONG":
        return trade.amount if trade.side == "buy" else -trade.amount
    if trade.position_side == "SHORT":
        return -trade.amount if trade.side == "sell" else trade.amount
    return trade.amount if trade.side == "buy" else -trade.amount


def _position_external_id(exchange_id: str, key: Tuple[str, str], state: _PositionState, trade: _Trade) -> str:
    digest = hashlib.sha256(
        f"{exchange_id}|{key[0]}|{key[1]}|{state.entry_timestamp_ms}|{trade.external_id}".encode("utf-8")
    ).hexdigest()
    return f"{exchange_id}:position:{digest}"


def _reconstruct_positions(exchange_id: str, trades: Sequence[_Trade], inst_type: str) -> Tuple[List[Dict[str, Any]], int]:
    states: Dict[Tuple[str, str], _PositionState] = {}
    positions: List[Dict[str, Any]] = []
    ignored_closes = 0
    for trade in trades:
        key = (trade.symbol, trade.position_side or "NET")
        state = states.setdefault(key, _PositionState())
        signed_trade = _trade_sign(trade)
        if inst_type == "SPOT" and abs(state.signed_amount) <= 1e-12 and signed_trade < 0:
            ignored_closes += 1
            continue
        if abs(state.signed_amount) <= 1e-12 or state.signed_amount * signed_trade > 0:
            previous = abs(state.signed_amount)
            added = abs(signed_trade)
            state.average_price = (
                (state.average_price * previous + trade.price * added) / (previous + added)
                if previous > 0 else trade.price
            )
            state.entry_timestamp_ms = state.entry_timestamp_ms or trade.timestamp_ms
            state.signed_amount += signed_trade
            state.open_fee += trade.fee
            continue

        closing_amount = min(abs(state.signed_amount), abs(signed_trade))
        if closing_amount <= 1e-12:
            ignored_closes += 1
            continue
        direction = "Long" if state.signed_amount > 0 else "Short"
        direction_sign = 1.0 if direction == "Long" else -1.0
        allocation = closing_amount / abs(state.signed_amount)
        close_fee = trade.fee * (closing_amount / abs(signed_trade))
        allocated_open_fee = state.open_fee * allocation
        gross_pnl = (
            (trade.price - state.average_price)
            * closing_amount
            * trade.contract_size
            * direction_sign
        )
        total_fee = allocated_open_fee + close_fee
        realized_pnl = gross_pnl - total_fee
        state.closed_amount += closing_amount
        state.weighted_exit_total += trade.price * closing_amount
        state.realized_pnl += realized_pnl
        state.closed_fee += total_fee
        state.last_close_timestamp_ms = trade.timestamp_ms
        state.last_order_id = trade.order_id
        state.fee_currency = trade.fee_currency or state.fee_currency
        old_sign = 1.0 if state.signed_amount > 0 else -1.0
        remainder = abs(state.signed_amount) - closing_amount
        state.open_fee -= allocated_open_fee
        if remainder > 1e-12:
            state.signed_amount = old_sign * remainder
        else:
            exit_price = state.weighted_exit_total / state.closed_amount
            notional = state.average_price * state.closed_amount * trade.contract_size
            external_id = _position_external_id(exchange_id, key, state, trade)
            positions.append({
                "external_id": external_id,
                "timestamp_ms": state.last_close_timestamp_ms,
                "entry_timestamp_ms": state.entry_timestamp_ms,
                "symbol": trade.symbol,
                "coin": trade.coin,
                "direction": direction,
                "size": state.closed_amount,
                "entry_price": state.average_price,
                "exit_price": exit_price,
                "fee": state.closed_fee,
                "fee_currency": state.fee_currency,
                "realized_pnl": state.realized_pnl,
                "invested_amount": notional if inst_type == "SPOT" else None,
                "order_id": state.last_order_id,
            })
            flip = abs(signed_trade) - closing_amount
            state.signed_amount = (1.0 if signed_trade > 0 else -1.0) * flip if flip > 1e-12 else 0.0
            state.average_price = trade.price if flip > 1e-12 else 0.0
            state.entry_timestamp_ms = trade.timestamp_ms if flip > 1e-12 else 0
            state.open_fee = trade.fee * (flip / abs(signed_trade)) if flip > 1e-12 else 0.0
            state.closed_amount = 0.0
            state.weighted_exit_total = 0.0
            state.realized_pnl = 0.0
            state.closed_fee = 0.0
            state.last_close_timestamp_ms = 0
            state.last_order_id = None
            state.fee_currency = None
    return positions, ignored_closes


def _fill_row(exchange_id: str, exchange_name: str, trade: _Trade, snapshot: Dict[str, Any], inst_type: str) -> Dict[str, Any]:
    direction = "Long" if _trade_sign(trade) > 0 else "Short"
    return {
        "datetime": _iso(trade.timestamp_ms),
        "symbol": trade.symbol,
        "timeframe": "4h",
        "direction": direction,
        "size": trade.amount,
        "entry_price": trade.price,
        "tags": f"{exchange_id},{inst_type.lower()}",
        "notes": f"{exchange_name} {inst_type} fill: {trade.side}",
        "source": f"{exchange_id}_fill",
        "external_id": trade.external_id,
        "exchange": exchange_name,
        "order_id": trade.order_id,
        "fee": trade.fee,
        "fee_currency": trade.fee_currency,
        "indicator_snapshot": snapshot,
        "created_at": _iso(int(datetime.now(timezone.utc).timestamp() * 1000)),
    }


def _position_row(exchange_id: str, exchange_name: str, position: Dict[str, Any], snapshot: Dict[str, Any], inst_type: str) -> Dict[str, Any]:
    entry_price = position["entry_price"]
    direction_sign = 1.0 if position["direction"] == "Long" else -1.0
    pnl_pct = ((position["exit_price"] - entry_price) / entry_price) * direction_sign * 100.0
    return {
        "datetime": _iso(position["timestamp_ms"]),
        "entry_datetime": _iso(position["entry_timestamp_ms"]),
        "symbol": position["symbol"],
        "timeframe": "4h",
        "direction": position["direction"],
        "size": position["size"],
        "entry_price": entry_price,
        "exit_price": position["exit_price"],
        "pnl_pct": pnl_pct,
        "outcome": "Win" if position["realized_pnl"] > 0 else "Loss" if position["realized_pnl"] < 0 else "Breakeven",
        "tags": f"{exchange_id},{inst_type.lower()},closed-position",
        "notes": f"{exchange_name} {inst_type} reconstructed closed position",
        "source": f"{exchange_id}_position",
        "external_id": position["external_id"],
        "exchange": exchange_name,
        "order_id": position["order_id"],
        "fee": position["fee"],
        "fee_currency": position["fee_currency"],
        "funding_fee": None,
        "realized_pnl": position["realized_pnl"],
        "leverage": None,
        "invested_amount": position["invested_amount"],
        "pnl_calculation_version": 2,
        "indicator_snapshot": snapshot,
        "created_at": _iso(int(datetime.now(timezone.utc).timestamp() * 1000)),
    }


def _sync_ccxt(exchange_id: str, inst_type: str, lookback_days: int, symbols: Sequence[str]) -> Dict[str, Any]:
    credentials = _credentials(exchange_id)
    if credentials is None:
        raise BusinessLogicError(f"{SUPPORTED_EXCHANGES[exchange_id]['name']} API credentials are not configured")
    client = _exchange_client(exchange_id, credentials, inst_type)
    try:
        client.load_markets()
        requested = _requested_symbols(exchange_id, symbols)
        since = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp() * 1000)
        raw_trades = _fetch_trades(client, requested, since)
    except ccxt.BaseError as exc:
        raise DataLoadError(f"{client.name} account data is temporarily unavailable") from exc
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()

    trades, ignored = _normalize_trades(exchange_id, client, raw_trades)
    positions, positions_ignored = _reconstruct_positions(exchange_id, trades, inst_type)
    events = [
        *[_SnapshotEvent(item.external_id, item.timestamp_ms, item.coin, "fill") for item in trades],
        *[_SnapshotEvent(item["external_id"], item["timestamp_ms"], item["coin"], "position_close") for item in positions],
    ]
    existing = existing_external_ids(event.external_id for event in events)
    new_events = [event for event in events if event.external_id not in existing]
    snapshots = build_indicator_snapshots(new_events) if new_events else {}
    for event in new_events:
        snapshot = snapshots.get(event.external_id)
        if snapshot:
            snapshot["reference"] = f"last_completed_candle_before_{exchange_id}_{event.event_type}"

    exchange_name = SUPPORTED_EXCHANGES[exchange_id]["name"]
    rows = [
        *[
            _fill_row(exchange_id, exchange_name, trade, snapshots.get(trade.external_id, {}), inst_type)
            for trade in trades if trade.external_id not in existing
        ],
        *[
            _position_row(exchange_id, exchange_name, position, snapshots.get(position["external_id"], {}), inst_type)
            for position in positions if position["external_id"] not in existing
        ],
    ]
    created = add_entries_if_new_external_ids(rows)
    imported = sum(1 for trade in trades if trade.external_id in created)
    positions_imported = sum(1 for position in positions if position["external_id"] in created)
    partial_snapshots = sum(
        1 for event in new_events
        if not snapshots.get(event.external_id, {}).get("timeframes")
        or not all(
            frame.get("status") == "complete"
            for frame in snapshots.get(event.external_id, {}).get("timeframes", {}).values()
            if isinstance(frame, dict)
        )
    )
    warnings = [
        "Closed positions are reconstructed from fills using net/hedge position side. "
        "Trades opened before the selected lookback may be incomplete."
    ]
    if inst_type == "SWAP":
        warnings.append("Funding and historical leverage are not supplied by the generic CCXT connector.")
    if partial_snapshots:
        warnings.append("Some imported records were saved with partial indicator snapshots.")
    return {"success": True, "data": {
        "exchange": exchange_id,
        "inst_type": inst_type,
        "lookback_days": lookback_days,
        "fetched": len(raw_trades),
        "imported": imported,
        "skipped": len(trades) - imported,
        "ignored": ignored,
        "complete_snapshots": len(new_events) - partial_snapshots,
        "partial_snapshots": partial_snapshots,
        "positions_fetched": len(positions),
        "positions_imported": positions_imported,
        "positions_updated": 0,
        "positions_skipped": len(positions) - positions_imported,
        "positions_ignored": positions_ignored,
        "warnings": warnings,
    }}


def sync_exchange_service(
    exchange_id: str,
    inst_type: str,
    lookback_days: int,
    symbols: Sequence[str],
) -> Dict[str, Any]:
    if exchange_id not in SUPPORTED_EXCHANGES:
        raise BusinessLogicError(f"Unsupported exchange: {exchange_id}")
    if inst_type not in SUPPORTED_EXCHANGES[exchange_id]["instrument_types"]:
        raise BusinessLogicError(f"{exchange_id} does not support {inst_type}")
    if exchange_id == "deepcoin":
        result = sync_deepcoin_fills_service(inst_type, lookback_days)
        result["data"]["exchange"] = "deepcoin"
        return result
    return _sync_ccxt(exchange_id, inst_type, lookback_days, symbols)


__all__ = [
    "SUPPORTED_EXCHANGES",
    "exchange_status_service",
    "sync_exchange_service",
]
