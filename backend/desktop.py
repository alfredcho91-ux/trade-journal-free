"""Desktop application launcher for the packaged Trade Journal Free build."""

from __future__ import annotations

import os
import socket
import threading
import time
import webbrowser

import uvicorn

from backend.main import app


def _available_port(start_port: int) -> int:
    for port in range(start_port, start_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No local port is available for Trade Journal Free.")


def _open_browser(url: str) -> None:
    time.sleep(0.8)
    webbrowser.open(url, new=1)


def main() -> None:
    """Start the local-only server and open it in the user's default browser."""
    requested_port = int(os.getenv("TRADE_JOURNAL_PORT", "5181"))
    port = _available_port(requested_port)
    url = f"http://127.0.0.1:{port}"
    if os.getenv("TRADE_JOURNAL_NO_BROWSER", "").strip().lower() not in {"1", "true", "yes"}:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
    )
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
