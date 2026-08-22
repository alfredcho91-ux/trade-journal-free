from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.utils.transport_security import require_secure_credential_transport


def _request(scheme="http", headers=None):
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request({
        "type": "http",
        "method": "POST",
        "scheme": scheme,
        "path": "/api/exchanges/deepcoin/credentials",
        "headers": raw_headers,
        "server": ("example.com", 443 if scheme == "https" else 80),
    })


def test_production_rejects_plain_http(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    with pytest.raises(HTTPException) as error:
        require_secure_credential_transport(_request())
    assert error.value.status_code == 400


def test_production_accepts_https(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    require_secure_credential_transport(_request("https"))


def test_proxy_header_is_trusted_only_when_enabled(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    require_secure_credential_transport(_request(headers={"x-forwarded-proto": "https"}))
