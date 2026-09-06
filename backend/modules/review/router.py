"""Typed read-only historical review endpoints."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.review.schemas import CurrentPeriodRequest, DiagnosisEnvelope, PatternEnvelope, ReviewRequest, TradingEnvelope
from backend.modules.review.service import pattern_review, strategy_execution_review, trading_review
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/review", tags=["review"])


@router.post("/trading", response_model=TradingEnvelope)
@handle_api_errors()
async def api_trading_review(payload: ReviewRequest):
    return (await run_in_threadpool(trading_review, payload)).model_dump(mode="json")


@router.post("/patterns", response_model=PatternEnvelope)
@handle_api_errors()
async def api_pattern_review(payload: CurrentPeriodRequest):
    return (await run_in_threadpool(pattern_review, payload)).model_dump(mode="json")


@router.post("/strategy-execution", response_model=DiagnosisEnvelope)
@handle_api_errors()
async def api_strategy_execution_review(payload: CurrentPeriodRequest):
    return (await run_in_threadpool(strategy_execution_review, payload)).model_dump(mode="json")
