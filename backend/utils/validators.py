# utils/validators.py
"""공통 검증 유틸리티"""

from typing import Optional, List, Tuple
import pandas as pd
from backend.utils.error_handler import ValidationError, DataLoadError


def validate_dataframe(
    df: Optional[pd.DataFrame],
    required_columns: Optional[List[str]] = None,
    min_rows: int = 1,
    error_message: Optional[str] = None,
) -> pd.DataFrame:
    """
    DataFrame 검증

    Args:
        df: 검증할 DataFrame
        required_columns: 필수 컬럼 리스트
        min_rows: 최소 행 수
        error_message: 커스텀 에러 메시지

    Returns:
        검증된 DataFrame

    Raises:
        DataLoadError: DataFrame이 None이거나 비어있을 때
        ValidationError: 필수 컬럼이 없거나 최소 행 수 미달 시

    Examples:
        >>> df = pd.DataFrame({"open": [1, 2], "close": [2, 3]})
        >>> validate_dataframe(df, required_columns=["open", "close"])
        DataFrame with 2 rows
    """
    if df is None:
        raise DataLoadError(error_message or "DataFrame is None")

    if df.empty:
        raise DataLoadError(error_message or "DataFrame is empty")

    if len(df) < min_rows:
        raise ValidationError(
            f"DataFrame must have at least {min_rows} rows, got {len(df)}",
            details={"min_rows": min_rows, "actual_rows": len(df)},
        )

    if required_columns:
        missing_columns = set(required_columns) - set(df.columns)
        if missing_columns:
            raise ValidationError(
                f"Missing required columns: {', '.join(missing_columns)}",
                details={"required": required_columns, "missing": list(missing_columns)},
            )

    return df


def validate_timeframe(interval: str, allowed_intervals: Optional[List[str]] = None) -> str:
    """
    타임프레임 검증

    Args:
        interval: 검증할 타임프레임 (예: "1h", "4h", "1d")
        allowed_intervals: 허용된 타임프레임 리스트 (None이면 기본 검증만)

    Returns:
        검증된 타임프레임 문자열

    Raises:
        ValidationError: 타임프레임이 유효하지 않을 때

    Examples:
        >>> validate_timeframe("1h")
        "1h"

        >>> validate_timeframe("1w", allowed_intervals=["1h", "4h", "1d"])
        ValidationError: "1w" is not in allowed intervals
    """
    # 기본 형식 검증 (숫자 + 단위)
    if not interval or not isinstance(interval, str):
        raise ValidationError(f"Invalid timeframe: {interval}")

    # 허용된 리스트가 있으면 검증
    if allowed_intervals and interval not in allowed_intervals:
        raise ValidationError(
            f"Timeframe '{interval}' is not allowed. Allowed: {', '.join(allowed_intervals)}",
            details={"interval": interval, "allowed": allowed_intervals},
        )

    return interval


def validate_coin_symbol(coin: str) -> str:
    """
    코인 심볼 검증

    Args:
        coin: 검증할 코인 심볼 (예: "BTC", "ETH")

    Returns:
        검증된 코인 심볼 (대문자로 변환)

    Raises:
        ValidationError: 코인 심볼이 유효하지 않을 때

    Examples:
        >>> validate_coin_symbol("btc")
        "BTC"
    """
    if not coin or not isinstance(coin, str):
        raise ValidationError(f"Invalid coin symbol: {coin}")

    coin_upper = coin.upper().strip()

    if not coin_upper:
        raise ValidationError("Coin symbol cannot be empty")

    return coin_upper


def validate_numeric_range(
    value: float,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    field_name: str = "value",
) -> float:
    """
    숫자 범위 검증

    Args:
        value: 검증할 숫자 값
        min_value: 최소값 (None이면 검증 안 함)
        max_value: 최대값 (None이면 검증 안 함)
        field_name: 필드 이름 (에러 메시지용)

    Returns:
        검증된 숫자 값

    Raises:
        ValidationError: 값이 범위를 벗어날 때

    Examples:
        >>> validate_numeric_range(50, min_value=0, max_value=100)
        50.0
    """
    if min_value is not None and value < min_value:
        raise ValidationError(
            f"{field_name} must be >= {min_value}, got {value}",
            details={"field": field_name, "value": value, "min": min_value},
        )

    if max_value is not None and value > max_value:
        raise ValidationError(
            f"{field_name} must be <= {max_value}, got {value}",
            details={"field": field_name, "value": value, "max": max_value},
        )

    return float(value)


def validate_positive_integer(value: int, field_name: str = "value") -> int:
    """
    양의 정수 검증

    Args:
        value: 검증할 정수 값
        field_name: 필드 이름 (에러 메시지용)

    Returns:
        검증된 양의 정수

    Raises:
        ValidationError: 값이 양의 정수가 아닐 때

    Examples:
        >>> validate_positive_integer(10)
        10
    """
    if not isinstance(value, int) or value <= 0:
        raise ValidationError(
            f"{field_name} must be a positive integer, got {value}",
            details={"field": field_name, "value": value},
        )

    return value


def validate_percentage(value: float, field_name: str = "percentage") -> float:
    """
    퍼센트 값 검증 (0-100 범위)

    Args:
        value: 검증할 퍼센트 값
        field_name: 필드 이름 (에러 메시지용)

    Returns:
        검증된 퍼센트 값

    Raises:
        ValidationError: 값이 0-100 범위를 벗어날 때

    Examples:
        >>> validate_percentage(50.5)
        50.5
    """
    return validate_numeric_range(value, min_value=0.0, max_value=100.0, field_name=field_name)


def validate_required_fields(
    data: dict,
    required_fields: List[str],
    prefix: str = "",
) -> None:
    """
    필수 필드 검증

    Args:
        data: 검증할 딕셔너리
        required_fields: 필수 필드 리스트
        prefix: 에러 메시지 접두사

    Raises:
        ValidationError: 필수 필드가 없을 때

    Examples:
        >>> validate_required_fields({"name": "test"}, ["name", "email"])
        ValidationError: Missing required fields: email
    """
    missing_fields = [field for field in required_fields if field not in data or data[field] is None]

    if missing_fields:
        error_msg = f"Missing required fields: {', '.join(missing_fields)}"
        if prefix:
            error_msg = f"{prefix}: {error_msg}"
        raise ValidationError(
            error_msg,
            details={"required": required_fields, "missing": missing_fields},
        )


def validate_ohlcv_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    OHLCV 데이터 검증 (open, high, low, close, volume)

    Args:
        df: 검증할 DataFrame

    Returns:
        검증된 DataFrame

    Raises:
        ValidationError: OHLCV 컬럼이 없거나 데이터가 유효하지 않을 때
    """
    required_columns = ["open", "high", "low", "close"]
    df = validate_dataframe(df, required_columns=required_columns)

    # OHLC 논리 검증: high >= low, high >= open, high >= close, low <= open, low <= close
    invalid_rows = (
        (df["high"] < df["low"]) |
        (df["high"] < df["open"]) |
        (df["high"] < df["close"]) |
        (df["low"] > df["open"]) |
        (df["low"] > df["close"])
    )

    if invalid_rows.any():
        invalid_count = invalid_rows.sum()
        raise ValidationError(
            f"Invalid OHLC data: {invalid_count} rows have invalid OHLC relationships",
            details={"invalid_rows": int(invalid_count)},
        )

    return df
