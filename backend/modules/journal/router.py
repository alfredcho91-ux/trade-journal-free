"""Trading Journal API router."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from backend.modules.journal.schemas import (
    JournalCurrentMarketEnvelope,
    JournalDeleteEnvelope,
    JournalExcursionEnvelope,
    JournalExcursionQuery,
    JournalListEnvelope,
    JournalPerformanceEnvelope,
    JournalQualityEnvelope,
    JournalQualityQuery,
    JournalSlTpEnvelope,
    JournalSlTpQuery,
    JournalStopLossEnvelope,
    JournalStopOptimizationEnvelope,
)
from backend.modules.journal.analysis import run_journal_excursions_service
from backend.modules.journal.performance import run_journal_performance_service
from backend.modules.journal.current_market import run_current_market_snapshot_service
from backend.modules.journal.quality_analysis import run_journal_quality_analysis_service
from backend.modules.journal.sl_tp_analysis import run_journal_sl_tp_analysis_service
from backend.modules.journal.stop_loss_analysis import run_journal_stop_loss_analysis_service
from backend.modules.journal.stop_optimization import run_journal_stop_optimization_service
from backend.modules.journal.service import delete_journal_service, get_journal_service
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api", tags=["journal"])


@router.get("/journal", response_model=JournalListEnvelope)
@handle_api_errors()
async def api_get_journal():
    """Get all journal entries."""
    return await run_in_threadpool(get_journal_service)


@router.get("/journal/performance", response_model=JournalPerformanceEnvelope)
@handle_api_errors()
async def api_get_journal_performance(query: Annotated[JournalExcursionQuery, Depends()]):
    """Return canonical period performance used by journal and analysis screens."""
    return await run_in_threadpool(run_journal_performance_service, query.start_time, query.end_time)


@router.get("/journal/current-market", response_model=JournalCurrentMarketEnvelope)
@handle_api_errors()
async def api_get_journal_current_market(coin: str):
    """Return the current completed-candle snapshot used for trade similarity."""
    return await run_in_threadpool(run_current_market_snapshot_service, coin)


@router.get("/journal/excursions", response_model=JournalExcursionEnvelope)
@handle_api_errors()
async def api_get_journal_excursions(query: Annotated[JournalExcursionQuery, Depends()]):
    """Calculate post-entry MFE/MAE for closed positions in a selected period."""
    return await run_in_threadpool(
        run_journal_excursions_service,
        query.start_time,
        query.end_time,
    )


@router.get("/journal/quality-analysis", response_model=JournalQualityEnvelope)
@handle_api_errors()
async def api_get_journal_quality_analysis(query: Annotated[JournalQualityQuery, Depends()]):
    """Analyze point-in-time market regimes and exit quality for closed positions."""
    return await run_in_threadpool(
        run_journal_quality_analysis_service,
        query.start_time,
        query.end_time,
        query.min_abs_net_return_pct,
    )


@router.get("/journal/stop-loss-analysis", response_model=JournalStopLossEnvelope)
@handle_api_errors()
async def api_get_journal_stop_loss_analysis(query: Annotated[JournalExcursionQuery, Depends()]):
    """Analyze confirmed stop-loss outcomes using only post-stop 4H candles."""
    return await run_in_threadpool(
        run_journal_stop_loss_analysis_service,
        query.start_time,
        query.end_time,
    )


@router.get("/journal/stop-optimization", response_model=JournalStopOptimizationEnvelope)
@handle_api_errors()
async def api_get_journal_stop_optimization(query: Annotated[JournalExcursionQuery, Depends()]):
    """Find fixed-percent and ATR stop ranges with chronological validation."""
    return await run_in_threadpool(
        run_journal_stop_optimization_service,
        query.start_time,
        query.end_time,
    )


@router.get("/journal/sl-tp-analysis", response_model=JournalSlTpEnvelope)
@handle_api_errors()
async def api_get_journal_sl_tp_analysis(query: Annotated[JournalSlTpQuery, Depends()]):
    """Simulate adjustable SL/TP grids over each closed trade's 5m path."""
    return await run_in_threadpool(
        run_journal_sl_tp_analysis_service,
        query.start_time,
        query.end_time,
        query.sl_min,
        query.sl_max,
        query.sl_step,
        query.tp_min,
        query.tp_max,
        query.tp_step,
    )


@router.delete("/journal/{entry_id}", response_model=JournalDeleteEnvelope)
@handle_api_errors()
async def api_delete_journal(entry_id: int):
    """Delete a journal entry."""
    return await run_in_threadpool(delete_journal_service, entry_id)
