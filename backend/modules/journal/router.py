"""Trading Journal API router."""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from backend.modules.journal.schemas import (
    JournalBehaviorComparisonRequest,
    JournalBehaviorEnvelope,
    JournalBehaviorQuery,
    JournalBehaviorRuleCreate,
    JournalBehaviorRuleEnvelope,
    JournalBehaviorRulesEnvelope,
    JournalBehaviorRuleUpdate,
    JournalBehaviorUpdate,
    JournalBehaviorUpdateEnvelope,
    JournalCurrentMarketEnvelope,
    DailyJournalEnvelope,
    DailyJournalListEnvelope,
    DailyJournalRangeQuery,
    DailyJournalUpsert,
    JournalDeleteEnvelope,
    JournalExitHoldEnvelope,
    JournalExitHoldQuery,
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
from backend.modules.journal.behavior_analysis import (
    run_journal_behavior_analysis_service,
    run_journal_behavior_comparison_service,
)
from backend.modules.journal.performance import run_journal_performance_service
from backend.modules.journal.current_market import run_current_market_snapshot_service
from backend.modules.journal.quality_analysis import run_journal_quality_analysis_service
from backend.modules.journal.exit_hold_analysis import run_journal_exit_hold_analysis_service
from backend.modules.journal.sl_tp_analysis import run_journal_sl_tp_analysis_service
from backend.modules.journal.stop_loss_analysis import run_journal_stop_loss_analysis_service
from backend.modules.journal.stop_optimization import run_journal_stop_optimization_service
from backend.modules.journal.repository import (
    create_behavior_rule,
    delete_behavior_rule,
    list_behavior_rules,
    update_behavior_rule,
)
from backend.modules.journal.service import (
    delete_daily_journal_service,
    delete_journal_service,
    get_daily_journal_service,
    get_journal_service,
    list_daily_journals_service,
    upsert_daily_journal_service,
    update_journal_behavior_service,
)
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


@router.get("/journal/exit-hold-analysis", response_model=JournalExitHoldEnvelope)
@handle_api_errors()
async def api_get_journal_exit_hold_analysis(query: Annotated[JournalExitHoldQuery, Depends()]):
    """Replay post-exit holding results on a selected completed-candle interval."""
    return await run_in_threadpool(
        run_journal_exit_hold_analysis_service,
        query.start_time,
        query.end_time,
        query.interval,
        query.min_abs_net_return_pct,
    )


@router.get("/journal/behavior-analysis", response_model=JournalBehaviorEnvelope)
@handle_api_errors()
async def api_get_journal_behavior_analysis(query: Annotated[JournalBehaviorQuery, Depends()]):
    return await run_in_threadpool(
        run_journal_behavior_analysis_service,
        query.start_time,
        query.end_time,
        query.min_abs_net_return_pct,
    )


@router.post("/journal/behavior-analysis/compare", response_model=JournalBehaviorEnvelope)
@handle_api_errors()
async def api_compare_journal_behavior(payload: JournalBehaviorComparisonRequest):
    return await run_in_threadpool(
        run_journal_behavior_comparison_service,
        payload.start_time,
        payload.end_time,
        payload.left.model_dump(),
        payload.right.model_dump(),
        payload.min_abs_net_return_pct,
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


@router.get("/journal/daily", response_model=DailyJournalListEnvelope)
@handle_api_errors()
async def api_list_daily_journals(query: Annotated[DailyJournalRangeQuery, Depends()]):
    if query.start_date is not None and query.end_date is not None and query.start_date > query.end_date:
        raise ValueError("start_date must be on or before end_date")
    start_date = query.start_date.isoformat() if query.start_date is not None else None
    end_date = query.end_date.isoformat() if query.end_date is not None else None
    return await run_in_threadpool(list_daily_journals_service, start_date, end_date)


@router.get("/journal/daily/{trade_date}", response_model=DailyJournalEnvelope)
@handle_api_errors()
async def api_get_daily_journal(trade_date: date):
    return await run_in_threadpool(get_daily_journal_service, trade_date.isoformat())


@router.put("/journal/daily/{trade_date}", response_model=DailyJournalEnvelope)
@handle_api_errors()
async def api_upsert_daily_journal(trade_date: date, payload: DailyJournalUpsert):
    return await run_in_threadpool(
        upsert_daily_journal_service,
        trade_date.isoformat(),
        payload.model_dump(exclude_unset=True),
    )


@router.delete("/journal/daily/{trade_date}", response_model=JournalDeleteEnvelope)
@handle_api_errors()
async def api_delete_daily_journal(trade_date: date):
    return await run_in_threadpool(delete_daily_journal_service, trade_date.isoformat())


@router.delete("/journal/{entry_id}", response_model=JournalDeleteEnvelope)
@handle_api_errors()
async def api_delete_journal(entry_id: int):
    """Delete a journal entry."""
    return await run_in_threadpool(delete_journal_service, entry_id)


@router.patch("/journal/{entry_id}/behavior", response_model=JournalBehaviorUpdateEnvelope)
@handle_api_errors()
async def api_update_journal_behavior(entry_id: int, payload: JournalBehaviorUpdate):
    data = payload.model_dump(exclude_unset=True)
    has_plan = any(
        data.get(field) not in (None, "")
        for field in ("planned_stop_pct", "planned_target_pct", "planned_entry_reason")
    )
    if has_plan:
        data["plan_recorded_at"] = datetime.now(timezone.utc).isoformat()
    return await run_in_threadpool(update_journal_behavior_service, entry_id, data)


@router.get("/journal/behavior-rules", response_model=JournalBehaviorRulesEnvelope)
@handle_api_errors()
async def api_list_journal_behavior_rules():
    return {"success": True, "data": await run_in_threadpool(list_behavior_rules)}


@router.post("/journal/behavior-rules", response_model=JournalBehaviorRuleEnvelope)
@handle_api_errors()
async def api_create_journal_behavior_rule(payload: JournalBehaviorRuleCreate):
    return {"success": True, "data": await run_in_threadpool(create_behavior_rule, payload.model_dump())}


@router.patch("/journal/behavior-rules/{rule_id}", response_model=JournalBehaviorRuleEnvelope)
@handle_api_errors()
async def api_update_journal_behavior_rule(rule_id: int, payload: JournalBehaviorRuleUpdate):
    rule = await run_in_threadpool(update_behavior_rule, rule_id, payload.model_dump(exclude_unset=True))
    if rule is None:
        return {"success": False, "error": "Behavior rule not found"}
    return {"success": True, "data": rule}


@router.delete("/journal/behavior-rules/{rule_id}", response_model=JournalDeleteEnvelope)
@handle_api_errors()
async def api_delete_journal_behavior_rule(rule_id: int):
    deleted = await run_in_threadpool(delete_behavior_rule, rule_id)
    if not deleted:
        return {"success": False, "error": "Behavior rule not found"}
    return {"success": True, "message": "Behavior rule deleted"}
