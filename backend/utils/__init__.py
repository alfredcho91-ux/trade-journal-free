# utils/__init__.py
"""Utility modules for backend"""

from backend.utils.error_handler import (
    APIError,
    ValidationError,
    DataLoadError,
    NotFoundError,
    BusinessLogicError,
    create_error_response,
    handle_error,
)
from backend.utils.response_builder import (
    success_response,
    error_response,
    paginated_response,
    wrap_response,
)
from backend.utils.validators import (
    validate_dataframe,
    validate_timeframe,
    validate_coin_symbol,
    validate_numeric_range,
    validate_positive_integer,
    validate_percentage,
    validate_required_fields,
    validate_ohlcv_dataframe,
)

__all__ = [
    # Error handling
    "APIError",
    "ValidationError",
    "DataLoadError",
    "NotFoundError",
    "BusinessLogicError",
    "create_error_response",
    "handle_error",
    # Response building
    "success_response",
    "error_response",
    "paginated_response",
    "wrap_response",
    # Validation
    "validate_dataframe",
    "validate_timeframe",
    "validate_coin_symbol",
    "validate_numeric_range",
    "validate_positive_integer",
    "validate_percentage",
    "validate_required_fields",
    "validate_ohlcv_dataframe",
]
