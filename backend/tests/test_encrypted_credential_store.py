from __future__ import annotations

import base64
import sqlite3

import pytest

from backend.modules.exchanges import encrypted_store


def _key(byte: bytes) -> str:
    return base64.urlsafe_b64encode(byte * 32).decode("ascii")


def test_encrypted_store_round_trip_does_not_persist_plaintext(monkeypatch, tmp_path):
    db_path = tmp_path / "journal.db"
    monkeypatch.setenv(encrypted_store.MASTER_KEY_ENV, _key(b"a"))

    encrypted_store.save_encrypted_credentials("deepcoin", '{"secret_key":"never-write-plain"}', db_path=db_path)

    with sqlite3.connect(db_path) as connection:
        stored = connection.execute("SELECT encrypted_payload FROM exchange_credentials").fetchone()[0]
    assert "never-write-plain" not in stored
    assert encrypted_store.load_encrypted_credentials("deepcoin", db_path=db_path) == '{"secret_key":"never-write-plain"}'


def test_encrypted_store_rejects_wrong_master_key(monkeypatch, tmp_path):
    db_path = tmp_path / "journal.db"
    monkeypatch.setenv(encrypted_store.MASTER_KEY_ENV, _key(b"a"))
    encrypted_store.save_encrypted_credentials("deepcoin", "payload", db_path=db_path)
    monkeypatch.setenv(encrypted_store.MASTER_KEY_ENV, _key(b"b"))

    with pytest.raises(encrypted_store.EncryptedCredentialStoreError):
        encrypted_store.load_encrypted_credentials("deepcoin", db_path=db_path)


def test_encrypted_store_deletes_ciphertext(monkeypatch, tmp_path):
    db_path = tmp_path / "journal.db"
    monkeypatch.setenv(encrypted_store.MASTER_KEY_ENV, _key(b"a"))
    encrypted_store.save_encrypted_credentials("okx", "payload", db_path=db_path)

    assert encrypted_store.delete_encrypted_credentials("okx", db_path=db_path) is True
    assert encrypted_store.load_encrypted_credentials("okx", db_path=db_path) is None
