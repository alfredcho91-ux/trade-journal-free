"""Canonical invested-capital and net-return policy for closed positions."""

import math
from typing import Any, Mapping, Optional

from backend.modules.journal.trade_selection import finite_float


def closed_position_invested_amount(entry: Mapping[str, Any]) -> Optional[float]:
    stored = finite_float(entry.get("invested_amount"))
    if stored is not None and stored > 0:
        return stored

    entry_price = finite_float(entry.get("entry_price"))
    exit_price = finite_float(entry.get("exit_price"))
    net_pnl = finite_float(entry.get("realized_pnl"))
    if None in (entry_price, exit_price, net_pnl) or entry_price <= 0:
        return None

    price_return = ((exit_price - entry_price) / entry_price) * (-1.0 if entry.get("direction") == "Short" else 1.0)
    gross_pnl = net_pnl + abs(finite_float(entry.get("fee")) or 0.0) - (finite_float(entry.get("funding_fee")) or 0.0)
    if abs(price_return) <= math.ulp(1.0) or abs(gross_pnl) <= math.ulp(1.0):
        return None

    leverage = finite_float(entry.get("leverage"))
    return abs(gross_pnl / price_return) / leverage if leverage is not None and leverage > 0 else None


def closed_position_net_return_pct(entry: Mapping[str, Any]) -> Optional[float]:
    invested = closed_position_invested_amount(entry)
    pnl = finite_float(entry.get("realized_pnl"))
    return pnl / invested * 100 if invested is not None and pnl is not None else None
