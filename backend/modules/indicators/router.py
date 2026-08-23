import logging
from typing import Annotated, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from backend.modules.indicators.schemas import (
    IndicatorProjectionEnvelope,
    TradeReportEnvelope,
    TradeReportQueryParams,
    VPVREnvelope,
    VPVRQueryParams,
    VPVRSourceEnvelope,
    VPVRSourcePathParams,
    VPVRSourceQueryParams,
)
from backend.modules.indicators.service import (
    run_indicator_projection_service,
    run_trade_report_service,
    run_vpvr_service,
    run_vpvr_source_service,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/indicators", tags=["indicators"])
logger = logging.getLogger(__name__)


@router.get(
    "/trade-report/{coin}/{interval}",
    operation_id="get_historical_trade_report",
    response_model=TradeReportEnvelope,
)
@handle_api_errors()
async def get_trade_report(
    path: Annotated[VPVRSourcePathParams, Depends()],
    query: Annotated[TradeReportQueryParams, Depends()],
) -> Dict[str, object]:
    """Return candles, momentum series, and point-in-time VPVR/VWAP references."""
    return await run_in_threadpool(
        run_trade_report_service,
        path.coin,
        path.interval,
        query.limit,
        query.end_time,
        query.as_of,
        query.profile_candles,
        query.bin_count,
        query.exchange,
        query.instrument_type,
    )


@router.get("/projection", response_model=IndicatorProjectionEnvelope)
async def get_projection(
    coin: str = Query(..., description="Coin symbol (e.g., BTCUSDT)"),
    interval: str = Query("1h", description="Time interval (e.g., 1h, 4h, 1d)")
) -> Dict[str, object]:
    """
    현재 가격 기준으로 특정 지표(RSI, Stoch)에 도달하기 위한 예상 가격을 반환합니다.
    """
    try:
        result = await run_in_threadpool(run_indicator_projection_service, coin, interval)
        return {
            "success": True,
            "coin": coin,
            "interval": interval,
            "data": result
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Indicator projection failed")
        raise HTTPException(status_code=500, detail="An unexpected error occurred")


@router.get(
    "/vpvr-source/{coin}/{interval}",
    operation_id="get_binance_vpvr_source",
    response_model=VPVRSourceEnvelope,
)
@handle_api_errors()
async def get_vpvr_source(
    path: Annotated[VPVRSourcePathParams, Depends()],
    query: Annotated[VPVRSourceQueryParams, Depends()],
) -> Dict[str, object]:
    """Return normalized Binance OHLCV candles for a VPVR implementation."""
    return await run_in_threadpool(
        run_vpvr_source_service,
        path.coin,
        path.interval,
        query.candles,
    )


@router.get(
    "/vpvr/{coin}/{interval}",
    operation_id="get_binance_vpvr",
    response_model=VPVREnvelope,
)
@handle_api_errors()
async def get_vpvr(
    path: Annotated[VPVRSourcePathParams, Depends()],
    query: Annotated[VPVRQueryParams, Depends()],
) -> Dict[str, object]:
    """Return a price-bin volume profile calculated from Binance klines."""
    return await run_in_threadpool(
        run_vpvr_service,
        path.coin,
        path.interval,
        query.candles,
        query.bin_count,
        query.price_range,
    )
