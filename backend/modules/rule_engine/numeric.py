"""Canonical numeric facts for deterministic Rule Engine evaluation."""

from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any

_DECIMAL_STRING_PATTERN = re.compile(
    r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$"
)
_FLOAT_SIGNIFICANT_DIGITS = 15


def canonical_numeric(value: Any) -> str:
    """Return one exact decimal fact, removing only normal binary-float noise.

    Decimal, integer, and canonical decimal-string inputs are never rounded.
    Float inputs use 15 significant digits, a conservative policy that removes
    representation artifacts without imposing metric-specific display places.
    """
    if isinstance(value, bool):
        raise ValueError("Boolean values are not numeric facts")
    if isinstance(value, Decimal):
        decimal = value
    elif isinstance(value, int):
        decimal = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Numeric facts must be finite")
        decimal = Decimal(format(value, f".{_FLOAT_SIGNIFICANT_DIGITS}g"))
    elif isinstance(value, str) and _DECIMAL_STRING_PATTERN.fullmatch(value):
        try:
            decimal = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError("Invalid decimal string") from exc
    else:
        raise ValueError("Value is not a supported numeric fact")

    if not decimal.is_finite():
        raise ValueError("Numeric facts must be finite")
    if decimal == 0:
        return "0"
    rendered = format(decimal, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


__all__ = ["canonical_numeric"]
