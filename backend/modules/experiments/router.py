"""Bounded definition resource and explicit state transition API."""
from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from backend.modules.experiments import repository, service
from backend.modules.experiments.schemas import (
    DraftUpdate, ExperimentDefinition, ExperimentEnvelope, ExperimentList, MeasurementEnvelope, Transition,
)
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix='/api/experiments', tags=['experiments'])


@router.get('', response_model=ExperimentList)
@handle_api_errors()
async def list_experiments(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    return ExperimentList(data=await run_in_threadpool(repository.list_experiments, offset=offset, limit=limit)).model_dump(mode='json')


@router.post('', response_model=ExperimentEnvelope)
@handle_api_errors()
async def create_experiment(payload: ExperimentDefinition):
    return ExperimentEnvelope(data=await run_in_threadpool(repository.create_experiment, payload)).model_dump(mode='json')


@router.get('/{identifier}', response_model=ExperimentEnvelope)
@handle_api_errors()
async def get_experiment(identifier: int):
    return ExperimentEnvelope(data=await run_in_threadpool(repository.get_experiment, identifier)).model_dump(mode='json')


@router.patch('/{identifier}', response_model=ExperimentEnvelope)
@handle_api_errors()
async def update_experiment(identifier: int, payload: DraftUpdate):
    return ExperimentEnvelope(data=await run_in_threadpool(repository.mutate, identifier, payload.revision, definition=payload.definition)).model_dump(mode='json')


@router.post('/{identifier}/transition', response_model=ExperimentEnvelope)
@handle_api_errors()
async def transition(identifier: int, payload: Transition):
    return ExperimentEnvelope(data=await run_in_threadpool(repository.mutate, identifier, payload.revision, status=payload.status)).model_dump(mode='json')


@router.get('/{identifier}/measurement', response_model=MeasurementEnvelope)
@handle_api_errors()
async def measurement(identifier: int):
    return MeasurementEnvelope(data=await run_in_threadpool(service.measure, identifier)).model_dump(mode='json')
