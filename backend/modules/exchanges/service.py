"""Public service boundary for read-only exchange connectors."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import ccxt

from backend.config.settings import DeepcoinCredentials
from backend.modules.deepcoin.service import DeepcoinClient, sync_deepcoin_fills_service
from backend.modules.exchanges.ccxt_adapter import exchange_client
from backend.modules.exchanges.credentials import (
    CredentialStorageError,
    delete_exchange_credentials,
    load_exchange_credentials,
    resolve_exchange_credentials,
    save_local_exchange_credentials,
)
from backend.modules.exchanges.execution_repository import list_executions
from backend.modules.exchanges.models import ExchangeCredentials, NormalizedTrade
from backend.modules.exchanges.reconstruction import reconstruct_positions
from backend.modules.exchanges.registry import SUPPORTED_EXCHANGES
from backend.modules.exchanges.sync_service import sync_ccxt
from backend.utils.error_handler import BusinessLogicError, DataLoadError
from backend.utils.log_redaction import register_sensitive_values

_exchange_client = exchange_client

# Only these connectors are presented as officially supported by the free release.
PUBLIC_SUPPORTED_EXCHANGES = ("deepcoin", "binance")


def _credentials(exchange_id: str) -> Optional[ExchangeCredentials]:
    stored = load_exchange_credentials(exchange_id)
    if stored is None:
        return None
    if SUPPORTED_EXCHANGES[exchange_id]["requires_passphrase"] and not stored.passphrase:
        return None
    return ExchangeCredentials(stored.api_key, stored.secret_key, stored.passphrase)


def exchange_status_service() -> Dict[str, Any]:
    statuses = []
    for exchange_id in PUBLIC_SUPPORTED_EXCHANGES:
        definition = SUPPORTED_EXCHANGES[exchange_id]
        resolved = resolve_exchange_credentials(exchange_id)
        configured = resolved.credentials is not None and (
            not definition["requires_passphrase"] or bool(resolved.credentials.passphrase)
        )
        statuses.append({
            "id": exchange_id,
            "configured": configured,
            "mode": "read_only",
            "credential_source": resolved.source,
            "credential_error": resolved.storage_error,
            **definition,
        })
    return {"success": True, "data": {"exchanges": statuses}}


def configure_exchange_credentials_service(
    exchange_id: str,
    api_key: str,
    secret_key: str,
    passphrase: str = "",
) -> Dict[str, Any]:
    """Verify read access before persisting credentials in a protected store."""
    definition = SUPPORTED_EXCHANGES[exchange_id]
    if definition["requires_passphrase"] and not passphrase.strip():
        raise BusinessLogicError(
            f"{definition['name']} requires a passphrase",
            error_code="EXCHANGE_PASSPHRASE_REQUIRED",
        )
    credentials = ExchangeCredentials(api_key.strip(), secret_key.strip(), passphrase.strip())
    register_sensitive_values(credentials.api_key, credentials.secret_key, credentials.passphrase)
    try:
        if exchange_id == "deepcoin":
            from backend.modules.deepcoin.service import DeepcoinClient

            DeepcoinClient(DeepcoinCredentials(
                credentials.api_key, credentials.secret_key, credentials.passphrase
            )).get_fills(inst_type="SWAP", lookback_days=1)
        else:
            client = _exchange_client(exchange_id, credentials, "SPOT")
            client.fetch_balance()
    except (ccxt.BaseError, DataLoadError, ValueError, AttributeError) as exc:
        raise BusinessLogicError(
            "Connection could not be verified. Check the API key, passphrase, IP allowlist, and read permission.",
            error_code="EXCHANGE_CONNECTION_FAILED",
        ) from exc
    try:
        save_local_exchange_credentials(
            exchange_id, credentials.api_key, credentials.secret_key, credentials.passphrase
        )
    except (CredentialStorageError, OSError, ValueError) as exc:
        raise BusinessLogicError(
            "Credentials could not be saved in the configured protected store.",
            error_code="EXCHANGE_CREDENTIAL_SAVE_FAILED",
        ) from exc
    return exchange_status_service()


def delete_exchange_credentials_service(exchange_id: str) -> Dict[str, Any]:
    result = delete_exchange_credentials(exchange_id)
    statuses = exchange_status_service()["data"]["exchanges"]
    return {
        "success": True,
        "data": {
            "exchanges": statuses,
            "deleted": result.deleted,
            "environment_override": result.environment_override,
        },
    }


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
    credentials = _credentials(exchange_id)
    if credentials is None:
        raise BusinessLogicError(f"{SUPPORTED_EXCHANGES[exchange_id]['name']} API credentials are not configured")
    return sync_ccxt(
        exchange_id,
        inst_type,
        lookback_days,
        symbols,
        _exchange_client(exchange_id, credentials, inst_type),
    )


def exchange_executions_service(
    exchange: Optional[str] = None,
    symbol: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
) -> Dict[str, Any]:
    return {"success": True, "data": list_executions(
        exchange=exchange,
        symbol=symbol,
        start_time=start_time,
        end_time=end_time,
    )}


def _finite(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and result not in {float("inf"), float("-inf")} else None


def _timestamp_iso(value: Any) -> Optional[str]:
    numeric = _finite(value)
    if numeric is None or numeric <= 0:
        return None
    if numeric < 10_000_000_000:
        numeric *= 1000
    return datetime.fromtimestamp(numeric / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _display_symbol(raw: Any) -> str:
    symbol = str(raw or "").upper().replace("-", "/")
    return symbol.split(":", 1)[0].replace("/USDT/SWAP", "/USDT")


def _deepcoin_open_positions(credentials: ExchangeCredentials) -> List[Dict[str, Any]]:
    positions = []
    for raw in DeepcoinClient(DeepcoinCredentials(credentials.api_key, credentials.secret_key, credentials.passphrase)).get_open_positions():
        side = str(raw.get("posSide") or "").lower()
        size = _finite(raw.get("pos"))
        symbol = _display_symbol(raw.get("instId"))
        if side not in {"long", "short"} or size is None or size <= 0 or "/" not in symbol:
            continue
        times = [value for value in (_timestamp_iso(raw.get("cTime")), _timestamp_iso(raw.get("uTime"))) if value]
        positions.append({
            "position_id": str(raw.get("posId") or f"deepcoin:{symbol}:{side}"),
            "exchange": "deepcoin",
            "symbol": symbol,
            "direction": "Long" if side == "long" else "Short",
            "size": size,
            "average_price": _finite(raw.get("avgPx")),
            "last_price": _finite(raw.get("lastPx")),
            "unrealized_pnl": _finite(raw.get("unrealizedProfit")),
            "leverage": _finite(raw.get("lever")),
            "opened_at": min(times) if times else None,
            "updated_at": max(times) if times else None,
        })
    return positions


def _ccxt_open_positions(exchange_id: str, credentials: ExchangeCredentials) -> List[Dict[str, Any]]:
    client = _exchange_client(exchange_id, credentials, "SWAP")
    try:
        client.load_markets()
        if not bool(getattr(client, "has", {}).get("fetchPositions")):
            raise DataLoadError(f"{client.name} open-position lookup is unavailable")
        output = []
        for raw in client.fetch_positions():
            contracts = _finite(raw.get("contracts"))
            side = str(raw.get("side") or "").lower()
            if contracts is None or contracts <= 0 or side not in {"long", "short"}:
                continue
            symbol = _display_symbol(raw.get("symbol"))
            if "/" not in symbol:
                continue
            info = raw.get("info") if isinstance(raw.get("info"), dict) else {}
            output.append({
                "position_id": str(raw.get("id") or info.get("positionIdx") or f"{exchange_id}:{symbol}:{side}"),
                "exchange": exchange_id,
                "symbol": symbol,
                "direction": "Long" if side == "long" else "Short",
                "size": contracts,
                "average_price": _finite(raw.get("entryPrice")),
                "last_price": _finite(raw.get("markPrice")),
                "unrealized_pnl": _finite(raw.get("unrealizedPnl")),
                "leverage": _finite(raw.get("leverage")),
                "opened_at": _timestamp_iso(raw.get("timestamp") or info.get("createdTime")),
                "updated_at": _timestamp_iso(raw.get("timestamp") or info.get("updatedTime")),
            })
        return output
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def exchange_open_positions_service() -> Dict[str, Any]:
    """Return current SWAP positions only; no historic fill is treated as open."""
    positions: List[Dict[str, Any]] = []
    unavailable: List[str] = []
    for exchange_id in SUPPORTED_EXCHANGES:
        try:
            credentials = _credentials(exchange_id)
            if credentials is None:
                continue
            if exchange_id == "deepcoin":
                positions.extend(_deepcoin_open_positions(credentials))
            else:
                positions.extend(_ccxt_open_positions(exchange_id, credentials))
        except (ccxt.BaseError, CredentialStorageError, DataLoadError, ValueError, AttributeError, OSError):
            unavailable.append(exchange_id)
    positions.sort(key=lambda item: (item["exchange"], item["symbol"], item["direction"]))
    return {"success": True, "data": {"positions": positions, "unavailable_exchanges": unavailable}}


# Compatibility exports for downstream tests and extensions.
_Credentials = ExchangeCredentials
_Trade = NormalizedTrade
_reconstruct_positions = reconstruct_positions

__all__ = [
    "SUPPORTED_EXCHANGES",
    "configure_exchange_credentials_service",
    "delete_exchange_credentials_service",
    "exchange_executions_service",
    "exchange_open_positions_service",
    "exchange_status_service",
    "sync_exchange_service",
]
