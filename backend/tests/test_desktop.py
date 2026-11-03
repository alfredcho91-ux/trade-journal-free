from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.desktop import _server_config
from backend import desktop
from backend.desktop_instance import DesktopInstance


def test_runtime_failure_stops_server_and_releases_instance(tmp_path, monkeypatch):
    server = SimpleNamespace(started=True, should_exit=False, run=lambda: None)
    worker = Mock()
    worker.is_alive.return_value = False
    controller = Mock()
    controller.run.side_effect = RuntimeError("WebView2 Runtime is required")
    monkeypatch.setattr(desktop, "APP_DATA_DIR", tmp_path)
    monkeypatch.delenv("TRADE_JOURNAL_NO_BROWSER", raising=False)
    monkeypatch.setattr(desktop, "_native_mode", lambda: True)
    monkeypatch.setattr(desktop, "_available_port", lambda _: 5181)
    monkeypatch.setattr(desktop.uvicorn, "Server", lambda _: server)
    monkeypatch.setattr(desktop.threading, "Thread", lambda **_: worker)
    monkeypatch.setattr("backend.desktop_window.DesktopWindow", lambda *_: controller)
    import ctypes
    notice = Mock()
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(user32=SimpleNamespace(MessageBoxW=notice)), raising=False)
    with pytest.raises(RuntimeError, match="WebView2"):
        desktop.main()
    assert server.should_exit
    worker.join.assert_called_once()
    notice.assert_called_once()
    assert desktop.app.state.desktop_window is None
    assert desktop.app.state.desktop_server is None
    assert not (tmp_path / "desktop-instance.json").exists()
    with DesktopInstance(tmp_path) as instance:
        assert instance.acquired


def test_windowed_desktop_config_does_not_require_console_streams(monkeypatch):
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    config = _server_config(5181)

    assert config.use_colors is False
    assert config.log_config is None
    assert config.host == "127.0.0.1"
    assert config.port == 5181
