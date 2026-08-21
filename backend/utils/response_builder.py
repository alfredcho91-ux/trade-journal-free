# utils/response_builder.py
"""응답 빌더 유틸리티 - 표준화된 성공/실패 응답 생성"""

from typing import Optional, Dict, Any, List, Union


def success_response(
    data: Any = None,
    message: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    표준화된 성공 응답 생성

    Args:
        data: 응답 데이터 (None 가능)
        message: 성공 메시지 (선택)
        meta: 추가 메타데이터 (선택)

    Returns:
        표준화된 성공 응답 딕셔너리

    Examples:
        >>> success_response(data={"id": 1, "name": "test"})
        {"success": True, "data": {"id": 1, "name": "test"}}

        >>> success_response(message="Operation completed", meta={"count": 10})
        {"success": True, "message": "Operation completed", "meta": {"count": 10}}
    """
    response: Dict[str, Any] = {"success": True}

    if data is not None:
        response["data"] = data

    if message:
        response["message"] = message

    if meta:
        response["meta"] = meta

    return response


def error_response(
    error: str,
    error_code: str = "INTERNAL_ERROR",
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    표준화된 에러 응답 생성

    Args:
        error: 에러 메시지
        error_code: 에러 코드
        details: 추가 상세 정보 (선택)

    Returns:
        표준화된 에러 응답 딕셔너리

    Examples:
        >>> error_response("Failed to load data", "DATA_LOAD_ERROR")
        {"success": False, "error": "Failed to load data", "error_code": "DATA_LOAD_ERROR"}
    """
    response: Dict[str, Any] = {
        "success": False,
        "error": error,
        "error_code": error_code,
    }

    if details:
        response["details"] = details

    return response


def paginated_response(
    items: List[Any],
    total: int,
    page: int = 1,
    page_size: int = 10,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    페이지네이션된 응답 생성

    Args:
        items: 현재 페이지의 아이템 리스트
        total: 전체 아이템 수
        page: 현재 페이지 번호 (1부터 시작)
        page_size: 페이지 크기
        meta: 추가 메타데이터 (선택)

    Returns:
        페이지네이션된 응답 딕셔너리

    Examples:
        >>> paginated_response([1, 2, 3], total=100, page=1, page_size=10)
        {
            "success": True,
            "data": [1, 2, 3],
            "pagination": {
                "total": 100,
                "page": 1,
                "page_size": 10,
                "total_pages": 10
            }
        }
    """
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

    response: Dict[str, Any] = {
        "success": True,
        "data": items,
        "pagination": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        },
    }

    if meta:
        response["meta"] = meta

    return response


def wrap_response(
    result: Union[Dict[str, Any], Any],
    default_key: str = "data",
) -> Dict[str, Any]:
    """
    결과를 표준 응답 형식으로 래핑

    Args:
        result: 래핑할 결과 (딕셔너리면 그대로, 아니면 data 필드에 포함)
        default_key: result가 딕셔너리가 아닐 때 사용할 키 (기본: "data")

    Returns:
        표준화된 응답 딕셔너리

    Examples:
        >>> wrap_response({"id": 1})
        {"success": True, "id": 1}

        >>> wrap_response([1, 2, 3])
        {"success": True, "data": [1, 2, 3]}
    """
    if isinstance(result, dict):
        # 이미 success 필드가 있으면 그대로 반환
        if "success" in result:
            return result
        # 없으면 success 추가
        return {"success": True, **result}

    # 딕셔너리가 아니면 data 필드에 포함
    return {"success": True, default_key: result}
