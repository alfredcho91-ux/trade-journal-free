"""CCXT client construction, history fetching, and trade normalization."""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import ccxt

from backend.modules.exchanges.models import ExchangeCredentials, NormalizedTrade, TradeFetchResult
from backend.utils.error_handler import BusinessLogicError, DataLoadError

MAX_TRADE_PAGES = 30
TRADE_PAGE_SIZE = 1000
BINANCE_TRADE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
BINANCE_INCOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000


def exchange_client(exchange_id: str, credentials: ExchangeCredentials, inst_type: str):
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


def requested_symbols(exchange_id: str, symbols: Sequence[str]) -> List[str]:
    configured = os.getenv(f"{exchange_id.upper()}_SYMBOLS", "")
    values = list(symbols) or configured.split(",")
    normalized = [value.strip() for value in values if value.strip()]
    if not normalized:
        raise BusinessLogicError(
            "At least one symbol is required (for example BTC/USDT). "
            f"Set {exchange_id.upper()}_SYMBOLS or enter symbols in the journal."
        )
    return list(dict.fromkeys(normalized))


def fetch_trades(client: Any, symbols: Sequence[str], since: int) -> TradeFetchResult:
    output: List[Dict[str, Any]] = []
    truncated_symbols: List[str] = []
    seen = set()
    for requested in symbols:
        symbol = _resolve_symbol(client, requested, "SWAP" if client.options.get("defaultType") == "swap" else "SPOT")
        windows = _trade_time_windows(client, since)
        page_count = 0
        stop_symbol = False
        for window_index, (window_start, window_end) in enumerate(windows):
            cursor = window_start
            window_complete = False
            while page_count < MAX_TRADE_PAGES:
                try:
                    if window_end is None:
                        page = client.fetch_my_trades(symbol, cursor, TRADE_PAGE_SIZE)
                    else:
                        page = client.fetch_my_trades(
                            symbol,
                            cursor,
                            TRADE_PAGE_SIZE,
                            {"until": window_end},
                        )
                except ccxt.BaseError as exc:
                    raise DataLoadError(f"{client.name} trade history is temporarily unavailable") from exc
                if not page:
                    window_complete = True
                    break
                page_count += 1
                newest = cursor
                new_records = 0
                for trade in page:
                    trade_id = str(trade.get("id") or "")
                    timestamp_ms = int(trade.get("timestamp") or 0)
                    unique_key = (symbol, trade_id or timestamp_ms, trade.get("order"), trade.get("side"))
                    if unique_key not in seen:
                        seen.add(unique_key)
                        output.append(trade)
                        new_records += 1
                    newest = max(newest, timestamp_ms)
                if len(page) < TRADE_PAGE_SIZE:
                    window_complete = True
                    break
                # CCXT `since` is commonly inclusive. Re-query the boundary timestamp
                # and deduplicate by exchange trade ID so fills sharing one millisecond
                # are not skipped by a `+1ms` cursor jump.
                if new_records == 0 or newest <= cursor:
                    truncated_symbols.append(symbol)
                    stop_symbol = True
                    break
                cursor = newest
            if stop_symbol:
                break
            if page_count >= MAX_TRADE_PAGES and (
                not window_complete or window_index < len(windows) - 1
            ):
                truncated_symbols.append(symbol)
                break
    return TradeFetchResult(
        trades=sorted(output, key=lambda item: int(item.get("timestamp") or 0)),
        truncated_symbols=truncated_symbols,
    )


def _trade_time_windows(client: Any, since: int) -> List[Tuple[int, Optional[int]]]:
    exchange_id = str(getattr(client, "id", "") or "").lower()
    is_swap = str(getattr(client, "options", {}).get("defaultType") or "").lower() == "swap"
    if exchange_id not in {"binance", "binanceusdm"} or not is_swap:
        return [(since, None)]
    end_time = int(time.time() * 1000)
    windows: List[Tuple[int, Optional[int]]] = []
    window_start = int(since)
    while window_start <= end_time:
        window_end = min(end_time, window_start + BINANCE_TRADE_WINDOW_MS - 1)
        windows.append((window_start, window_end))
        window_start = window_end + 1
    return windows or [(int(since), end_time)]


