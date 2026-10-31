"""Windows WebView2 shell. The web application and its HTTP API stay unchanged."""

from __future__ import annotations

import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit


def _origin(url: str) -> tuple[str, str, int | None] | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password:
            return None
        return parsed.scheme, parsed.hostname, parsed.port
    except ValueError:
        return None


class DesktopWindow:
    def __init__(self, url: str, sample_process):
        self.url = url
        self.sample_process = sample_process
        self.window = None
        self._loaded = threading.Event()
        self._allow_close = threading.Event()
        self._closing = threading.Lock()
        self._activate_pending = threading.Event()

    def allows_navigation(self, url: str) -> bool:
        origin = _origin(url)
        return origin is not None and origin in {
            _origin(self.url), _origin(self.sample_process.url or ""),
        }

    def _navigation_starting(self, _sender, args):
        if self.allows_navigation(str(args.Uri)):
            return
        args.Cancel = True
        if args.IsUserInitiated and urlsplit(str(args.Uri)).scheme in {"http", "https"}:
            webbrowser.open(str(args.Uri), new=2)

    def _before_show(self):
        # This adapter intentionally targets the pinned Windows/WebView2 renderer.
        self.window.native.webview.NavigationStarting += self._navigation_starting

    def _on_loaded(self):
        self._loaded.set()
        if self._activate_pending.is_set():
            self.activate()

    def activate(self):
        self._activate_pending.set()
        if self.window is not None and self._loaded.is_set():
            self.window.restore()
            self.window.show()
            self._activate_pending.clear()

    def request_close(self):
        if not self._closing.acquire(blocking=False):
            return
        # FormClosing must return before evaluate_js marshals back to the UI thread.
        threading.Thread(target=self._check_close, daemon=True).start()

    def _check_close(self):
        try:
            if self._loaded.is_set():
                allowed = self.window.evaluate_js(
                    "window.dispatchEvent(new Event('app-desktop-close-check', {cancelable: true}))"
                )
                if allowed is not True:
                    return
            self._allow_close.set()
            self.window.destroy()
        finally:
            self._closing.release()

    def _on_closing(self):
        if self._allow_close.is_set():
            return True
        self.request_close()
        return False

    def run(self, storage_path: Path):
        import webview

        controller = self

        class WindowApi:
            # Only this method is exposed to the page; no data or OS APIs.
            def request_close(self):
                controller.request_close()

        self.window = webview.create_window(
            "Trade Journal", self.url, js_api=WindowApi(),
            width=1440, height=960, min_size=(768, 600),
            background_color="#151a22", text_select=True, zoomable=True,
        )
        self.window.events.before_show += self._before_show
        self.window.events.before_load += self._loaded.clear
        self.window.events.loaded += self._on_loaded
        self.window.events.closing += self._on_closing
        storage_path.mkdir(parents=True, exist_ok=True)
        # Never fall back to the legacy MSHTML renderer.
        webview.start(gui="edgechromium", private_mode=False, storage_path=str(storage_path))
