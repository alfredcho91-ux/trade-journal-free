"""Exercise the production mount/order with local files, never remote UNC I/O."""

import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette import staticfiles

from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    (tmp_path / "index.html").write_text("<html>journal shell</html>")
    (tmp_path / "asset.txt").write_bytes(b"0123456789")
    (tmp_path / "api").mkdir()
    (tmp_path / "api" / "health").write_text("must not shadow the API")
    mount = next(route for route in main.app.routes if route.name == "frontend")
    monkeypatch.setattr(mount, "app", staticfiles.StaticFiles(directory=tmp_path, html=True))
    initialized = []
    monkeypatch.setattr(main, "initialize_assignment_schema", lambda: initialized.append("assignments"))
    monkeypatch.setattr(main, "initialize_experiment_schema", lambda: initialized.append("experiments"))
    with TestClient(main.app, base_url="http://127.0.0.1:5181") as test_client:
        assert initialized == ["assignments", "experiments"]
        yield test_client


def test_static_get_head_and_conditional_get(client):
    response = client.get("/asset.txt")
    assert response.status_code == 200
    assert response.content == b"0123456789"
    assert response.headers["accept-ranges"] == "bytes"
    head = client.head("/asset.txt")
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["content-length"] == response.headers["content-length"] == "10"
    assert client.get("/asset.txt", headers={"If-None-Match": response.headers["etag"]}).status_code == 304


@pytest.mark.parametrize("value,expected", [("bytes=2-5", b"2345"), ("bytes=-3", b"789")])
def test_static_valid_range(client, value, expected):
    response = client.get("/asset.txt", headers={"Range": value})
    assert response.status_code == 206
    assert response.content == expected
    assert response.headers["content-length"] == str(len(expected))
    assert response.headers["content-range"].endswith("/10")


@pytest.mark.parametrize("value,status", [("bytes=invalid", 400), ("bytes=9-2", 400), ("bytes=20-30", 416)])
def test_static_bad_range_is_bounded_error(client, value, status):
    response = client.get("/asset.txt", headers={"Range": value})
    assert response.status_code == status
    assert client.get("/api/health").status_code == 200


def test_static_html_and_api_precedence(client):
    assert client.get("/").text == "<html>journal shell</html>"
    assert client.get("/index.html").status_code == 200
    assert client.get("/api/health").json() == {
        "success": True, "data": {"service": "trade-journal-free"},
    }
    # html=True serves directory index.html, not an arbitrary SPA catch-all.
    assert client.get("/missing.js").status_code == 404
    assert client.get("/unknown-client-route").status_code == 404
    assert client.get("/api/nonexistent").status_code == 404


def test_static_mount_remains_behind_local_security_and_cors(client):
    assert client.get("/asset.txt", headers={"Host": "evil.invalid"}).status_code == 403
    assert client.get("/asset.txt", headers=[("Host", "localhost"), ("Host", "evil.invalid")]).status_code == 403
    origin = "http://localhost:5173"
    response = client.get("/api/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    response = client.options("/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_production_api_basic_auth_with_static_mount(client, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_USERNAME", "framework-test")
    monkeypatch.setenv("DEMO_PASSWORD", "local-test-password")
    response = client.get("/api/health")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Basic"
    assert client.get("/api/health", auth=("framework-test", "wrong")).status_code == 401
    assert client.get("/api/health", auth=("framework-test", "local-test-password")).status_code == 200
    # Global FastAPI dependencies protect API routes, not the mounted frontend.
    assert client.get("/").status_code == 200


@pytest.mark.parametrize("path", [
    r"\\blocked.invalid\share\asset.txt",
    "//blocked.invalid/share/asset.txt",
    r"\outside\asset.txt",
    r"\\?\UNC\blocked.invalid\share\asset.txt",
])
@pytest.mark.skipif(os.name != "nt", reason="Windows path semantics")
def test_windows_absolute_paths_rejected_before_any_filesystem_resolution(tmp_path, monkeypatch, path):
    files = staticfiles.StaticFiles(directory=tmp_path)

    def forbidden_io(*args, **kwargs):
        pytest.fail("absolute path reached filesystem resolution")

    # Replace only Starlette's module binding, not process-wide os functions.
    # Even a vulnerable version fails locally before any SMB/NTLM access.
    monkeypatch.setattr(staticfiles, "os", SimpleNamespace(
        path=SimpleNamespace(join=os.path.join,
                             realpath=forbidden_io, abspath=forbidden_io),
        stat=forbidden_io,
    ))
    assert files.lookup_path(path) == ("", None)


def test_relative_traversal_cannot_escape_static_root(tmp_path):
    root = tmp_path / "frontend"
    root.mkdir()
    (tmp_path / "private.txt").write_text("not a frontend asset")
    files = staticfiles.StaticFiles(directory=root)
    assert files.lookup_path("../private.txt") == ("", None)
