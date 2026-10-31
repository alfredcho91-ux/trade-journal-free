from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.desktop_window import DesktopWindow
from backend.main import desktop_activate, desktop_shutdown
from backend.utils.local_request_security import LocalRequestSecurityMiddleware


@pytest.fixture
def window():
    controller = DesktopWindow("http://127.0.0.1:5181", SimpleNamespace(url="http://127.0.0.1:62000/journal"))
    controller.window = Mock()
    return controller


@pytest.mark.parametrize("url,allowed", [
    ("http://127.0.0.1:5181/journal", True),
    ("http://127.0.0.1:62000/strategy-discovery?run=1", True),
    ("http://127.0.0.1:62001", False), ("https://example.org", False),
    ("file:///C:/test.html", False), ("http://evil@127.0.0.1:5181", False),
    ("http://127.0.0.1:bad", False),
])
def test_only_owned_workspace_navigation(window, url, allowed):
    assert window.allows_navigation(url) is allowed


@pytest.mark.parametrize("user_initiated", [False, True])
def test_external_navigation_never_replaces_the_privileged_page(window, monkeypatch, user_initiated):
    open_browser = Mock()
    monkeypatch.setattr("backend.desktop_window.webbrowser.open", open_browser)
    args = SimpleNamespace(Uri="https://example.org", IsUserInitiated=user_initiated, Cancel=False)
    window._navigation_starting(None, args)
    assert args.Cancel is True
    assert open_browser.called is user_initiated


@pytest.mark.parametrize("allowed", [True, False, None])
def test_native_close_respects_page_veto(window, allowed):
    window._loaded.set()
    window.window.evaluate_js.return_value = allowed
    window._closing.acquire()
    window._check_close()
    assert window.window.destroy.called is (allowed is True)
    assert window._allow_close.is_set() is (allowed is True)
    assert window._closing.acquire(blocking=False)


def test_close_during_startup_does_not_wait_for_javascript(window):
    window._closing.acquire()
    window._check_close()
    window.window.evaluate_js.assert_not_called()
    window.window.destroy.assert_called_once()


def test_form_closing_returns_before_javascript_runs(window, monkeypatch):
    thread = Mock()
    monkeypatch.setattr("backend.desktop_window.threading.Thread", thread)
    assert window._on_closing() is False
    thread.return_value.start.assert_called_once()
    window.window.evaluate_js.assert_not_called()
    window.request_close()
    assert thread.call_count == 1


def test_activation_requires_local_token_and_same_origin(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    app = FastAPI()
    app.add_middleware(LocalRequestSecurityMiddleware)
    app.state.desktop_window = Mock()
    app.state.desktop_server = SimpleNamespace(should_exit=False)
    app.state.desktop_activation_token = "private-test-token"
    app.post("/api/desktop/activate")(desktop_activate)
    app.post("/api/desktop/shutdown")(desktop_shutdown)
    with TestClient(app, base_url="http://127.0.0.1:5181") as client:
        assert client.post("/api/desktop/activate").status_code == 403
        assert client.post("/api/desktop/activate", headers={"X-Desktop-Token": "wrong"}).status_code == 403
        assert client.post("/api/desktop/activate", headers={
            "X-Desktop-Token": "private-test-token", "Origin": "http://127.0.0.1:62000",
        }).status_code == 403
        assert client.post("/api/desktop/activate", headers={"X-Desktop-Token": "private-test-token"}).status_code == 200
        app.state.desktop_window.activate.assert_called_once()
        assert client.post("/api/desktop/shutdown").status_code == 200
        app.state.desktop_window.request_close.assert_called_once()
        assert app.state.desktop_server.should_exit is False
