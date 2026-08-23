"""HTTP endpoints shared by every read-only exchange connector."""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

from backend.modules.exchanges.schemas import (
    ExchangeCredentialsRequest,
    ExchangeCredentialDeleteEnvelope,
    ExchangeExecutionEnvelope,
    ExchangeOpenPositionsEnvelope,
    ExchangeId,
    ExchangeListEnvelope,
    ExchangeSyncEnvelope,
    ExchangeSyncRequest,
)
from backend.modules.exchanges.service import (
    configure_exchange_credentials_service,
    delete_exchange_credentials_service,
    exchange_executions_service,
    exchange_open_positions_service,
    exchange_status_service,
    sync_exchange_service,
)
from backend.utils.decorators import handle_api_errors
from backend.utils.transport_security import require_secure_credential_transport

router = APIRouter(prefix="/api/exchanges", tags=["exchanges"])


@router.get("", response_model=ExchangeListEnvelope)
@handle_api_errors()
async def api_exchange_statuses():
    """List built-in connectors without exposing any credentials."""
    return await run_in_threadpool(exchange_status_service)


@router.get("/executions", response_model=ExchangeExecutionEnvelope)
@handle_api_errors()
async def api_exchange_executions(
    exchange: Optional[str] = None,
    symbol: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
):
    """Return compact execution markers for one trade review window."""
    return await run_in_threadpool(
        exchange_executions_service,
        exchange,
        symbol,
        start_time,
        end_time,
    )


@router.get("/open-positions", response_model=ExchangeOpenPositionsEnvelope)
@handle_api_errors()
async def api_exchange_open_positions():
    """List confirmed current SWAP positions from configured exchanges."""
    return await run_in_threadpool(exchange_open_positions_service)


@router.post("/{exchange_id}/credentials", response_model=ExchangeListEnvelope)
@handle_api_errors()
async def api_exchange_credentials(
    exchange_id: ExchangeId,
    payload: ExchangeCredentialsRequest,
    request: Request,
):
    """Verify and save local read-only credentials without returning secrets."""
    require_secure_credential_transport(request)
    return await run_in_threadpool(
        configure_exchange_credentials_service,
        exchange_id,
        payload.api_key,
        payload.secret_key,
        payload.passphrase,
    )


@router.delete("/{exchange_id}/credentials", response_model=ExchangeCredentialDeleteEnvelope)
@handle_api_errors()
async def api_delete_exchange_credentials(exchange_id: ExchangeId, request: Request):
    """Remove persisted credentials for one exchange."""
    require_secure_credential_transport(request)
    return await run_in_threadpool(delete_exchange_credentials_service, exchange_id)


@router.post("/{exchange_id}/sync", response_model=ExchangeSyncEnvelope)
@handle_api_errors()
async def api_exchange_sync(exchange_id: ExchangeId, request: ExchangeSyncRequest):
    """Import read-only fills and reconstructed closed positions."""
    return await run_in_threadpool(
        sync_exchange_service,
        exchange_id,
        request.inst_type,
        request.lookback_days,
        request.symbols,
    )
