"""Local historical analysis, immutable evidence and explicit Playbook registration."""

from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Header, Path, Query
from fastapi.concurrency import run_in_threadpool

from backend.modules.strategy_discovery import adoption, feature_policy, repository, service
from backend.modules.strategy_discovery.schemas import (
    AdoptionEnvelope, AdoptionRequest, CandidateEnvelope, EvidenceEnvelope,
    RunEnvelope, RunPageEnvelope, RunRequest,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/strategy-discovery", tags=["strategy-discovery"])
Identifier = Annotated[int, Path(gt=0)]
RequestKey = Annotated[UUID, Header(alias="Idempotency-Key")]
Offset = Annotated[int, Query(ge=0)]
PageSize = Annotated[int, Query(ge=1, le=50)]


@router.get("/metadata")
@handle_api_errors()
async def metadata():
    return {"success": True, "data": feature_policy.metadata()}


@router.post("/runs", response_model=RunEnvelope)
@handle_api_errors()
async def create_run(payload: RunRequest, key: RequestKey):
    return {"success": True, "data": await run_in_threadpool(service.create_run, payload, str(key))}


@router.get("/runs", response_model=RunPageEnvelope)
@handle_api_errors()
async def list_runs(offset: Offset = 0, limit: PageSize = 20):
    return {"success": True, "data": await run_in_threadpool(repository.list_runs, offset, limit)}


@router.get("/runs/{identifier}", response_model=RunEnvelope)
@handle_api_errors()
async def get_run(identifier: Identifier):
    return {"success": True, "data": await run_in_threadpool(repository.get_run, identifier)}


@router.get("/candidates/{identifier}", response_model=CandidateEnvelope)
@handle_api_errors()
async def get_candidate(identifier: Identifier):
    return {"success": True, "data": await run_in_threadpool(repository.get_candidate, identifier)}


@router.get("/candidates/{identifier}/evidence", response_model=EvidenceEnvelope)
@handle_api_errors()
async def get_evidence(identifier: Identifier, offset: Offset = 0, limit: PageSize = 50):
    return {"success": True, "data": await run_in_threadpool(service.evidence, identifier, offset, limit)}


@router.post("/candidates/{identifier}/adopt", response_model=AdoptionEnvelope)
@handle_api_errors()
async def adopt(identifier: Identifier, payload: AdoptionRequest, key: RequestKey):
    return {"success": True, "data": await run_in_threadpool(adoption.adopt, identifier, payload, str(key))}
