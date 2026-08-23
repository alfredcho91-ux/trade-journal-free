from __future__ import annotations

import sys

from backend.desktop import _server_config


def test_windowed_desktop_config_does_not_require_console_streams(monkeypatch):
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    config = _server_config(5181)

    assert config.use_colors is False
    assert config.log_config is None
