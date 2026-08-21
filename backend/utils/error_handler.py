# utils/error_handler.py
"""에러 처리 유틸리티 - 표준화된 에러 응답 생성"""

from typing import Optional, Dict, Any
import traceback
import sys
import logging

logger = logging.getLogger(__name__)


class APIError(Exception):
    """API 에러 베이스 클래스"""
    def __init__(
        self,
        message: str,
        error_code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(APIError):
    """검증 에러"""
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="VALIDATION_ERROR",
            status_code=422,
            details=details,
        )


class DataLoadError(APIError):
    """데이터 로딩 에러"""
    def __init__(self, message: str = "Failed to load data", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="DATA_LOAD_ERROR",
            status_code=503,
            details=details,
        )


class NotFoundError(APIError):
    """리소스 없음 에러"""
    def __init__(self, resource: str, identifier: Optional[str] = None):
        message = f"{resource} not found"
        if identifier:
            message = f"{resource} '{identifier}' not found"
        super().__init__(
            message=message,
            error_code="NOT_FOUND",
            status_code=404,
        )


class BusinessLogicError(APIError):
    """비즈니스 로직 에러"""
    def __init__(self, message: str, error_code: str = "BUSINESS_LOGIC_ERROR", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code=error_code,
            status_code=400,
            details=details,
        )


def create_error_response(
    error: Exception,
    include_traceback: bool = False,
    error_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    표준화된 에러 응답 생성

    Args:
        error: 발생한 예외
        include_traceback: traceback 포함 여부
        error_code: 커스텀 에러 코드 (None이면 자동 감지)

    Returns:
        표준화된 에러 응답 딕셔너리
    """
    # APIError 인스턴스인 경우
    if isinstance(error, APIError):
        public_message = (
            error.message
            if error.status_code < 500
            else "The service is temporarily unavailable"
        )
        response = {
            "success": False,
            "error": public_message,
            "error_code": error.error_code,
        }
        if error.details:
            response["details"] = error.details
        if include_traceback or sys.flags.debug:
            response["traceback"] = traceback.format_exc()
        return response

    # ValueError인 경우 (검증 에러로 간주)
    if isinstance(error, ValueError):
        response = {
            "success": False,
            "error": str(error),
            "error_code": error_code or "VALIDATION_ERROR",
        }
        if include_traceback or sys.flags.debug:
            response["traceback"] = traceback.format_exc()
        return response

    # 기타 예외
    response = {
        "success": False,
        "error": "An unexpected error occurred",
        "error_code": error_code or "INTERNAL_ERROR",
    }
    if include_traceback or sys.flags.debug:
        response["traceback"] = traceback.format_exc()

    # 에러 로깅
    logger.error(f"Unhandled error: {error}", exc_info=True)

    return response


def handle_error(
    error: Exception,
    include_traceback: bool = False,
    error_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    에러를 처리하고 표준화된 응답 반환 (create_error_response의 별칭)

    Args:
        error: 발생한 예외
        include_traceback: traceback 포함 여부
        error_code: 커스텀 에러 코드

    Returns:
        표준화된 에러 응답 딕셔너리
    """
    return create_error_response(error, include_traceback, error_code)
