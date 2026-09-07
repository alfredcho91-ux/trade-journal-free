"""Credential policy and migration across environment, vault, and encrypted DB."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

from backend.config.settings import get_app_environment
from backend.modules.exchanges import legacy_env
from backend.modules.exchanges.encrypted_store import (
    EncryptedCredentialStoreError,
    delete_encrypted_credentials,
    has_master_key,
    load_encrypted_credentials,
    save_encrypted_credentials,
)
from backend.modules.exchanges.keyring_store import (
    KeyringStoreError,
    delete_keyring_payload,
    load_keyring_payload,
    save_keyring_payload,
)
from backend.modules.exchanges.legacy_env import has_legacy_values, remove_legacy_values

StorageMode = Literal["keyring", "encrypted_db"]
CredentialSource = Literal["environment", "keyring", "encrypted_db", "none"]


class CredentialStorageError(RuntimeError):
    """Raised when the configured credential store is unavailable."""


class CredentialCleanupPending(CredentialStorageError):
    """Protected persistence succeeded, but legacy cleanup needs a retry."""


CLEANUP_PENDING = "Protected credentials are available; legacy plaintext cleanup is pending. Retry from exchange settings."


@dataclass(frozen=True)
class StoredCredentials:
    api_key: str
    secret_key: str
    passphrase: str = ""


@dataclass(frozen=True)
class CredentialResolution:
    credentials: Optional[StoredCredentials]
    source: CredentialSource
    storage_error: Optional[str] = None


@dataclass(frozen=True)
class CredentialDeleteResult:
    deleted: bool
    environment_override: bool


def credential_storage_mode() -> StorageMode:
    configured = os.getenv("CREDENTIAL_STORAGE", "auto").strip().lower()
    if configured not in {"auto", "keyring", "encrypted_db"}:
        raise CredentialStorageError("CREDENTIAL_STORAGE must be auto, keyring, or encrypted_db")
    if configured == "encrypted_db" or (configured == "auto" and has_master_key()):
        return "encrypted_db"
    return "encrypted_db" if configured == "auto" and get_app_environment() == "production" else "keyring"


def resolve_exchange_credentials(exchange_id: str) -> CredentialResolution:
    """Resolve one credential set once, including its source and safe status."""
    try:
        return _resolve_exchange_credentials(exchange_id)
    except CredentialStorageError:
        return CredentialResolution(None, "none", "Protected credential storage is unavailable")


def load_exchange_credentials(exchange_id: str) -> Optional[StoredCredentials]:
    """Load credentials for backend API use and surface store failures to callers."""
    result = _resolve_exchange_credentials(exchange_id)
    return result.credentials


def credential_source(exchange_id: str) -> CredentialSource:
    """Compatibility helper for callers that only need storage metadata."""
    return resolve_exchange_credentials(exchange_id).source


@legacy_env.serialized_credential_lifecycle
def save_local_exchange_credentials(exchange_id: str, api_key: str, secret_key: str, passphrase: str = "") -> None:
    credentials = StoredCredentials(_value(api_key), _value(secret_key), _optional_value(passphrase))
    _save_payload(credential_storage_mode(), exchange_id, _serialize(credentials))
    if _cleanup_error(exchange_id):
        raise CredentialCleanupPending(CLEANUP_PENDING) from None


@legacy_env.serialized_credential_lifecycle
def delete_exchange_credentials(exchange_id: str) -> CredentialDeleteResult:
    """Remove persisted credentials; deployment environment values remain external."""
    mode = credential_storage_mode()
    # Never delete the authoritative store while stale plaintext can repopulate
    # it on restart. A failed cleanup leaves deletion visibly incomplete.
    if _cleanup_error(exchange_id):
        raise CredentialCleanupPending("Credentials were not deleted; legacy plaintext cleanup is pending. Retry from exchange settings.") from None
    if mode == "encrypted_db":
        deleted = _delete_encrypted(exchange_id)
        _best_effort_keyring_delete(exchange_id)
    else:
        deleted = _delete_keyring(exchange_id)
        _best_effort_encrypted_delete(exchange_id)
    return CredentialDeleteResult(deleted=deleted, environment_override=_environment_credentials(exchange_id) is not None)


@legacy_env.serialized_credential_lifecycle
def _resolve_exchange_credentials(exchange_id: str) -> CredentialResolution:
    environment = _environment_credentials(exchange_id)
    present_keys = {key for key in legacy_env.legacy_keys(exchange_id) if os.getenv(key)}
    loaded_keys = present_keys.intersection(legacy_env.LOCAL_ENV_KEYS_LOADED)
    if environment is not None and not loaded_keys:
        # Explicit deployment environment remains externally owned. Do not
        # write it into the vault just because an unrelated old .env exists.
        return CredentialResolution(environment, "environment", _cleanup_error(exchange_id))

    mode = credential_storage_mode()
    payload = _load_payload(mode, exchange_id)
    source: CredentialSource = mode if payload else "none"
    if payload is None and mode == "encrypted_db":
        payload = _load_keyring_for_migration(exchange_id)
        if payload:
            _save_payload("encrypted_db", exchange_id, payload)
            _best_effort_keyring_delete(exchange_id)
            source = "encrypted_db"
    credentials = _parse_payload(payload)
    if payload is not None and credentials is None:
        return CredentialResolution(None, "none", "Stored exchange credentials are invalid")
    if credentials is not None:
        # Store first: retry/restart must never overwrite newer protected values
        # from a stale .env loaded by settings at startup.
        return CredentialResolution(credentials, source, _cleanup_error(exchange_id))
    if environment is not None:
        if loaded_keys != present_keys:
            return CredentialResolution(None, "none", "Mixed deployment and legacy credentials require explicit configuration in exchange settings.")
        _save_payload(mode, exchange_id, _serialize(environment))
        return CredentialResolution(environment, mode, _cleanup_error(exchange_id))
    try:
        if has_legacy_values(exchange_id):
            return CredentialResolution(None, "none", "Legacy credentials could not be loaded. Restart or configure credentials in exchange settings.")
    except legacy_env.LegacyCleanupError:
        return CredentialResolution(None, "none", "Legacy credential file could not be inspected. Retry from exchange settings.")
    return CredentialResolution(None, "none")


def _save_payload(mode: StorageMode, exchange_id: str, payload: str) -> None:
    try:
        if mode == "encrypted_db":
            save_encrypted_credentials(exchange_id, payload)
        else:
            save_keyring_payload(exchange_id, payload)
    except (EncryptedCredentialStoreError, KeyringStoreError, OSError, ValueError, TypeError):
        raise CredentialStorageError("The configured credential store is unavailable") from None


def _load_payload(mode: StorageMode, exchange_id: str) -> Optional[str]:
    try:
        return load_encrypted_credentials(exchange_id) if mode == "encrypted_db" else load_keyring_payload(exchange_id)
    except (EncryptedCredentialStoreError, KeyringStoreError, OSError, ValueError, TypeError):
        raise CredentialStorageError("Stored exchange credentials could not be loaded") from None


def _load_keyring_for_migration(exchange_id: str) -> Optional[str]:
    try:
        return load_keyring_payload(exchange_id)
    except KeyringStoreError:
        return None


def _delete_encrypted(exchange_id: str) -> bool:
    try:
        return delete_encrypted_credentials(exchange_id)
    except (EncryptedCredentialStoreError, OSError):
        raise CredentialStorageError("Encrypted credentials could not be deleted") from None


def _delete_keyring(exchange_id: str) -> bool:
    try:
        return delete_keyring_payload(exchange_id)
    except KeyringStoreError:
        raise CredentialStorageError("Operating-system credentials could not be deleted") from None


def _best_effort_keyring_delete(exchange_id: str) -> None:
    try:
        delete_keyring_payload(exchange_id)
    except KeyringStoreError:
        pass


def _best_effort_encrypted_delete(exchange_id: str) -> None:
    try:
        delete_encrypted_credentials(exchange_id)
    except (EncryptedCredentialStoreError, OSError):
        pass


def _cleanup_error(exchange_id: str) -> Optional[str]:
    try:
        remove_legacy_values(exchange_id)
    except (legacy_env.LegacyCleanupError, OSError):
        return CLEANUP_PENDING
    return None


def _environment_credentials(exchange_id: str) -> Optional[StoredCredentials]:
    prefix = exchange_id.upper()
    api_key = os.getenv(f"{prefix}_API_KEY", "").strip()
    secret_key = os.getenv(f"{prefix}_SECRET_KEY", "")
    if not api_key or not secret_key:
        return None
    return StoredCredentials(api_key, secret_key, os.getenv(f"{prefix}_PASSPHRASE", ""))


def _serialize(credentials: StoredCredentials) -> str:
    return json.dumps(credentials.__dict__, separators=(",", ":"))


def _parse_payload(payload: Optional[str]) -> Optional[StoredCredentials]:
    if not payload:
        return None
    try:
        values = json.loads(payload)
        return StoredCredentials(
            _value(values.get("api_key", "")),
            _value(values.get("secret_key", "")),
            _optional_value(values.get("passphrase", "")),
        )
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _value(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized or "\n" in normalized or "\r" in normalized:
        raise ValueError("Invalid credential value")
    return normalized


def _optional_value(value: Any) -> str:
    normalized = str(value or "").strip()
    if "\n" in normalized or "\r" in normalized:
        raise ValueError("Invalid credential value")
    return normalized


__all__ = [
    "CredentialDeleteResult",
    "CredentialResolution",
    "CredentialStorageError",
    "StoredCredentials",
    "credential_source",
    "credential_storage_mode",
    "delete_exchange_credentials",
    "load_exchange_credentials",
    "resolve_exchange_credentials",
    "save_local_exchange_credentials",
]
