"""Orchestrate CCXT execution import and closed-position persistence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Sequence

import ccxt

from backend.modules.deepcoin.snapshot import build_indicator_snapshots
from backend.modules.exchanges.ccxt_adapter import fetch_trades, normalize_trades, requested_symbols
from backend.modules.exchanges.execution_repository import add_executions_if_new, list_executions
from backend.modules.exchanges.models import NormalizedTrade, SnapshotEvent
from backend.modules.exchanges.reconstruction import reconstruct_positions, trade_sign
from backend.modules.exchanges.registry import SUPPORTED_EXCHANGES
from backend.modules.journal.repository import add_entries_if_new_external_ids, delete_imported_positions
from backend.utils.error_handler import DataLoadError


def sync_ccxt(exchange_id: str, inst_type: str, lookback_days: int, symbols: Sequence[str], client: Any) -> Dict[str, Any]:
    try:
        client.load_markets()
        requested = requested_symbols(exchange_id, symbols)
        since = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp() * 1000)
        fetch_result = fetch_trades(client, requested, since)
    except ccxt.BaseError as exc:
        raise DataLoadError(f"{client.name} account data is temporarily unavailable") from exc
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()

    trades, ignored = normalize_trades(exchange_id, client, fetch_result.trades)
    exchange_name = SUPPORTED_EXCHANGES[exchange_id]["name"]
    execution_rows = [
        _execution_row(exchange_id, exchange_name, trade, None, inst_type)
        for trade in trades
    ]
    imported_execution_ids = add_executions_if_new(execution_rows)
    stored_trades = _stored_trades(list_executions(exchange=exchange_name), inst_type, requested)
    positions, positions_ignored = reconstruct_positions(exchange_id, stored_trades, inst_type)

    snapshot_events = [
        *[
            SnapshotEvent(position["entry_external_id"], position["entry_timestamp_ms"], position["coin"], "position_entry")
            for position in positions
        ],
        *[
            SnapshotEvent(position["external_id"], position["timestamp_ms"], position["coin"], "position_close")
            for position in positions
        ],
    ]
    snapshots = build_indicator_snapshots(snapshot_events) if snapshot_events else {}
    for event in snapshot_events:
        snapshot = snapshots.get(event.external_id)
        if snapshot:
            snapshot["reference"] = f"last_completed_candle_before_{exchange_id}_{event.event_type}"

    # Keep compact raw execution records useful for chart review without making
    # snapshots a prerequisite for reconstruction on the first import.
    if trades:
        add_executions_if_new([
            _execution_row(exchange_id, exchange_name, trade, snapshots.get(trade.external_id), inst_type)
            for trade in trades
        ])

    position_rows = [
        _position_row(exchange_id, exchange_name, position, snapshots.get(position["external_id"], {}), inst_type)
        for position in positions
    ]
    replaced_count = delete_imported_positions(exchange_id, exchange_name, [trade.symbol for trade in stored_trades])
    created_positions = add_entries_if_new_external_ids(position_rows)
    incomplete_fee_count = sum(1 for position in positions if not position.get("fee_complete", True))

    partial_snapshots = sum(
        1 for event in snapshot_events
        if not snapshots.get(event.external_id, {}).get("timeframes")
        or not all(
            frame.get("status") == "complete"
            for frame in snapshots.get(event.external_id, {}).get("timeframes", {}).values()
            if isinstance(frame, dict)
        )
    )
    warnings = [
        "Closed positions are rebuilt from the locally stored execution ledger using net/hedge position side. "
        "The first sync for a symbol may be incomplete if its opening fills predate the downloaded history."
    ]
    if inst_type == "SWAP":
        warnings.append("Funding and historical leverage are not supplied by the generic CCXT connector.")
    if incomplete_fee_count:
        warnings.append(
            f"{incomplete_fee_count} reconstructed position(s) include a fee currency that could not be converted to quote currency."
        )
    if partial_snapshots:
        warnings.append("Some imported positions were saved with partial entry or exit indicator snapshots.")
    if fetch_result.truncated_symbols:
        warnings.append(
            "Trade history reached the 30,000-fill safety limit for: " + ", ".join(fetch_result.truncated_symbols)
        )
    return {"success": True, "data": {
        "exchange": exchange_id,
        "inst_type": inst_type,
        "lookback_days": lookback_days,
        "fetched": len(fetch_result.trades),
        "imported": len(imported_execution_ids),
        "skipped": len(trades) - len(imported_execution_ids),
        "ignored": ignored,
        "complete_snapshots": len(snapshot_events) - partial_snapshots,
        "partial_snapshots": partial_snapshots,
        "positions_fetched": len(positions),
        "positions_imported": len(created_positions),
        "positions_updated": replaced_count,
        "positions_skipped": 0,
        "positions_ignored": positions_ignored,
        "warnings": warnings,
    }}


def _stored_trades(rows: Sequence[Dict[str, Any]], inst_type: str, symbols: Sequence[str]) -> list[NormalizedTrade]:
    """Restore normalized executions so repeated syncs use one local history ledger."""
    restored: list[NormalizedTrade] = []
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
    return sorted(restored, key=lambda trade: (trade.timestamp_ms, trade.external_id))


def _iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _execution_row(
    exchange_id: str,
    exchange_name: str,
    trade: NormalizedTrade,
    snapshot: Optional[Dict[str, Any]],
    inst_type: str,
) -> Dict[str, Any]:
    return {
        "external_id": trade.external_id,
        "datetime": _iso(trade.timestamp_ms),
        "symbol": trade.symbol,
        "direction": "Long" if trade_sign(trade) > 0 else "Short",
        "size": trade.amount,
        "entry_price": trade.price,
        "source": f"{exchange_id}_fill",
        "exchange": exchange_name,
        "order_id": trade.order_id,
        "notes": f"{exchange_name} {inst_type} fill: {trade.side}",
        "fee": trade.fee,
        "fee_currency": trade.fee_currency,
        "indicator_snapshot": snapshot,
        "created_at": _iso(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "actual_side": trade.side,
        "position_side": trade.position_side,
        "contract_size": trade.contract_size,
        "inst_type": inst_type,
        "fee_complete": trade.fee_complete,
    }


def _position_row(
    exchange_id: str,
    exchange_name: str,
    position: Dict[str, Any],
    snapshot: Dict[str, Any],
    inst_type: str,
) -> Dict[str, Any]:
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
        "notes": (
            f"{exchange_name} {inst_type} reconstructed closed position"
            + ("; some fee currencies were not converted" if not position.get("fee_complete", True) else "")
        ),
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


__all__ = ["sync_ccxt"]
