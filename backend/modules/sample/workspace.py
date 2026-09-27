"""Launch a fresh process so imported paths, credentials and caches never switch."""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, HTTPException, Request

from backend.config import settings
from backend.config.sample_policy import IS_SAMPLE

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


def _preference_path() -> Path:
    db = settings.JOURNAL_DB_PATH
    return db.with_name(db.name + ".onboarding.json")


def workspace_status() -> dict:
    count = 0
    db = settings.JOURNAL_DB_PATH.resolve()
    if db.exists():
        with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as conn:
            count = conn.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
    acknowledged = False
    if not IS_SAMPLE and _preference_path().exists():
        try:
            acknowledged = json.loads(_preference_path().read_text(encoding="utf-8")).get("acknowledged") is True
        except (ValueError, OSError):
            pass
    return {
        "mode": "sample" if IS_SAMPLE else "normal",
        "profile_id": settings.credential_profile_id(),
        "first_run": not IS_SAMPLE and count == 0 and not acknowledged,
        "trade_count": count,
        "return_url": os.environ.get("TRADE_JOURNAL_SAMPLE_RETURN_URL") if IS_SAMPLE else None,
        "period": {"start": "2026-01-01", "end": "2026-01-31"} if IS_SAMPLE else None,
        "credential_backend": "disabled" if IS_SAMPLE else None,
        "fixture_version": 1 if IS_SAMPLE else None,
    }


def sample_environment(root: Path, token: str, return_url: str, port: int) -> dict[str, str]:
    # Allowlist OS/runtime inputs. Never inherit exchange keys, master keys,
    # legacy dotenv values, proxy configuration, or normal DB/CSV overrides.
    keep = {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_DATA_HOME", "LANG", "LC_ALL"}
    env = {key: value for key, value in os.environ.items() if key.upper() in keep}
    env.update({
        "TRADE_JOURNAL_WORKSPACE": "sample", "TRADE_JOURNAL_SAMPLE_ROOT": str(root),
        "TRADE_JOURNAL_SAMPLE_TOKEN": token, "TRADE_JOURNAL_SAMPLE_RETURN_URL": return_url,
        "TRADE_JOURNAL_DATA_DIR": str(root), "JOURNAL_DIR": str(root / "journal"),
        "JOURNAL_DB_PATH": str(root / "journal" / "trade_journal.db"),
        "JOURNAL_CSV_PATH": str(root / "journal" / "unused.csv"),
        "CREDENTIAL_STORAGE": "disabled", "DATA_CACHE_BACKEND": "memory",
        "APP_ENV": "development", "TRADE_JOURNAL_NO_BROWSER": "1",
        "TRADE_JOURNAL_PORT": str(port), "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "PYINSTALLER_RESET_ENVIRONMENT": "1",
    })
    return env


class SampleProcess:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = None
        self.directory = None
        self.url = None

    def close(self):
        if self.process is not None:
            # Shut down the server itself: Windows venv launchers can wrap the
            # actual Python process, which still holds desktop.lock briefly
            # after its launcher has been terminated.
            if self.url and self.process.poll() is None:
                base = self.url.removesuffix("/journal")
                try:
                    with urlopen(UrlRequest(base + "/api/desktop/shutdown", data=b"", headers={"Origin": base}), timeout=2):
                        pass
                except (OSError, URLError):
                    pass
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=5)
            self.process = None
        if self.directory is not None:
            self.directory.cleanup()
            self.directory = None
        self.url = None

    def start(self, return_url: str, *, reset: bool = False) -> str:
        with self.lock:
            if self.process is not None and self.process.poll() is None and not reset:
                return self.url
            self.close()
            self.directory = tempfile.TemporaryDirectory(prefix="trade-journal-sample-")
            root = Path(self.directory.name).resolve()
            token = secrets.token_hex(32)
            (root / "sample-owner.json").write_text(json.dumps({"token": token, "fixture_version": 1}), encoding="utf-8")
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            env = sample_environment(root, token, return_url, port)
            command = [sys.executable] if settings.IS_FROZEN else [sys.executable, "-B", "-m", "backend.desktop"]
            try:
                with (root / "startup.log").open("wb") as log:
                    self.process = subprocess.Popen(command, env=env, cwd=settings.SOURCE_ROOT,
                        stdout=log, stderr=log,
                        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
                base = f"http://127.0.0.1:{port}"
                expected = "sample:" + hashlib.sha256(str(root).encode("utf-8")).hexdigest()
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline and self.process.poll() is None:
                    try:
                        with urlopen(base + "/api/workspace", timeout=1) as response:
                            state = json.load(response)["data"]
                        if state["profile_id"] != expected or state["credential_backend"] != "disabled" or state["trade_count"] != 36:
                            raise RuntimeError("Sample workspace failed readiness verification")
                        self.url = base + "/journal"
                        return self.url
                    except (URLError, TimeoutError, ConnectionError):
                        time.sleep(.1)
                raise RuntimeError("Sample workspace did not become ready")
            except Exception:
                self.close()
                raise


sample_process = SampleProcess()


@router.get("")
def status():
    return {"success": True, "data": workspace_status()}


@router.post("/acknowledge")
def acknowledge():
    if IS_SAMPLE:
        raise HTTPException(409, "Leave the sample workspace to set up your data")
    path = _preference_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text('{"acknowledged":true}', encoding="utf-8")
    temporary.replace(path)
    return {"success": True, "data": workspace_status()}


@router.post("/sample")
def enter_sample(request: Request, reset: bool = False):
    base = urlsplit(str(request.base_url))
    if IS_SAMPLE or base.scheme != "http" or base.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(409, "Sample exploration is available from the local normal workspace")
    try:
        url = sample_process.start(str(request.base_url).rstrip("/") + "/journal", reset=reset)
    except (OSError, RuntimeError, ValueError):
        raise HTTPException(503, "The isolated sample workspace could not be prepared. Your data was not changed.") from None
    return {"success": True, "data": {"url": url}}
