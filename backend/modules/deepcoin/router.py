"""HTTP endpoints for read-only Deepcoin journal synchronization."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from backend.modules.deepcoin.schemas import (
    DeepcoinOpenPositionsEnvelope,
    DeepcoinStatusEnvelope,
    DeepcoinSyncEnvelope,
    DeepcoinSyncRequest,
    DeepcoinTradeMarkersEnvelope,
)
from backend.modules.deepcoin.service import (
    get_deepcoin_open_positions_service,
    get_deepcoin_status_service,
    get_deepcoin_trade_markers_service,
    sync_deepcoin_fills_service,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/deepcoin", tags=["deepcoin"])


@router.get("/status", response_model=DeepcoinStatusEnvelope)
@handle_api_errors()
async def api_deepcoin_status():
    """Return only whether server-side Deepcoin read credentials are configured."""
    return await run_in_threadpool(get_deepcoin_status_service)


@router.get("/open-positions", response_model=DeepcoinOpenPositionsEnvelope)
@handle_api_errors()
async def api_deepcoin_open_positions():
    """Return current non-zero positions using server-side credentials only."""
    return await run_in_threadpool(get_deepcoin_open_positions_service)


@router.get("/trade-markers", response_model=DeepcoinTradeMarkersEnvelope)
@handle_api_errors()
async def api_deepcoin_trade_markers(
    symbol: str = Query(min_length=3),
    direction: Literal["Long", "Short"] = Query(),
    entry_time: datetime = Query(),
    exit_time: datetime = Query(),
    entry_price: float = Query(gt=0),
):
    """Return confirmed TP trigger events for one completed position."""
    return await run_in_threadpool(
        get_deepcoin_trade_markers_service,
        symbol,
        direction,
        entry_time.isoformat(),
        exit_time.isoformat(),
        entry_price,
    )


@router.post("/sync", response_model=DeepcoinSyncEnvelope)
@handle_api_errors()
async def api_deepcoin_sync(request: DeepcoinSyncRequest):
    """Read fills from Deepcoin and persist idempotent journal records."""
    return await run_in_threadpool(
        sync_deepcoin_fills_service,
        request.inst_type,
        request.lookback_days,
    )
