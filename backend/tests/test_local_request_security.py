"""Central policy on isolated applications; never mutate the running desktop."""

from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.main import desktop_shutdown, verify_credentials
from backend.modules.experiments.router import router as experiments_router
from backend.modules.journal.router import router as journal_router
from backend.modules.plan_lab.router import router as plans_router
from backend.modules.strategies.router import router as strategies_router
from backend.utils import local_request_security as security


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("JOURNAL_FRONTEND_PORT", raising=False)
    monkeypatch.setattr(security, "IS_FROZEN", False)
    monkeypatch.setattr(security, "CORS_ORIGINS", ["http://localhost:5173", "http://localhost:3000"])
    app = FastAPI(dependencies=[Depends(verify_credentials)])
    app.add_middleware(security.LocalRequestSecurityMiddleware)
    app.state.calls = 0

    @app.api_route("/new-endpoint", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def future_endpoint():
        app.state.calls += 1
        return {"ok": True}

    app.post("/api/desktop/shutdown")(desktop_shutdown)
    for router in (strategies_router, journal_router, plans_router, experiments_router):
        app.include_router(router)
    return app


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("origin", ["http://127.0.0.1:8011", "http://127.0.0.1:5181", "http://localhost:5181", "http://localhost:5173"])
def test_trusted_development_origins(app, method, origin):
    with TestClient(app, base_url="http://127.0.0.1:8011") as client:
        assert client.request(method, "/new-endpoint", headers={"Origin": origin}).status_code == 200
    assert app.state.calls == 1


@pytest.mark.parametrize("origin", [
    "null", "", "https://evil.invalid", "http://127.0.0.1.evil.invalid:5181",
    "http://localhost@evil.invalid:5181", "http://evil.invalid@localhost:5181",
    "http://localhost:9999", "http://localhost:5181/path", "http://localhost:5181?x",
    "http://localhost:5181#x", "http://localhost:5181/", "http://localhost:bad",
    "http://localhost:5181 http://evil.invalid", "http://localhost:5181\\evil", "file://localhost",
    "http://localhost:0", "http://localhost:65536",
])
def test_untrusted_opaque_and_malformed_origins_never_execute(app, origin):
    with TestClient(app, base_url="http://127.0.0.1:8011") as client:
        response = client.post("/new-endpoint", headers={"Origin": origin})
    assert response.status_code == 403
    assert response.json()["error_code"] == "LOCAL_REQUEST_FORBIDDEN"
    assert app.state.calls == 0


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_new_routes_inherit_policy_without_endpoint_code(app, method):
    with TestClient(app, base_url="http://127.0.0.1:8011") as client:
        assert client.request(method, "/new-endpoint", headers={"Origin": "https://evil.invalid"}).status_code == 403
    assert app.state.calls == 0


@pytest.mark.parametrize("fetch_site,status", [(None, 200), ("none", 200), ("same-origin", 200), ("cross-site", 403), ("same-site", 403)])
def test_missing_origin_native_and_browser_contract(app, fetch_site, status):
    headers = {"Sec-Fetch-Site": fetch_site} if fetch_site else {}
    with TestClient(app, base_url="http://localhost:8011") as client:
        assert client.post("/new-endpoint", headers=headers).status_code == status


@pytest.mark.parametrize("host", ["evil.invalid", "127.0.0.1.evil.invalid", "localhost:bad", "localhost@evil.invalid", "localhost:8011/path"])
def test_invalid_host_rejected(app, host):
    with TestClient(app) as client:
        assert client.post("/new-endpoint", headers={"Host": host}).status_code == 403
    assert app.state.calls == 0


def test_duplicate_security_headers_are_rejected(app):
    with TestClient(app) as client:
        assert client.post("/new-endpoint", headers=[("Host", "localhost:8011"), ("Host", "evil.invalid")]).status_code == 403
        assert client.post("/new-endpoint", headers=[("Origin", "http://localhost:5181"), ("Origin", "https://evil.invalid")]).status_code == 403


def test_safe_get_and_native_test_transport_remain_supported(app):
    with TestClient(app) as client:
        assert client.get("/new-endpoint", headers={"Origin": "https://evil.invalid"}).status_code == 200
        assert client.post("/new-endpoint").status_code == 200


@pytest.mark.parametrize("port", [5181, 5194])
def test_packaged_dynamic_port_requires_same_origin(app, monkeypatch, port):
    monkeypatch.setattr(security, "IS_FROZEN", True)
    with TestClient(app, base_url=f"http://127.0.0.1:{port}") as client:
        assert client.post("/new-endpoint", headers={"Origin": f"http://127.0.0.1:{port}"}).status_code == 200
        assert client.post("/new-endpoint", headers={"Origin": "http://localhost:5173"}).status_code == 403
        assert client.post("/new-endpoint").status_code == 200


def test_custom_vite_port_and_cors_cannot_authorize_remote_origins(app, monkeypatch):
    monkeypatch.setenv("JOURNAL_FRONTEND_PORT", "5281")
    monkeypatch.setattr(security, "CORS_ORIGINS", ["https://evil.invalid"])
    with TestClient(app, base_url="http://localhost:8011") as client:
        assert client.post("/new-endpoint", headers={"Origin": "http://localhost:5281"}).status_code == 200
        assert client.post("/new-endpoint", headers={"Origin": "https://evil.invalid"}).status_code == 403


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/strategies/1/archive"), ("POST", "/api/strategies/1/versions/1/activate"),
    ("PATCH", "/api/journal/1/behavior"), ("DELETE", "/api/journal/1"),
    ("POST", "/api/plans/1/revisions"), ("POST", "/api/experiments/1/transition"),
    ("POST", "/api/desktop/shutdown"),
])
def test_real_router_mutations_blocked_before_body_or_service(app, method, path):
    from starlette.routing import Match
    scope = {"type": "http", "path": path, "method": method, "root_path": ""}
    assert any(route.matches(scope)[0] is Match.FULL for route in app.routes)
    app.state.desktop_server = SimpleNamespace(should_exit=False)
    with TestClient(app, base_url="http://127.0.0.1:5181") as client:
        response = client.request(method, path, headers={"Origin": "https://evil.invalid"})
    assert response.status_code == 403
    assert response.json()["error_code"] == "LOCAL_REQUEST_FORBIDDEN"
    assert app.state.desktop_server.should_exit is False


