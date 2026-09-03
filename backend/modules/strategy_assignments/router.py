"""HTTP endpoints for Journal StrategyVersion assignments."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.strategy_assignments.schemas import (
    StrategyAssignmentEnvelope,
    StrategyAssignmentPut,
)
from backend.modules.strategy_assignments.service import (
    delete_assignment_service,
    get_assignment_service,
    put_assignment_service,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api", tags=["strategy-assignments"])


@router.get(
    "/journal/{journal_entry_id}/strategy-version",
    response_model=StrategyAssignmentEnvelope,
)
@handle_api_errors()
async def api_get_journal_strategy_version(journal_entry_id: int):
    return await run_in_threadpool(get_assignment_service, journal_entry_id)


@router.put(
    "/journal/{journal_entry_id}/strategy-version",
    response_model=StrategyAssignmentEnvelope,
)
@handle_api_errors()
async def api_put_journal_strategy_version(
    journal_entry_id: int, payload: StrategyAssignmentPut,
):
    return await run_in_threadpool(
        put_assignment_service,
        journal_entry_id,
        payload.strategy_version_id,
    )


@router.delete(
    "/journal/{journal_entry_id}/strategy-version",
    response_model=StrategyAssignmentEnvelope,
)
@handle_api_errors()
async def api_delete_journal_strategy_version(journal_entry_id: int):
    return await run_in_threadpool(delete_assignment_service, journal_entry_id)
