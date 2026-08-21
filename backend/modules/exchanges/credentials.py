"""Local-only persistence for read-only exchange credentials."""

from __future__ import annotations

import os
import re
import shlex
import tempfile
from pathlib import Path
from typing import Dict

from backend.config.settings import LOCAL_ENV_PATH

ENV_FILE = LOCAL_ENV_PATH


def save_local_exchange_credentials(exchange_id: str, api_key: str, secret_key: str, passphrase: str = "") -> None:
    prefix = exchange_id.upper()
    values = {
        f"{prefix}_API_KEY": _value(api_key),
        f"{prefix}_SECRET_KEY": _value(secret_key),
    }
    if passphrase:
        values[f"{prefix}_PASSPHRASE"] = _value(passphrase)

    existing = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.is_file() else ""
    output, replaced = [], set()
    pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=")
    for line in existing.splitlines():
        match = pattern.match(line.strip())
        key = match.group(1) if match else None
        if key in values:
            output.append(f"{key}={shlex.quote(values[key])}")
            replaced.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={shlex.quote(value)}" for key, value in values.items() if key not in replaced)

    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix=".env.", dir=str(ENV_FILE.parent), text=True)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write("\n".join(output).rstrip() + "\n")
        os.replace(temp_path, ENV_FILE)
        os.chmod(ENV_FILE, 0o600)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise
    os.environ.update(values)


def _value(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or "\n" in normalized or "\r" in normalized:
        raise ValueError("Invalid credential value")
    return normalized


__all__ = ["save_local_exchange_credentials"]
