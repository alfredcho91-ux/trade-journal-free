import importlib
import sys

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials

MAIN_MODULE = "backend.main"


def load_main_module(monkeypatch, app_env: str):
    monkeypatch.setenv("APP_ENV", app_env)
    if MAIN_MODULE in sys.modules:
        return importlib.reload(sys.modules[MAIN_MODULE])
    return importlib.import_module(MAIN_MODULE)


def test_dev_mode_skips_basic_auth(monkeypatch):
    main = load_main_module(monkeypatch, "development")

    assert main.security.auto_error is False
    assert main.verify_credentials(None) == "local_dev"


def test_production_requires_basic_auth(monkeypatch):
    monkeypatch.setenv("DEMO_USERNAME", "demo")
    monkeypatch.setenv("DEMO_PASSWORD", "secret")
    main = load_main_module(monkeypatch, "production")

    with pytest.raises(HTTPException) as exc_info:
        main.verify_credentials(None)

    assert exc_info.value.status_code == 401
    assert exc_info.value.headers == {"WWW-Authenticate": "Basic"}


def test_production_without_configured_credentials_fails_fast(monkeypatch):
    monkeypatch.delenv("DEMO_USERNAME", raising=False)
    monkeypatch.delenv("DEMO_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="DEMO_USERNAME and DEMO_PASSWORD"):
        load_main_module(monkeypatch, "production")


def test_production_accepts_valid_basic_auth(monkeypatch):
    monkeypatch.setenv("DEMO_USERNAME", "demo")
    monkeypatch.setenv("DEMO_PASSWORD", "secret")
    main = load_main_module(monkeypatch, "production")

    username = main.verify_credentials(
        HTTPBasicCredentials(
            username="demo",
            password="secret",
        )
    )

    assert username == "demo"
