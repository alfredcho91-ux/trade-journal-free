"""Safe removal of legacy exchange credentials from a local .env file."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from backend.config.settings import LOCAL_ENV_KEYS_LOADED, LOCAL_ENV_PATH

ENV_FILE = LOCAL_ENV_PATH
_KEY_PATTERN = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=")


def has_legacy_values(exchange_id: str) -> bool:
    return bool(legacy_keys(exchange_id).intersection(_env_file_keys()))


def remove_legacy_values(exchange_id: str) -> None:
    if not ENV_FILE.is_file():
        return
    secret_keys = legacy_keys(exchange_id)
    retained = [
        line
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines()
        if (match := _KEY_PATTERN.match(line.strip())) is None or match.group(1) not in secret_keys
    ]
    _replace_env_file(retained)
    for key in secret_keys.intersection(LOCAL_ENV_KEYS_LOADED):
        os.environ.pop(key, None)
        LOCAL_ENV_KEYS_LOADED.discard(key)


def legacy_keys(exchange_id: str) -> set[str]:
    prefix = exchange_id.upper()
    return {f"{prefix}_API_KEY", f"{prefix}_SECRET_KEY", f"{prefix}_PASSPHRASE"}


def _env_file_keys() -> set[str]:
    if not ENV_FILE.is_file():
        return set()
    return {
        match.group(1)
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines()
        if (match := _KEY_PATTERN.match(line.strip())) is not None
    }


def _replace_env_file(lines: list[str]) -> None:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix=".env.", dir=str(ENV_FILE.parent), text=True)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            if lines:
                handle.write("\n".join(lines).rstrip() + "\n")
        os.replace(temp_path, ENV_FILE)
        os.chmod(ENV_FILE, 0o600)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


__all__ = ["ENV_FILE", "has_legacy_values", "legacy_keys", "remove_legacy_values"]
