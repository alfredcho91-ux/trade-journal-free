# utils/decorators.py
"""공통 데코레이터 함수"""

from __future__ import annotations

from functools import wraps
import os
from typing import Any, Callable

from fastapi import HTTPException
from fastapi.responses import ORJSONResponse
from backend.utils.error_handler import APIError, handle_error
from backend.utils.response_builder import wrap_response


def _raise_legacy_error(result: Any) -> None:
    """Convert legacy failure envelopes into HTTP-aware domain errors."""
    if not isinstance(result, dict) or result.get("success") is not False:
        return

    message = str(result.get("error") or "Request failed")
    error_code = str(result.get("error_code") or "BUSINESS_LOGIC_ERROR")
    status_code = result.get("status_code")

    if not isinstance(status_code, int):
        normalized_message = message.lower()
        if error_code in {"NOT_FOUND", "RESOURCE_NOT_FOUND"} or "not found" in normalized_message:
            status_code = 404
            error_code = "NOT_FOUND"
        elif error_code == "DATA_LOAD_ERROR" or any(
            phrase in normalized_message
            for phrase in ("failed to load", "failed to fetch", "temporarily unavailable")
        ):
            status_code = 503
            error_code = "DATA_LOAD_ERROR"
        elif (
            error_code == "VALIDATION_ERROR"
            or "invalid" in normalized_message
            or "unknown strategy" in normalized_message
            or "알 수 없는 전략" in normalized_message
        ):
            status_code = 422
            error_code = "VALIDATION_ERROR"
        else:
            status_code = 500
            error_code = "INTERNAL_ERROR"

    raise APIError(
        message=message,
        error_code=error_code,
        status_code=status_code,
        details=result.get("details"),
    )


def handle_api_errors(include_traceback: bool = False):
    """
    API 엔드포인트의 공통 에러 처리 데코레이터

    Args:
        include_traceback: traceback 포함 여부 (기본값: False, 개발 환경용)

    Usage:
        @router.post("/endpoint")
        @handle_api_errors()
        async def api_endpoint(params: Params):
            # 로직
            return {"success": True, "data": result}
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> dict[str, Any] | ORJSONResponse:
            expose_traceback = include_traceback and (
                os.getenv("EXPOSE_API_TRACEBACK", "false").lower() in {"1", "true", "yes", "on"}
            )
            try:
                result = await func(*args, **kwargs)
                _raise_legacy_error(result)
                # 표준 응답 형식으로 래핑
                return wrap_response(result)
            except HTTPException:
                raise
            except APIError as e:
                return ORJSONResponse(
                    status_code=e.status_code,
                    content=handle_error(e, include_traceback=expose_traceback),
                )
            except Exception as e:
                status_code = 422 if isinstance(e, ValueError) else 500
                return ORJSONResponse(
                    status_code=status_code,
                    content=handle_error(e, include_traceback=expose_traceback),
                )
        return wrapper
    return decorator
