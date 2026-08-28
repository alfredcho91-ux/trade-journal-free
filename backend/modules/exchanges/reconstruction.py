"""Reconstruct complete positions from normalized exchange executions."""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from backend.modules.exchanges.models import NormalizedTrade, PositionState


def trade_sign(trade: NormalizedTrade) -> float:
    if trade.position_side == "LONG":
        return trade.amount if trade.side == "buy" else -trade.amount
    if trade.position_side == "SHORT":
        return -trade.amount if trade.side == "sell" else trade.amount
    return trade.amount if trade.side == "buy" else -trade.amount


def exchange_account_scope(exchange_id: str, api_key: str) -> str:
    """Return a non-secret local account namespace for deterministic lifecycle IDs."""
    return hashlib.sha256(f"{exchange_id}|{api_key}".encode("utf-8")).hexdigest()[:16]


def _execution_order_key(trade: NormalizedTrade) -> Tuple[int, int, Any, str]:
    identifier = str(trade.external_id).rsplit(":", 1)[-1]
    if identifier.isdigit():
        return trade.timestamp_ms, 0, int(identifier), trade.external_id
    return trade.timestamp_ms, 1, identifier, trade.external_id


def reconstruct_position_lifecycles(
    exchange_id: str,
    trades: Sequence[NormalizedTrade],
    inst_type: str,
    *,
    account_scope: str = "local",
    skip_uncertain_initial_lifecycle: bool = False,
    ignored_external_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    states: Dict[Tuple[str, str], PositionState] = {}
    uncertain_keys: set[Tuple[str, str]] = set()
    positions: List[Dict[str, Any]] = []
    ignored_closes = 0
    for trade in sorted(trades, key=_execution_order_key):
        key = (trade.symbol, trade.position_side or "NET")
        if key not in states:
            states[key] = PositionState()
            if skip_uncertain_initial_lifecycle:
                uncertain_keys.add(key)
        state = states[key]
        signed_trade = trade_sign(trade)
        if inst_type == "SPOT" and abs(state.signed_amount) <= 1e-12 and signed_trade < 0:
            ignored_closes += 1
            continue
        if abs(state.signed_amount) <= 1e-12 or state.signed_amount * signed_trade > 0:
            previous, added = abs(state.signed_amount), abs(signed_trade)
            state.average_price = (
                (state.average_price * previous + trade.price * added) / (previous + added)
                if previous > 0 else trade.price
            )
            if not state.entry_timestamp_ms:
                state.entry_timestamp_ms = trade.timestamp_ms
                state.entry_external_id = trade.external_id
            state.entry_amount_total += added
            state.weighted_entry_total += trade.price * added
            state.signed_amount += signed_trade
            state.open_fee += trade.fee
            state.fee_complete = state.fee_complete and trade.fee_complete
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
        gross_pnl = (trade.price - state.average_price) * closing_amount * trade.contract_size * direction_sign
        total_fee = allocated_open_fee + close_fee
        state.closed_amount += closing_amount
        state.weighted_exit_total += trade.price * closing_amount
        state.realized_pnl += gross_pnl - total_fee
        state.closed_fee += total_fee
        state.last_close_timestamp_ms = trade.timestamp_ms
        state.last_order_id = trade.order_id
        state.fee_currency = trade.fee_currency or state.fee_currency
        state.fee_complete = state.fee_complete and trade.fee_complete
        old_sign = 1.0 if state.signed_amount > 0 else -1.0
        remainder = abs(state.signed_amount) - closing_amount
        state.open_fee -= allocated_open_fee
        if remainder > 1e-12:
            state.signed_amount = old_sign * remainder
            continue

        lifecycle_entry_price = state.weighted_entry_total / state.entry_amount_total
        notional = lifecycle_entry_price * state.closed_amount * trade.contract_size
        external_id = _position_external_id(exchange_id, key, state, trade)
        lifecycle_id = _position_lifecycle_id(exchange_id, account_scope, key, state)
        if key in uncertain_keys:
            # The local ledger may start with a close from a position opened
            # before the selected sync window. The first complete lifecycle is
            # therefore not safe to publish as a reconstructed trade.
            uncertain_keys.remove(key)
            ignored_closes += 1
            if ignored_external_ids is not None:
                ignored_external_ids.add(external_id)
        else:
            positions.append({
                "external_id": external_id,
                "lifecycle_id": lifecycle_id,
                "entry_external_id": state.entry_external_id,
                "timestamp_ms": state.last_close_timestamp_ms,
                "entry_timestamp_ms": state.entry_timestamp_ms,
                "symbol": trade.symbol,
                "coin": trade.coin,
                "direction": direction,
                "size": state.closed_amount,
                "entry_price": lifecycle_entry_price,
                "exit_price": state.weighted_exit_total / state.closed_amount,
                "fee": state.closed_fee,
                "fee_currency": state.fee_currency,
                "fee_complete": state.fee_complete,
                "realized_pnl": state.realized_pnl,
                "invested_amount": notional if inst_type == "SPOT" else None,
                "order_id": state.last_order_id,
            })
        flip = abs(signed_trade) - closing_amount
        state.signed_amount = (1.0 if signed_trade > 0 else -1.0) * flip if flip > 1e-12 else 0.0
        state.average_price = trade.price if flip > 1e-12 else 0.0
        state.entry_amount_total = flip
        state.weighted_entry_total = trade.price * flip
        state.entry_timestamp_ms = trade.timestamp_ms if flip > 1e-12 else 0
        state.entry_external_id = trade.external_id if flip > 1e-12 else ""
        state.open_fee = trade.fee * (flip / abs(signed_trade)) if flip > 1e-12 else 0.0
        state.closed_amount = state.weighted_exit_total = state.realized_pnl = state.closed_fee = 0.0
        state.last_close_timestamp_ms = 0
        state.last_order_id = state.fee_currency = None
        state.fee_complete = trade.fee_complete if flip > 1e-12 else True
    open_positions = []
    for key, state in states.items():
        if abs(state.signed_amount) <= 1e-12 or not state.entry_external_id:
            continue
        direction = "Long" if state.signed_amount > 0 else "Short"
        open_positions.append({
            "lifecycle_id": _position_lifecycle_id(exchange_id, account_scope, key, state),
            "symbol": key[0],
            "position_side": key[1],
            "direction": direction,
            "size": abs(state.signed_amount),
            "average_price": state.average_price,
            "entry_timestamp_ms": state.entry_timestamp_ms,
            "entry_external_id": state.entry_external_id,
            "identity_verified": key not in uncertain_keys,
        })
    return positions, open_positions, ignored_closes


def reconstruct_positions(
    exchange_id: str,
    trades: Sequence[NormalizedTrade],
    inst_type: str,
    *,
    account_scope: str = "local",
    skip_uncertain_initial_lifecycle: bool = False,
    ignored_external_ids: Optional[Set[str]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    positions, _, ignored = reconstruct_position_lifecycles(
        exchange_id,
        trades,
        inst_type,
        account_scope=account_scope,
        skip_uncertain_initial_lifecycle=skip_uncertain_initial_lifecycle,
        ignored_external_ids=ignored_external_ids,
    )
    return positions, ignored


def restore_normalized_trades(
    rows: Sequence[Dict[str, Any]], inst_type: str, symbols: Sequence[str],
) -> List[NormalizedTrade]:
    """Restore the persisted fill ledger for sync and live lifecycle reconstruction."""
    restored: List[NormalizedTrade] = []
    requested = {str(symbol).upper().replace("-", "/").split(":", 1)[0] for symbol in symbols}
    for row in rows:
        if row.get("inst_type") != inst_type or not row.get("actual_side") or str(row.get("symbol")).upper() not in requested:
            continue
        try:
            timestamp_ms = int(datetime.fromisoformat(str(row["datetime"]).replace("Z", "+00:00")).timestamp() * 1000)
            restored.append(NormalizedTrade(
                external_id=str(row["external_id"]), timestamp_ms=timestamp_ms,
                symbol=str(row["symbol"]), coin=str(row["symbol"]).split("/", 1)[0].upper(),
                side=str(row["actual_side"]), amount=float(row["size"]), price=float(row["entry_price"]),
                fee=float(row.get("fee") or 0.0), fee_currency=row.get("fee_currency"),
                order_id=row.get("order_id"), position_side=row.get("position_side"),
                contract_size=float(row.get("contract_size") or 1.0),
                fee_complete=bool(row.get("fee_complete", True)),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(restored, key=_execution_order_key)


def _position_external_id(
    exchange_id: str,
    key: Tuple[str, str],
    state: PositionState,
    trade: NormalizedTrade,
) -> str:
    digest = hashlib.sha256(
        f"{exchange_id}|{key[0]}|{key[1]}|{state.entry_timestamp_ms}|{trade.external_id}".encode("utf-8")
    ).hexdigest()
    return f"{exchange_id}:position:{digest}"


def _position_lifecycle_id(
    exchange_id: str,
    account_scope: str,
    key: Tuple[str, str],
    state: PositionState,
) -> str:
    direction = "LONG" if state.signed_amount > 0 else "SHORT"
    digest = hashlib.sha256(
        f"{exchange_id}|{account_scope}|{key[0]}|{key[1]}|{direction}|{state.entry_external_id}".encode("utf-8")
    ).hexdigest()
    return f"{exchange_id}:lifecycle:{digest}"


__all__ = [
    "reconstruct_position_lifecycles",
    "reconstruct_positions",
    "restore_normalized_trades",
    "exchange_account_scope",
    "trade_sign",
]
