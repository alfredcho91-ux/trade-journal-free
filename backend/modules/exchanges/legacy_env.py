"""Safe removal of legacy exchange credentials from a local .env file."""

from __future__ import annotations

import os
import re
import shlex
import tempfile
from functools import wraps
from threading import RLock

from backend.config.settings import LOCAL_ENV_KEYS_LOADED, LOCAL_ENV_PATH

ENV_FILE = LOCAL_ENV_PATH
_KEY_PATTERN = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=")
_LIFECYCLE_LOCK = RLock()


def serialized_credential_lifecycle(operation):
    """Serialize desktop request threads, including cross-exchange .env edits.

    The desktop process already has the OS-level single-instance guard. This
    reentrant lock also covers nested cleanup inside a load/save/delete, so an
    older environment snapshot cannot restore credentials after deletion.
    """
    @wraps(operation)
    def serialized(*args, **kwargs):
        with _LIFECYCLE_LOCK:
            return operation(*args, **kwargs)
    return serialized


class LegacyCleanupError(RuntimeError):
    """Legacy plaintext remains recoverable; cleanup must be retried."""


def _line_key(line: str):
    match = _KEY_PATTERN.match(line.strip())
    if match:
        return match.group(1)
    # Match quoted assignments accepted by settings._load_local_env as well.
    try:
        parts = shlex.split(line, comments=True, posix=True)
    except ValueError:
        return None
    if len(parts) == 1 and "=" in parts[0]:
        return parts[0].split("=", 1)[0]
    return None


def has_legacy_values(exchange_id: str) -> bool:
    return bool(legacy_keys(exchange_id).intersection(_env_file_keys()))


@serialized_credential_lifecycle
def remove_legacy_values(exchange_id: str) -> None:
    secret_keys = legacy_keys(exchange_id)
    try:
        if ENV_FILE.is_file():
            lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
            retained = [line for line in lines if _line_key(line) not in secret_keys]
            if retained != lines:
                _replace_env_file(retained)
    except (OSError, ValueError):
        # Never include file contents or low-level exception values in errors.
        raise LegacyCleanupError("Legacy credential cleanup failed; retry cleanup") from None
    for key in secret_keys.intersection(LOCAL_ENV_KEYS_LOADED):
        os.environ.pop(key, None)
        LOCAL_ENV_KEYS_LOADED.discard(key)


def legacy_keys(exchange_id: str) -> set[str]:
    prefix = exchange_id.upper()
    return {f"{prefix}_API_KEY", f"{prefix}_SECRET_KEY", f"{prefix}_PASSPHRASE"}


def _env_file_keys() -> set[str]:
    if not ENV_FILE.is_file():
        return set()
    try:
        return {key for line in ENV_FILE.read_text(encoding="utf-8").splitlines() if (key := _line_key(line))}
    except (OSError, ValueError):
        raise LegacyCleanupError("Legacy credential file could not be inspected; retry cleanup") from None


def _replace_env_file(lines: list[str]) -> None:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix=".env.", dir=str(ENV_FILE.parent), text=True)
    try:
        handle = os.fdopen(descriptor, "w", encoding="utf-8")
        descriptor = None  # Ownership transferred only after fdopen succeeds.
        with handle:
            # POSIX mode bits do not implement Windows ACLs. Windows uses the
            # same per-user directory's inherited ACL, not a chmod substitute.
            # New vault credentials are never written into this retained file.
            if os.name != "nt":
                os.fchmod(handle.fileno(), 0o600)
            if lines:
                handle.write("\n".join(lines).rstrip() + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, ENV_FILE)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        # Closed before unlink/replace, including write/flush/fsync failures.
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass


__all__ = ["ENV_FILE", "has_legacy_values", "legacy_keys", "remove_legacy_values"]
