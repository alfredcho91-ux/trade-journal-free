"""Strategy Playbook HTTP endpoints."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.strategies.schemas import (
    StrategyCreate,
    StrategyEnvelope,
    StrategyListEnvelope,
    StrategyUpdate,
    StrategyVersionCreate,
    StrategyVersionEnvelope,
    StrategyVersionListEnvelope,
)
from backend.modules.strategies.service import (
    activate_version_service,
    archive_strategy_service,
    create_strategy_service,
    create_version_service,
    get_strategy_service,
    get_version_service,
    list_strategies_service,
    list_versions_service,
    restore_strategy_service,
    retire_version_service,
    update_strategy_service,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api", tags=["strategies"])


@router.get("/strategies", response_model=StrategyListEnvelope)
@handle_api_errors()
async def api_list_strategies(include_archived: bool = False):
    return await run_in_threadpool(list_strategies_service, include_archived)


@router.post("/strategies", response_model=StrategyEnvelope)
@handle_api_errors()
async def api_create_strategy(payload: StrategyCreate):
    return await run_in_threadpool(create_strategy_service, payload.model_dump())


@router.get("/strategies/{strategy_id}", response_model=StrategyEnvelope)
@handle_api_errors()
async def api_get_strategy(strategy_id: int):
    return await run_in_threadpool(get_strategy_service, strategy_id)


@router.patch("/strategies/{strategy_id}", response_model=StrategyEnvelope)
@handle_api_errors()
async def api_update_strategy(strategy_id: int, payload: StrategyUpdate):
    return await run_in_threadpool(
        update_strategy_service,
        strategy_id,
        payload.model_dump(exclude_unset=True),
    )


@router.post("/strategies/{strategy_id}/archive", response_model=StrategyEnvelope)
@handle_api_errors()
async def api_archive_strategy(strategy_id: int):
    return await run_in_threadpool(archive_strategy_service, strategy_id)


@router.post("/strategies/{strategy_id}/restore", response_model=StrategyEnvelope)
@handle_api_errors()
async def api_restore_strategy(strategy_id: int):
    return await run_in_threadpool(restore_strategy_service, strategy_id)


@router.get(
    "/strategies/{strategy_id}/versions",
    response_model=StrategyVersionListEnvelope,
)
@handle_api_errors()
async def api_list_strategy_versions(strategy_id: int):
    return await run_in_threadpool(list_versions_service, strategy_id)


@router.post(
    "/strategies/{strategy_id}/versions",
    response_model=StrategyVersionEnvelope,
)
@handle_api_errors()
async def api_create_strategy_version(strategy_id: int, payload: StrategyVersionCreate):
    return await run_in_threadpool(
        create_version_service, strategy_id, payload.model_dump()
    )


@router.get(
    "/strategies/{strategy_id}/versions/{version_id}",
    response_model=StrategyVersionEnvelope,
)
@handle_api_errors()
async def api_get_strategy_version(strategy_id: int, version_id: int):
    return await run_in_threadpool(get_version_service, strategy_id, version_id)


@router.post(
    "/strategies/{strategy_id}/versions/{version_id}/activate",
    response_model=StrategyVersionEnvelope,
)
@handle_api_errors()
async def api_activate_strategy_version(strategy_id: int, version_id: int):
    return await run_in_threadpool(
        activate_version_service, strategy_id, version_id
    )


@router.post(
    "/strategies/{strategy_id}/versions/{version_id}/retire",
    response_model=StrategyVersionEnvelope,
)
@handle_api_errors()
async def api_retire_strategy_version(strategy_id: int, version_id: int):
    return await run_in_threadpool(retire_version_service, strategy_id, version_id)
