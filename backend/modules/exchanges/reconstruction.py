"""Reconstruct complete positions from normalized exchange executions."""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Sequence, Tuple

from backend.modules.exchanges.models import NormalizedTrade, PositionState


def trade_sign(trade: NormalizedTrade) -> float:
    if trade.position_side == "LONG":
        return trade.amount if trade.side == "buy" else -trade.amount
    if trade.position_side == "SHORT":
        return -trade.amount if trade.side == "sell" else trade.amount
    return trade.amount if trade.side == "buy" else -trade.amount


def reconstruct_positions(
    exchange_id: str,
    trades: Sequence[NormalizedTrade],
    inst_type: str,
) -> Tuple[List[Dict[str, Any]], int]:
    states: Dict[Tuple[str, str], PositionState] = {}
    positions: List[Dict[str, Any]] = []
    ignored_closes = 0
    for trade in trades:
        key = (trade.symbol, trade.position_side or "NET")
        state = states.setdefault(key, PositionState())
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
        positions.append({
            "external_id": _position_external_id(exchange_id, key, state, trade),
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
    return positions, ignored_closes


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


__all__ = ["reconstruct_positions", "trade_sign"]
