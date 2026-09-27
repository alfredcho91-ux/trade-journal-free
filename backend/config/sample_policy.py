"""Fail-closed startup boundary for the disposable, offline sample process."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile

IS_SAMPLE = os.environ.get("TRADE_JOURNAL_WORKSPACE") == "sample"


def validate_sample_root() -> Path:
    root = Path(os.environ.get("TRADE_JOURNAL_SAMPLE_ROOT", "")).resolve()
    if root.parent != Path(tempfile.gettempdir()).resolve() or not root.name.startswith("trade-journal-sample-"):
        raise RuntimeError("Sample workspace requires a dedicated temporary directory")
    marker = json.loads((root / "sample-owner.json").read_text(encoding="utf-8"))
    if not marker.get("token") or marker["token"] != os.environ.get("TRADE_JOURNAL_SAMPLE_TOKEN"):
        raise RuntimeError("Sample workspace ownership verification failed")
    expected = {
        "TRADE_JOURNAL_DATA_DIR": root,
        "JOURNAL_DIR": root / "journal",
        "JOURNAL_DB_PATH": root / "journal" / "trade_journal.db",
        "JOURNAL_CSV_PATH": root / "journal" / "unused.csv",
    }
    for name, path in expected.items():
        if not os.environ.get(name) or Path(os.environ[name]).resolve() != path:
            raise RuntimeError("Sample workspace paths failed isolation verification")
    if os.environ.get("CREDENTIAL_STORAGE") != "disabled":
        raise RuntimeError("Sample credentials must be disabled")
    return root


SAMPLE_ROOT = validate_sample_root() if IS_SAMPLE else None


def require_exchange_access() -> None:
    if IS_SAMPLE:
        raise PermissionError("Exchange access is unavailable in the sample workspace")


def install_offline_boundary() -> None:
    """Install after the event loop's Windows self-pipe is created, before serving.

    Incoming loopback HTTP remains available. Every outgoing socket connection,
    including loopback, is denied; sample pages cannot reach another profile.
    """
    if not IS_SAMPLE:
        return

    def offline(event, _args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
            raise PermissionError("Sample workspace is offline")

    sys.addaudithook(offline)
