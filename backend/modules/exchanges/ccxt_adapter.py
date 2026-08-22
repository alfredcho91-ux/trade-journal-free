"""CCXT client construction, history fetching, and trade normalization."""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import ccxt

from backend.modules.exchanges.models import ExchangeCredentials, NormalizedTrade, TradeFetchResult
from backend.utils.error_handler import BusinessLogicError, DataLoadError

MAX_TRADE_PAGES = 30
TRADE_PAGE_SIZE = 1000


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
        cursor = since
        for page_index in range(MAX_TRADE_PAGES):
            try:
                page = client.fetch_my_trades(symbol, cursor, TRADE_PAGE_SIZE)
            except ccxt.BaseError as exc:
                raise DataLoadError(f"{client.name} trade history is temporarily unavailable") from exc
            if not page:
                break
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
                break
            # CCXT `since` is commonly inclusive. Re-query the boundary timestamp
            # and deduplicate by exchange trade ID so fills sharing one millisecond
            # are not skipped by a `+1ms` cursor jump.
            if new_records == 0:
                truncated_symbols.append(symbol)
                break
            cursor = newest
            if page_index == MAX_TRADE_PAGES - 1:
                truncated_symbols.append(symbol)
    return TradeFetchResult(
        trades=sorted(output, key=lambda item: int(item.get("timestamp") or 0)),
        truncated_symbols=truncated_symbols,
    )


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
        fee_data = raw.get("fee") if isinstance(raw.get("fee"), dict) else {}
        fee_cost = abs(_finite(fee_data.get("cost")) or 0.0)
        fee_currency = str(fee_data.get("currency") or quote).upper()
        if fee_currency == coin:
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


def _trade_digest(raw: Dict[str, Any], timestamp_ms: int, symbol: str, side: str, amount: float, price: float) -> str:
    return hashlib.sha256(json.dumps({
        "timestamp": timestamp_ms,
        "symbol": symbol,
        "side": side,
        "amount": amount,
        "price": price,
        "order": raw.get("order"),
    }, sort_keys=True).encode("utf-8")).hexdigest()


__all__ = ["exchange_client", "fetch_trades", "normalize_trades", "requested_symbols"]
