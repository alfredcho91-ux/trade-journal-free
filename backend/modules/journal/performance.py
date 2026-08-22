"""Canonical period-performance calculations for journal screens."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

from backend.modules.journal import repository
from backend.modules.journal.trade_selection import finite_float, timestamp_ms


def run_journal_performance_service(start_time: int, end_time: int) -> Dict[str, Any]:
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    entries = [
        entry for entry in repository.list_entries()
        if str(entry.get("source") or "").endswith("_position")
        and (close_time := timestamp_ms(entry.get("datetime"))) is not None
        and start_time <= close_time <= end_time
    ]
    ordered = sorted(entries, key=lambda item: timestamp_ms(item.get("datetime")) or 0)
    evaluated = [entry for entry in ordered if finite_float(entry.get("realized_pnl")) is not None]
    pnl_values = [float(entry["realized_pnl"]) for entry in evaluated]
    wins = [value for value in pnl_values if value > 0]
    losses = [value for value in pnl_values if value < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    return_values = [
        value for entry in evaluated
        if (value := _net_return_pct(entry)) is not None
    ]
    total_invested = sum(
        value for entry in evaluated
        if (value := _invested_amount(entry)) is not None
    )
    return_net_pnl = sum(
        float(entry["realized_pnl"])
        for entry in evaluated
        if _invested_amount(entry) is not None
    )
    best = max(evaluated, key=lambda item: float(item["realized_pnl"]), default=None)
    worst = min(evaluated, key=lambda item: float(item["realized_pnl"]), default=None)
    max_win_streak, max_loss_streak = _streaks(pnl_values)
    return {"success": True, "data": {
        "closed_trade_count": len(entries),
        "evaluated_trade_count": len(evaluated),
        "missing_pnl_count": len(entries) - len(evaluated),
        "wins": len(wins),
        "losses": len(losses),
        "breakevens": sum(value == 0 for value in pnl_values),
        "win_rate_pct": len(wins) / len(evaluated) * 100 if evaluated else None,
        "net_pnl": sum(pnl_values),
        "net_return_pct": return_net_pnl / total_invested * 100 if total_invested > 0 else None,
        "return_sample_count": len(return_values),
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "profit_factor": gross_profit / gross_loss if gross_loss > 0 else None,
        "profit_factor_infinite": gross_loss == 0 and gross_profit > 0,
        "average_win": sum(wins) / len(wins) if wins else None,
        "average_loss": sum(losses) / len(losses) if losses else None,
        "expectancy": sum(pnl_values) / len(evaluated) if evaluated else None,
        "fee_impact": -sum(abs(finite_float(entry.get("fee")) or 0.0) for entry in evaluated),
        "funding_impact": sum(finite_float(entry.get("funding_fee")) or 0.0 for entry in evaluated),
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "best_trade": _trade_reference(best),
        "worst_trade": _trade_reference(worst),
        "directions": [_group_stats(direction, rows) for direction, rows in _group_by(evaluated, "direction").items()],
        "symbols": sorted(
            (_group_stats(symbol, rows) for symbol, rows in _group_by(evaluated, "symbol").items()),
            key=lambda item: item["net_pnl"],
            reverse=True,
        ),
    }}


def _group_by(entries: Iterable[Dict[str, Any]], key: str) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        grouped[str(entry.get(key) or "-")].append(entry)
    return dict(grouped)


def _group_stats(label: str, entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    values = [float(entry["realized_pnl"]) for entry in entries]
    return {
        "id": label,
        "trade_count": len(entries),
        "wins": sum(value > 0 for value in values),
        "win_rate_pct": sum(value > 0 for value in values) / len(values) * 100 if values else None,
        "net_pnl": sum(values),
    }


def _trade_reference(entry: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if entry is None:
        return None
    return {
        "journal_id": int(entry["id"]),
        "symbol": entry.get("symbol"),
        "direction": entry.get("direction"),
        "realized_pnl": finite_float(entry.get("realized_pnl")),
    }


def _streaks(values: Iterable[float]) -> tuple[int, int]:
    max_win = max_loss = current_win = current_loss = 0
    for value in values:
        if value > 0:
            current_win, current_loss = current_win + 1, 0
            max_win = max(max_win, current_win)
        elif value < 0:
            current_loss, current_win = current_loss + 1, 0
            max_loss = max(max_loss, current_loss)
        else:
            current_win = current_loss = 0
    return max_win, max_loss


def _invested_amount(entry: Dict[str, Any]) -> Optional[float]:
    stored = finite_float(entry.get("invested_amount"))
    if stored is not None and stored > 0:
        return stored
    entry_price = finite_float(entry.get("entry_price"))
    exit_price = finite_float(entry.get("exit_price"))
    net_pnl = finite_float(entry.get("realized_pnl"))
    if None in (entry_price, exit_price, net_pnl) or entry_price <= 0:
        return None
    direction = -1.0 if entry.get("direction") == "Short" else 1.0
    price_return = ((exit_price - entry_price) / entry_price) * direction
    gross_pnl = net_pnl + abs(finite_float(entry.get("fee")) or 0.0) - (finite_float(entry.get("funding_fee")) or 0.0)
    if abs(price_return) <= math.ulp(1.0) or abs(gross_pnl) <= math.ulp(1.0):
        return None
    notional = abs(gross_pnl / price_return)
    leverage = finite_float(entry.get("leverage"))
    return notional / leverage if leverage is not None and leverage > 0 else None


def _net_return_pct(entry: Dict[str, Any]) -> Optional[float]:
    invested = _invested_amount(entry)
    pnl = finite_float(entry.get("realized_pnl"))
    return pnl / invested * 100 if invested is not None and pnl is not None else None


__all__ = ["run_journal_performance_service"]
