"""Stable cache keys for journal analyses."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable


def position_analysis_cache_key(
    namespace: str,
    version: int,
    start_time: int,
    end_time: int,
    positions: Iterable[Dict[str, Any]],
    fields: Iterable[str],
) -> str:
    field_names = tuple(fields)
    fingerprint = [[position.get(field) for field in field_names] for position in positions]
    digest = hashlib.sha256(
        json.dumps(fingerprint, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()
    return f"v{version}:{namespace}:{start_time}:{end_time}:{digest}"
