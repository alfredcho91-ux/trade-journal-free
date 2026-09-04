"""HTTP route for current reconstructed Strategy rule evaluation."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.rule_engine.schemas import (
    JournalStrategyEvaluationEnvelope,
    RuleEngineMetadataEnvelope,
)
from backend.modules.rule_engine.service import (
    get_rule_engine_metadata_service,
    get_strategy_evaluation_service,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api", tags=["rule-engine"])


@router.get(
    "/rule-engine/metadata",
    response_model=RuleEngineMetadataEnvelope,
)
async def api_get_rule_engine_metadata():
    return get_rule_engine_metadata_service()


@router.get(
    "/journal/{journal_entry_id}/strategy-evaluation",
    response_model=JournalStrategyEvaluationEnvelope,
)
@handle_api_errors()
async def api_get_journal_strategy_evaluation(journal_entry_id: int):
    return await run_in_threadpool(
        get_strategy_evaluation_service,
        journal_entry_id,
    )


__all__ = ["router"]
