"""Desktop application launcher for the packaged Trade Journal build."""

from __future__ import annotations

import os
import socket
import threading
import time
import webbrowser

import uvicorn

from backend.main import app
from backend.config.settings import APP_DATA_DIR
from backend.desktop_instance import DesktopInstance


def _available_port(start_port: int) -> int:
    for port in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No local port is available for Trade Journal.")


def _open_browser(url: str) -> None:
    time.sleep(0.8)
    webbrowser.open(url, new=1)


def _server_config(port: int) -> uvicorn.Config:
    """Create a server config safe for PyInstaller windowed builds.

    Windows windowed executables can start without stdout or stderr. Uvicorn's
    default logging setup probes those streams for terminal color support.
    """
    return uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        log_config=None,
        use_colors=False,
    )


def main() -> None:
    """Start the local-only server and open it in the user's default browser."""
    with DesktopInstance(APP_DATA_DIR) as instance:
        if not instance.acquired:
            existing_url = instance.existing_url()
            if existing_url:
                webbrowser.open(existing_url, new=1)
            return

        requested_port = int(os.getenv("TRADE_JOURNAL_PORT", "5181"))
        port = _available_port(requested_port)
        url = f"http://127.0.0.1:{port}"
        instance.publish(url)
        if os.getenv("TRADE_JOURNAL_NO_BROWSER", "").strip().lower() not in {"1", "true", "yes"}:
            threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

        config = _server_config(port)
        server = uvicorn.Server(config)
        app.state.desktop_server = server
        try:
            server.run()
        except KeyboardInterrupt:
            pass
        finally:
            app.state.desktop_server = None


if __name__ == "__main__":
    main()
