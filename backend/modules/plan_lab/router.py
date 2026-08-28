"""Plan Lab HTTP endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.modules.plan_lab.analysis import run_plan_lab_service
from backend.modules.plan_lab.repository import (
    add_in_trade_revision, add_revision, create_in_trade_plan, create_plan, create_retrospective_plan,
    get_plan, link_plan, list_plans, update_status,
)
from backend.modules.plan_lab.schemas import (
    InTradePlanCreate, InTradePlanRevisionCreate, PlanCreate, PlanEnvelope, PlanLabEnvelope,
    PlanLabQuery, PlanLinkRequest, PlanListEnvelope, PlanRevisionCreate, PlanStatusUpdate,
    RetrospectivePlanCreate,
)
from backend.modules.exchanges.service import exchange_open_positions_service
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api", tags=["plan-lab"])


def _confirmed_open_position(exchange: str, position_id: str):
    """Read the live account state again on the server; never trust the client lifecycle."""
    result = exchange_open_positions_service().get("data") or {}
    for position in result.get("positions") or []:
        if (
            str(position.get("exchange") or "").lower() == exchange.lower()
            and str(position.get("position_id") or "") == position_id
        ):
            if exchange.lower() == "binance" and not bool(position.get("lifecycle_available")):
                raise HTTPException(
                    status_code=409,
                    detail="Binance lifecycle identity is unavailable. Synchronize fills before saving an in-trade plan.",
                )
            return position
    raise HTTPException(
        status_code=409,
        detail="The position is no longer open. Synchronize closed trades, then record it as retrospective.",
    )


@router.get("/plans", response_model=PlanListEnvelope)
@handle_api_errors()
async def api_list_plans():
    return {"success": True, "data": await run_in_threadpool(list_plans)}


@router.post("/plans", response_model=PlanEnvelope)
@handle_api_errors()
async def api_create_plan(payload: PlanCreate):
    return {"success": True, "data": await run_in_threadpool(create_plan, payload.model_dump())}


@router.post("/plans/retrospective", response_model=PlanEnvelope)
@handle_api_errors()
async def api_create_retrospective_plan(payload: RetrospectivePlanCreate):
    from backend.modules.journal import repository as journal_repository

    entries = {int(item["id"]): item for item in await run_in_threadpool(journal_repository.list_entries)}
    entry = entries.get(payload.journal_entry_id)
    if (
        entry is None
        or not str(entry.get("source") or "").endswith("_position")
        or not entry.get("entry_datetime")
        or not entry.get("datetime")
        or entry.get("entry_price") is None
        or entry.get("exit_price") is None
    ):
        raise HTTPException(status_code=404, detail="Closed journal trade not found")
    plan_payload = {
        "exchange": str(entry.get("exchange") or "binance"),
        "symbol": str(entry.get("symbol") or ""),
        "side": entry.get("direction"),
        "revision": payload.revision.model_dump(),
    }
    return {
        "success": True,
        "data": await run_in_threadpool(
            create_retrospective_plan, plan_payload, payload.journal_entry_id,
        ),
    }


@router.post("/plans/in-trade", response_model=PlanEnvelope)
@handle_api_errors()
async def api_create_in_trade_plan(payload: InTradePlanCreate):
    position = await run_in_threadpool(_confirmed_open_position, payload.exchange, payload.position_id)
    plan_payload = {
        "exchange": str(position.get("exchange") or payload.exchange),
        "position_id": str(position.get("position_id") or payload.position_id),
        "symbol": str(position.get("symbol") or ""),
        "side": position.get("direction"),
        "revision": payload.revision.model_dump(),
    }
    return {
        "success": True,
        "data": await run_in_threadpool(create_in_trade_plan, plan_payload, position),
    }


@router.get("/plans/{plan_id}", response_model=PlanEnvelope)
@handle_api_errors()
async def api_get_plan(plan_id: int):
    try:
        plan = await run_in_threadpool(get_plan, plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Plan not found") from exc
    return {"success": True, "data": plan}


@router.post("/plans/{plan_id}/revisions", response_model=PlanEnvelope)
@handle_api_errors()
async def api_add_plan_revision(plan_id: int, payload: PlanRevisionCreate):
    plan = await run_in_threadpool(add_revision, plan_id, payload.model_dump())
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True, "data": plan}


@router.post("/plans/{plan_id}/in-trade-revisions", response_model=PlanEnvelope)
@handle_api_errors()
async def api_add_in_trade_revision(plan_id: int, payload: InTradePlanRevisionCreate):
    try:
        plan = await run_in_threadpool(get_plan, plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Plan not found") from exc
    if plan.get("source") != "IN_TRADE" or not plan.get("live_position_id"):
        raise HTTPException(status_code=409, detail="This plan is not linked to an open position")
    position = await run_in_threadpool(
        _confirmed_open_position, str(plan.get("exchange") or ""), str(plan.get("live_position_id") or ""),
    )
    updated = await run_in_threadpool(add_in_trade_revision, plan_id, payload.model_dump(), position)
    if updated is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True, "data": updated}


@router.post("/plans/{plan_id}/link", response_model=PlanEnvelope)
@handle_api_errors()
async def api_link_plan(plan_id: int, payload: PlanLinkRequest):
    return {"success": True, "data": await run_in_threadpool(link_plan, plan_id, payload.journal_entry_id)}


@router.patch("/plans/{plan_id}/status", response_model=PlanEnvelope)
@handle_api_errors()
async def api_update_plan_status(plan_id: int, payload: PlanStatusUpdate):
    plan = await run_in_threadpool(update_status, plan_id, payload.status)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True, "data": plan}


@router.get("/plan-lab", response_model=PlanLabEnvelope)
@handle_api_errors()
async def api_plan_lab(query: Annotated[PlanLabQuery, Depends()]):
    return await run_in_threadpool(
        run_plan_lab_service,
        query.start_time,
        query.end_time,
        query.direction,
        query.setup,
        query.symbol,
        query.plan_source,
    )