def test_legitimate_shutdown_on_dummy_server(app):
    app.state.desktop_server = SimpleNamespace(should_exit=False)
    with TestClient(app, base_url="http://127.0.0.1:5190") as client:
        assert client.post("/api/desktop/shutdown", headers={"Origin": "http://127.0.0.1:5190"}).status_code == 200
    assert app.state.desktop_server.should_exit is True


def test_remote_client_cannot_claim_local_trust(app):
    with TestClient(remote_transport(app), base_url="http://localhost:8011") as client:
        assert client.post("/new-endpoint").status_code == 403


def test_production_auth_is_not_replaced_by_local_trust(app, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_USERNAME", "fake-user")
    monkeypatch.setenv("DEMO_PASSWORD", "fake-password")
    with TestClient(remote_transport(app), base_url="https://production.invalid") as client:
        assert client.post("/new-endpoint", headers={"Origin": "http://localhost:5181"}).status_code == 401
        assert client.post("/new-endpoint", auth=("fake-user", "wrong")).status_code == 401
        assert client.post("/new-endpoint", auth=("fake-user", "fake-password")).status_code == 200


def remote_transport(app):
    async def transport(scope, receive, send):
        if scope["type"] == "http":
            scope = {**scope, "client": ("192.0.2.1", 5000)}
        await app(scope, receive, send)
    return transport


def test_main_application_installs_central_policy():
    from backend.main import app
    assert any(item.cls is security.LocalRequestSecurityMiddleware for item in app.user_middleware)
