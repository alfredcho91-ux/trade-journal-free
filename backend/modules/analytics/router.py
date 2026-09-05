"""One bounded, read-only analytics query endpoint."""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.modules.analytics.schemas import AnalyticsEnvelope, AnalyticsMetadataEnvelope, AnalyticsQuery
from backend.modules.analytics.service import get_analytics_metadata_service, query_analytics
from backend.utils.decorators import handle_api_errors

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/metadata", response_model=AnalyticsMetadataEnvelope)
async def api_get_analytics_metadata():
    return get_analytics_metadata_service()


@router.post("/query", response_model=AnalyticsEnvelope)
@handle_api_errors()
async def api_query_analytics(payload: AnalyticsQuery):
    result = await run_in_threadpool(query_analytics, payload)
    # The existing API decorator recognizes dictionaries with success/data.
    return result.model_dump(mode="json")
