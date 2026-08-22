from __future__ import annotations

import json
import os
import base64

from backend.modules.exchanges import credentials, encrypted_store, keyring_store, legacy_env, service


class FakeKeyring:
    def __init__(self):
        self.values = {}

    def set_password(self, service_name, account, password):
        self.values[(service_name, account)] = password

    def get_password(self, service_name, account):
        return self.values.get((service_name, account))

    def delete_password(self, service_name, account):
        del self.values[(service_name, account)]


def test_exchange_credentials_use_os_vault_and_scrub_legacy_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("OTHER=value\nOKX_API_KEY=old\nOKX_SECRET_KEY=old-secret\n", encoding="utf-8")
    keyring = FakeKeyring()
    monkeypatch.setattr(legacy_env, "ENV_FILE", env_file)
    monkeypatch.setattr(keyring_store, "_keyring_module", lambda: keyring)

    credentials.save_local_exchange_credentials("okx", "api key", "secret", "pass phrase")

    saved = json.loads(keyring.values[(keyring_store.SERVICE_NAME, "okx")])
    assert saved == {"api_key": "api key", "secret_key": "secret", "passphrase": "pass phrase"}
    assert env_file.read_text(encoding="utf-8") == "OTHER=value\n"
    assert os.stat(env_file).st_mode & 0o777 == 0o600
    assert credentials.load_exchange_credentials("okx") == credentials.StoredCredentials(
        "api key", "secret", "pass phrase"
    )


def test_legacy_environment_credentials_are_migrated(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("BINANCE_API_KEY=api\nBINANCE_SECRET_KEY=secret\n", encoding="utf-8")
    keyring = FakeKeyring()
    monkeypatch.setattr(legacy_env, "ENV_FILE", env_file)
    monkeypatch.setattr(keyring_store, "_keyring_module", lambda: keyring)
    monkeypatch.setenv("BINANCE_API_KEY", "api")
    monkeypatch.setenv("BINANCE_SECRET_KEY", "secret")

    loaded = credentials.load_exchange_credentials("binance")

    assert loaded == credentials.StoredCredentials("api", "secret", "")
    assert env_file.read_text(encoding="utf-8") == ""
    assert (keyring_store.SERVICE_NAME, "binance") in keyring.values


def test_ccxt_connection_is_verified_before_credentials_are_saved(monkeypatch):
    calls = []

    class FakeClient:
        def fetch_balance(self):
            calls.append("verified")
            return {}

    saved = []
    monkeypatch.setattr(service, "_exchange_client", lambda *args: FakeClient())
    monkeypatch.setattr(service, "save_local_exchange_credentials", lambda *values: saved.append(values))
    monkeypatch.setattr(service, "exchange_status_service", lambda: {"success": True, "data": {"exchanges": []}})

    result = service.configure_exchange_credentials_service("binance", "api", "secret")

    assert calls == ["verified"]
    assert saved == [("binance", "api", "secret", "")]
    assert result == {"success": True, "data": {"exchanges": []}}


def test_saved_credentials_can_be_deleted(monkeypatch, tmp_path):
    keyring = FakeKeyring()
    monkeypatch.setattr(legacy_env, "ENV_FILE", tmp_path / ".env")
    monkeypatch.setattr(keyring_store, "_keyring_module", lambda: keyring)
    monkeypatch.setenv("CREDENTIAL_STORAGE", "keyring")
    credentials.save_local_exchange_credentials("deepcoin", "api", "secret", "pass")

    result = credentials.delete_exchange_credentials("deepcoin")

    assert result.deleted is True
    assert result.environment_override is False
    assert credentials.load_exchange_credentials("deepcoin") is None


def test_production_storage_round_trip_uses_encrypted_database(monkeypatch, tmp_path):
    key = base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_STORAGE", "auto")
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", key)
    monkeypatch.setattr(encrypted_store, "JOURNAL_DB_PATH", tmp_path / "journal.db")
    monkeypatch.setattr(legacy_env, "ENV_FILE", tmp_path / ".env")
    monkeypatch.setattr(
        keyring_store,
        "_keyring_module",
        lambda: (_ for _ in ()).throw(AssertionError("keyring must not be used")),
    )

    credentials.save_local_exchange_credentials("deepcoin", "api", "secret", "pass")

    assert credentials.credential_source("deepcoin") == "encrypted_db"
    assert credentials.load_exchange_credentials("deepcoin") == credentials.StoredCredentials(
        "api", "secret", "pass"
    )
    assert credentials.delete_exchange_credentials("deepcoin").deleted is True


def test_credential_resolution_reports_unavailable_store(monkeypatch):
    monkeypatch.setenv("CREDENTIAL_STORAGE", "keyring")
    monkeypatch.setattr(
        keyring_store,
        "_keyring_module",
        lambda: (_ for _ in ()).throw(RuntimeError("vault unavailable")),
    )

    resolved = credentials.resolve_exchange_credentials("deepcoin")

    assert resolved.credentials is None
    assert resolved.source == "none"
    assert resolved.storage_error == "Protected credential storage is unavailable"
