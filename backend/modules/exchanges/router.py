"""HTTP endpoints shared by every read-only exchange connector."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.exchanges.schemas import (
    ExchangeCredentialsRequest,
    ExchangeId,
    ExchangeListEnvelope,
    ExchangeSyncEnvelope,
    ExchangeSyncRequest,
)
from backend.modules.exchanges.service import configure_exchange_credentials_service, exchange_status_service, sync_exchange_service
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/exchanges", tags=["exchanges"])


@router.get("", response_model=ExchangeListEnvelope)
@handle_api_errors()
async def api_exchange_statuses():
    """List built-in connectors without exposing any credentials."""
    return await run_in_threadpool(exchange_status_service)


@router.post("/{exchange_id}/credentials", response_model=ExchangeListEnvelope)
@handle_api_errors()
async def api_exchange_credentials(exchange_id: ExchangeId, request: ExchangeCredentialsRequest):
    """Verify and save local read-only credentials without returning secrets."""
    return await run_in_threadpool(
        configure_exchange_credentials_service,
        exchange_id,
        request.api_key,
        request.secret_key,
        request.passphrase,
    )


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
