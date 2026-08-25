"""Process-wide redaction for credentials that could reach log messages."""

from __future__ import annotations

import logging
import re
from threading import RLock
from typing import Any

_LOCK = RLock()
_VALUES: set[str] = set()
_INSTALLED = False
_KEY_VALUE_PATTERN = re.compile(
    r"(?i)(api[_-]?key|secret(?:[_-]?key)?|passphrase)"
    r"(\s*[:=]\s*)"
    r"([^\s,;}&]+)",
)
_AUTHORIZATION_PATTERN = re.compile(
    r"(?i)(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s,;}&]+"
)
_BEARER_PATTERN = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+")


def register_sensitive_values(*values: str) -> None:
    with _LOCK:
        _VALUES.update(value for raw in values if len(value := str(raw or "").strip()) >= 4)
        while len(_VALUES) > 256:
            _VALUES.pop()


def redact_text(value: Any) -> str:
    text = str(value)
    text = _AUTHORIZATION_PATTERN.sub(r"\1[REDACTED]", text)
    text = _KEY_VALUE_PATTERN.sub(r"\1\2[REDACTED]", text)
    text = _BEARER_PATTERN.sub(r"\1 [REDACTED]", text)
    with _LOCK:
        sensitive_values = tuple(_VALUES)
    for sensitive in sensitive_values:
        text = text.replace(sensitive, "[REDACTED]")
    return text


def redact_data(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): redact_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_data(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def install_log_redaction() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    previous_factory = logging.getLogRecordFactory()

    def redacting_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = previous_factory(*args, **kwargs)
        if record.name.startswith("uvicorn."):
            record.msg = redact_text(record.msg)
            if isinstance(record.args, tuple):
                record.args = tuple(
                    redact_text(item) if isinstance(item, str) else item
                    for item in record.args
                )
            elif isinstance(record.args, dict):
                record.args = {
                    key: redact_text(item) if isinstance(item, str) else item
                    for key, item in record.args.items()
                }
            return record
        try:
            rendered = record.getMessage()
        except (TypeError, ValueError):
            rendered = record.msg
        record.msg = redact_text(rendered)
        record.args = ()
        return record

    logging.setLogRecordFactory(redacting_factory)
    _INSTALLED = True


__all__ = ["install_log_redaction", "redact_data", "redact_text", "register_sensitive_values"]
