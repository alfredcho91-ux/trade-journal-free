"""Desktop application launcher for the packaged Trade Journal build."""

from __future__ import annotations

import os
import secrets
import socket
import sys
import threading
import time
import webbrowser
from urllib.request import Request, urlopen

import uvicorn

from backend.main import app
from backend.config.settings import APP_DATA_DIR
from backend.desktop_instance import DesktopInstance
from backend.modules.sample.workspace import sample_process


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


def _native_mode() -> bool:
    return sys.platform == "win32" and os.getenv("TRADE_JOURNAL_DESKTOP_MODE", "window") != "browser"


def _activate_existing(instance: DesktopInstance) -> None:
    url = instance.existing_url(timeout_seconds=10)
    if not url:
        return
    metadata = instance.existing_metadata()
    if metadata.get("mode") == "window":
        request = Request(f"{url}/api/desktop/activate", method="POST", headers={
            "X-Desktop-Token": str(metadata.get("activation_token", "")),
        })
        with urlopen(request, timeout=5):
            pass
    else:
        webbrowser.open(url, new=1)


def main() -> None:
    """Own one local server and, on Windows, its dedicated application window."""
    with DesktopInstance(APP_DATA_DIR) as instance:
        if not instance.acquired:
            _activate_existing(instance)
            return

        requested_port = int(os.getenv("TRADE_JOURNAL_PORT", "5181"))
        port = _available_port(requested_port)
        url = f"http://127.0.0.1:{port}"
        headless = os.getenv("TRADE_JOURNAL_NO_BROWSER", "").strip().lower() in {"1", "true", "yes"}
        native = not headless and _native_mode()
        config = _server_config(port)
        server = uvicorn.Server(config)
        app.state.desktop_server = server
        app.state.desktop_window = None
        app.state.desktop_activation_token = secrets.token_urlsafe(32) if native else None
        worker = None
        try:
            if native:
                from backend.desktop_window import DesktopWindow

                controller = DesktopWindow(url, sample_process)
                app.state.desktop_window = controller
                worker = threading.Thread(target=server.run, name="journal-server", daemon=True)
                worker.start()
                deadline = time.monotonic() + 45
                while not server.started:
                    if not worker.is_alive() or time.monotonic() >= deadline:
                        raise RuntimeError("Trade Journal's local server could not start.")
                    time.sleep(0.05)
                instance.publish(url, mode="window", activation_token=app.state.desktop_activation_token)
                controller.run(APP_DATA_DIR / "webview")
            else:
                instance.publish(url)
                if not headless:
                    threading.Thread(target=_open_browser, args=(url,), daemon=True).start()
                server.run()
        except KeyboardInterrupt:
            pass
        except Exception as error:
            if native:
                import ctypes

                ctypes.windll.user32.MessageBoxW(None,
                    f"Trade Journal could not start.\n\n{error}\n\n"
                    "Install Microsoft Edge WebView2 Runtime and retry.\n"
                    "https://developer.microsoft.com/microsoft-edge/webview2/",
                    "Trade Journal", 0x10)
            raise
        finally:
            server.should_exit = True
            if worker is not None:
                worker.join(timeout=25)
                if worker.is_alive():
                    # Own sample children must not outlive a stopped application.
                    sample_process.close()
                    raise RuntimeError("Trade Journal's server did not stop cleanly.")
            app.state.desktop_server = None
            app.state.desktop_window = None
            app.state.desktop_activation_token = None


if __name__ == "__main__":
    main()
