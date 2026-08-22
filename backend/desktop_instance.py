"""Single-instance coordination for packaged desktop builds."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import IO, Optional
from urllib.error import URLError
from urllib.request import urlopen


class DesktopInstance:
    """Hold an OS-level file lock for the lifetime of one desktop process."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.lock_path = data_dir / "desktop.lock"
        self.metadata_path = data_dir / "desktop-instance.json"
        self._handle: Optional[IO[str]] = None
        self.acquired = False

    def acquire(self) -> bool:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        handle = self.lock_path.open("a+", encoding="utf-8")
        handle.seek(0)
        if handle.read(1) == "":
            handle.write("0")
            handle.flush()
        handle.seek(0)

        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            handle.close()
            return False

        self._handle = handle
        self.acquired = True
        return True

    def publish(self, url: str) -> None:
        payload = {"pid": os.getpid(), "url": url, "started_at": int(time.time())}
        descriptor, temp_path = tempfile.mkstemp(
            prefix="desktop-instance.", suffix=".tmp", dir=str(self.data_dir), text=True
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(temp_path, self.metadata_path)
        except Exception:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
            raise

    def existing_url(self, timeout_seconds: float = 2.0) -> Optional[str]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                payload = json.loads(self.metadata_path.read_text(encoding="utf-8"))
                url = str(payload.get("url", "")).rstrip("/")
                if url and _server_is_ready(url):
                    return url
            except (OSError, ValueError, TypeError):
                pass
            time.sleep(0.1)
        return None

    def release(self) -> None:
        if not self.acquired or self._handle is None:
            return
        try:
            self.metadata_path.unlink(missing_ok=True)
            if sys.platform == "win32":
                import msvcrt

                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None
            self.acquired = False

    def __enter__(self) -> "DesktopInstance":
        self.acquire()
        return self

    def __exit__(self, *_args: object) -> None:
        self.release()


def _server_is_ready(url: str) -> bool:
    try:
        with urlopen(f"{url}/api/health", timeout=0.5) as response:
            return response.status == 200
    except (OSError, URLError, ValueError):
        return False


__all__ = ["DesktopInstance"]
