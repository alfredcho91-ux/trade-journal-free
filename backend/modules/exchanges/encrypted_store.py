"""AES-GCM encrypted credential persistence for server deployments."""

from __future__ import annotations

import base64
import json
import os
import sqlite3
from pathlib import Path
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.config.settings import JOURNAL_DB_PATH

MASTER_KEY_ENV = "CREDENTIAL_MASTER_KEY"
_ALGORITHM = "AES-256-GCM"
_VERSION = 1


class EncryptedCredentialStoreError(RuntimeError):
    """Raised when encrypted credential storage cannot be used safely."""


def save_encrypted_credentials(exchange_id: str, payload: str, *, db_path: Optional[Path] = None) -> None:
    envelope = _encrypt(exchange_id, payload)
    try:
        with _connect(db_path) as connection:
            _ensure_table(connection)
            connection.execute(
                """
                INSERT INTO exchange_credentials (exchange_id, encrypted_payload, encryption_version, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(exchange_id) DO UPDATE SET
                    encrypted_payload = excluded.encrypted_payload,
                    encryption_version = excluded.encryption_version,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (exchange_id.lower(), envelope, _VERSION),
            )
    except sqlite3.Error as exc:
        raise EncryptedCredentialStoreError("Encrypted credential database is unavailable") from exc


def load_encrypted_credentials(exchange_id: str, *, db_path: Optional[Path] = None) -> Optional[str]:
    try:
        with _connect(db_path) as connection:
            _ensure_table(connection)
            row = connection.execute(
                "SELECT encrypted_payload FROM exchange_credentials WHERE exchange_id = ?",
                (exchange_id.lower(),),
            ).fetchone()
    except sqlite3.Error as exc:
        raise EncryptedCredentialStoreError("Encrypted credential database is unavailable") from exc
    if row is None:
        return None
    return _decrypt(exchange_id, str(row[0]))


def delete_encrypted_credentials(exchange_id: str, *, db_path: Optional[Path] = None) -> bool:
    try:
        with _connect(db_path) as connection:
            _ensure_table(connection)
            cursor = connection.execute(
                "DELETE FROM exchange_credentials WHERE exchange_id = ?",
                (exchange_id.lower(),),
            )
    except sqlite3.Error as exc:
        raise EncryptedCredentialStoreError("Encrypted credential database is unavailable") from exc
    return cursor.rowcount > 0


def has_master_key() -> bool:
    return bool(os.getenv(MASTER_KEY_ENV, "").strip())


def _connect(db_path: Optional[Path]) -> sqlite3.Connection:
    path = Path(db_path or JOURNAL_DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30)
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def _ensure_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS exchange_credentials (
            exchange_id TEXT PRIMARY KEY,
            encrypted_payload TEXT NOT NULL,
            encryption_version INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _encrypt(exchange_id: str, plaintext: str) -> str:
    nonce = os.urandom(12)
    ciphertext = AESGCM(_master_key()).encrypt(nonce, plaintext.encode("utf-8"), _aad(exchange_id))
    return json.dumps(
        {
            "v": _VERSION,
            "alg": _ALGORITHM,
            "nonce": _encode(nonce),
            "ciphertext": _encode(ciphertext),
        },
        separators=(",", ":"),
    )


def _decrypt(exchange_id: str, envelope_text: str) -> str:
    try:
        envelope = json.loads(envelope_text)
        if envelope.get("v") != _VERSION or envelope.get("alg") != _ALGORITHM:
            raise EncryptedCredentialStoreError("Unsupported credential encryption format")
        return AESGCM(_master_key()).decrypt(
            _decode(envelope["nonce"]),
            _decode(envelope["ciphertext"]),
            _aad(exchange_id),
        ).decode("utf-8")
    except EncryptedCredentialStoreError:
        raise
    except (InvalidTag, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise EncryptedCredentialStoreError(
            "Stored credentials could not be decrypted with the configured master key"
        ) from exc


def _master_key() -> bytes:
    encoded = os.getenv(MASTER_KEY_ENV, "").strip()
    if not encoded:
        raise EncryptedCredentialStoreError(f"{MASTER_KEY_ENV} is required for encrypted credential storage")
    try:
        key = _decode(encoded)
    except (ValueError, TypeError) as exc:
        raise EncryptedCredentialStoreError(f"{MASTER_KEY_ENV} must be URL-safe base64") from exc
    if len(key) != 32:
        raise EncryptedCredentialStoreError(f"{MASTER_KEY_ENV} must decode to exactly 32 bytes")
    return key


def _aad(exchange_id: str) -> bytes:
    return f"trade-journal-free:exchange-credential:{exchange_id.lower()}:v{_VERSION}".encode("utf-8")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    normalized = str(value)
    return base64.urlsafe_b64decode(normalized + "=" * (-len(normalized) % 4))


__all__ = [
    "EncryptedCredentialStoreError",
    "MASTER_KEY_ENV",
    "delete_encrypted_credentials",
    "has_master_key",
    "load_encrypted_credentials",
    "save_encrypted_credentials",
]