def normalize_trades(
    exchange_id: str,
    client: Any,
    raw_trades: Iterable[Dict[str, Any]],
) -> Tuple[List[NormalizedTrade], int]:
    trades: List[NormalizedTrade] = []
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
        fee_data = raw.get("fee") if isinstance(raw.get("fee"), dict) else None
        fee_cost_value = _finite(fee_data.get("cost")) if fee_data is not None else None
        fee_cost = abs(fee_cost_value or 0.0)
        fee_currency = str(fee_data.get("currency") or quote).upper() if fee_data is not None else ""
        if fee_cost_value is None:
            fee, normalized_fee_currency, fee_complete = 0.0, None, False
        elif fee_currency == coin:
            fee, normalized_fee_currency, fee_complete = fee_cost * price, quote, True
        elif fee_currency == quote:
            fee, normalized_fee_currency, fee_complete = fee_cost, quote, True
        else:
            fee, normalized_fee_currency, fee_complete = 0.0, None, False
        stable = str(raw.get("id") or "").strip() or _trade_digest(raw, timestamp_ms, symbol, side, amount, price)
        trades.append(NormalizedTrade(
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
            fee_complete=fee_complete,
        ))
    return trades, ignored


def fetch_binance_funding_income(
    client: Any,
    since: int,
    until: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], int, bool]:
    """Fetch complete USD-M funding income in bounded Binance time windows."""
    endpoint = getattr(client, "fapiPrivateGetIncome", None)
    if not callable(endpoint):
        raise DataLoadError("Binance funding history is unavailable")

    end_time = int(until if until is not None else time.time() * 1000)
    coverage_start = max(0, int(since))
    events: List[Dict[str, Any]] = []
    seen = set()
    truncated = False
    window_start = coverage_start
    while window_start <= end_time:
        window_end = min(end_time, window_start + BINANCE_INCOME_WINDOW_MS - 1)
        cursor = window_start
        for page_index in range(MAX_TRADE_PAGES):
            page = endpoint({
                "incomeType": "FUNDING_FEE",
                "startTime": cursor,
                "endTime": window_end,
                "limit": TRADE_PAGE_SIZE,
            })
            if not isinstance(page, list) or not page:
                break
            newest = cursor
            new_records = 0
            for raw in page:
                timestamp_ms = int(raw.get("time") or 0)
                income = _finite(raw.get("income"))
                symbol = _income_symbol(client, raw.get("symbol"))
                asset = str(raw.get("asset") or "").upper() or None
                unique_key = str(raw.get("tranId") or "").strip() or (
                    timestamp_ms,
                    symbol,
                    raw.get("income"),
                    str(raw.get("info")),
                )
                if timestamp_ms <= 0 or income is None or symbol is None or unique_key in seen:
                    continue
                seen.add(unique_key)
                events.append({
                    "timestamp_ms": timestamp_ms,
                    "symbol": symbol,
                    "income": income,
                    "asset": asset,
                })
                newest = max(newest, timestamp_ms)
                new_records += 1
            if len(page) < TRADE_PAGE_SIZE:
                break
            if new_records == 0 or newest <= cursor:
                truncated = True
                break
            cursor = newest
            if page_index == MAX_TRADE_PAGES - 1:
                truncated = True
        window_start = window_end + 1
    return sorted(events, key=lambda item: item["timestamp_ms"]), coverage_start, truncated


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


def _finite(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _position_side(raw: Dict[str, Any]) -> Optional[str]:
    info = raw.get("info") if isinstance(raw.get("info"), dict) else {}
    value = str(info.get("positionSide") or info.get("posSide") or "").strip().upper()
    return value if value in {"LONG", "SHORT"} else None


def _income_symbol(client: Any, value: Any) -> Optional[str]:
    market_id = str(value or "").strip()
    if not market_id:
        return None
    safe_symbol = getattr(client, "safe_symbol", None)
    if callable(safe_symbol):
        try:
            symbol = str(safe_symbol(market_id) or "")
            if "/" in symbol:
                return symbol.split(":", 1)[0].upper()
        except (KeyError, TypeError, ValueError):
            pass
    normalized = market_id.upper().replace("-", "")
    for quote in ("USDT", "USDC", "BUSD"):
        if normalized.endswith(quote) and len(normalized) > len(quote):
            return f"{normalized[:-len(quote)]}/{quote}"
    return None


def _trade_digest(raw: Dict[str, Any], timestamp_ms: int, symbol: str, side: str, amount: float, price: float) -> str:
    return hashlib.sha256(json.dumps({
        "timestamp": timestamp_ms,
        "symbol": symbol,
        "side": side,
        "amount": amount,
        "price": price,
        "order": raw.get("order"),
    }, sort_keys=True).encode("utf-8")).hexdigest()


__all__ = [
    "exchange_client",
    "fetch_binance_funding_income",
    "fetch_trades",
    "normalize_trades",
    "requested_symbols",
]
