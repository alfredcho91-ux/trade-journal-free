"""Public service boundary for read-only exchange connectors."""

from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

import ccxt

from backend.config.settings import DeepcoinCredentials
from backend.modules.deepcoin.service import sync_deepcoin_fills_service
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


def _credentials(exchange_id: str) -> Optional[ExchangeCredentials]:
    stored = load_exchange_credentials(exchange_id)
    if stored is None:
        return None
    if SUPPORTED_EXCHANGES[exchange_id]["requires_passphrase"] and not stored.passphrase:
        return None
    return ExchangeCredentials(stored.api_key, stored.secret_key, stored.passphrase)


def exchange_status_service() -> Dict[str, Any]:
    statuses = []
    for exchange_id, definition in SUPPORTED_EXCHANGES.items():
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


# Compatibility exports for downstream tests and extensions.
_Credentials = ExchangeCredentials
_Trade = NormalizedTrade
_reconstruct_positions = reconstruct_positions

__all__ = [
    "SUPPORTED_EXCHANGES",
    "configure_exchange_credentials_service",
    "delete_exchange_credentials_service",
    "exchange_executions_service",
    "exchange_status_service",
    "sync_exchange_service",
]
