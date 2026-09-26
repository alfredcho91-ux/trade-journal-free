"""Incident regressions: synthetic credentials, injected vault, temporary DB only."""
import base64
import json
import os
import subprocess
import sys
import traceback
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.config import settings
from backend.modules.exchanges import credentials, encrypted_store, keyring_store, legacy_env
from backend.modules.exchanges.router import router

PAYLOAD = json.dumps({"api_key": "synthetic-api", "secret_key": "synthetic-secret", "passphrase": "synthetic-pass"})
KEY = base64.urlsafe_b64encode(b"t" * 32).decode()


class Vault:
    def __init__(self):
        self.values = {}
        self.calls = []

    def get_password(self, service, account):
        self.calls.append(("get", service, account))
        return self.values.get((service, account))

    def set_password(self, service, account, value):
        self.calls.append(("set", service, account))
        self.values[(service, account)] = value

    def delete_password(self, service, account):
        self.calls.append(("delete", service, account))
        self.values.pop((service, account), None)


@pytest.fixture
def state(monkeypatch, tmp_path):
    normal = tmp_path / "normal"
    normal.mkdir()
    vault = Vault()
    vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] = PAYLOAD
    monkeypatch.setattr(settings, "_default_app_data_dir", lambda: normal)
    monkeypatch.setattr(keyring_store, "_keyring_module", lambda: vault)
    monkeypatch.setenv("CREDENTIAL_STORAGE", "encrypted_db")
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", KEY)
    for exchange in ("binance", "deepcoin", "okx", "bybit"):
        for key in legacy_env.legacy_keys(exchange):
            monkeypatch.delenv(key, raising=False)
    loaded = set()
    monkeypatch.setattr(settings, "LOCAL_ENV_KEYS_LOADED", loaded)
    monkeypatch.setattr(legacy_env, "LOCAL_ENV_KEYS_LOADED", loaded)

    def profile(root, *, db=None):
        journal = root / "journal"
        database = db or journal / "trade_journal.db"
        monkeypatch.setattr(settings, "APP_DATA_DIR", root)
        monkeypatch.setattr(settings, "PROJECT_ROOT", root)
        monkeypatch.setattr(settings, "JOURNAL_DIR", journal)
        monkeypatch.setattr(settings, "JOURNAL_DB_PATH", database)
        monkeypatch.setattr(encrypted_store, "JOURNAL_DB_PATH", database)
        monkeypatch.setattr(settings, "LOCAL_ENV_PATH", normal / ".env")
        monkeypatch.setattr(legacy_env, "ENV_FILE", normal / ".env")
        monkeypatch.setenv("TRADE_JOURNAL_DATA_DIR", str(root))
        monkeypatch.setenv("JOURNAL_DIR", str(journal))
        monkeypatch.setenv("JOURNAL_DB_PATH", str(database))
        return database

    db = profile(normal)
    return SimpleNamespace(normal=normal, vault=vault, profile=profile, db=db, loaded=loaded)


def status():
    # Only this router, no production startup/lifespan or market requests.
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.get("/api/exchanges")
    assert response.status_code == 200
    return response.json()["data"]["exchanges"]


@pytest.mark.parametrize("mode", ["encrypted_db", "keyring", "auto"])
@pytest.mark.parametrize("override", ["root", "db", "journal"])
def test_custom_status_never_reads_or_mutates_normal_sources(state, monkeypatch, tmp_path, mode, override):
    original = "DEEPCOIN_API_KEY=synthetic-env-api\nDEEPCOIN_SECRET_KEY=synthetic-env-secret\n"
    (state.normal / ".env").write_text(original)
    if override == "root":
        state.profile(tmp_path / "isolated")
    elif override == "db":
        state.profile(state.normal, db=tmp_path / "isolated.db")
    else:
        monkeypatch.setattr(settings, "JOURNAL_DIR", tmp_path / "other-journal")
        monkeypatch.setenv("JOURNAL_DIR", str(tmp_path / "other-journal"))
        monkeypatch.setattr(encrypted_store, "JOURNAL_DB_PATH", tmp_path / "other-journal" / "journal.db")
    monkeypatch.setenv("CREDENTIAL_STORAGE", mode)
    settings._load_local_env()
    assert not state.loaded
    result = credentials.resolve_exchange_credentials("deepcoin")
    assert result.credentials is None
    assert all(not item["configured"] for item in status())
    assert all(call[1] != keyring_store.SERVICE_NAME for call in state.vault.calls)
    assert all(call[0] == "get" for call in state.vault.calls)
    credentials.delete_exchange_credentials("deepcoin")
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
    assert (state.normal / ".env").read_text() == original


def test_normal_copy_verified_source_preserved_and_repeated_read_does_not_write(state, monkeypatch):
    calls = []
    save = credentials.save_encrypted_credentials

    def record(*args, **kwargs):
        calls.append("save")
        return save(*args, **kwargs)

    monkeypatch.setattr(credentials, "save_encrypted_credentials", record)
    monkeypatch.setattr(credentials, "remove_legacy_values", lambda *_: pytest.fail("read cleanup"))
    for _ in range(3):
        result = credentials.resolve_exchange_credentials("deepcoin")
        assert result.source == "encrypted_db"
        assert result.credentials == credentials._parse_payload(PAYLOAD)
    assert calls == ["save"]
    assert credentials._parse_payload(encrypted_store.load_encrypted_credentials("deepcoin")) == result.credentials
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
    assert state.vault.calls == [("get", keyring_store.SERVICE_NAME, "deepcoin")]


def test_normal_keyring_credentials_remain_usable_without_migration(state, monkeypatch):
    monkeypatch.setenv("CREDENTIAL_STORAGE", "keyring")
    monkeypatch.setattr(credentials, "save_encrypted_credentials", lambda *_a, **_k: pytest.fail("unrequested migration"))
    result = credentials.resolve_exchange_credentials("deepcoin")
    assert result.source == "keyring"
    assert result.credentials == credentials._parse_payload(PAYLOAD)
    assert next(item for item in status() if item["id"] == "deepcoin")["configured"]
    assert not any(call[0] != "get" for call in state.vault.calls)


@pytest.mark.parametrize("payload", ["", "not-json", "[]", "null", "42", '{"api_key": 123, "secret_key": "s"}', '{"api_key":"a"}', '{"api_key":"a", "secret_key":"b", "passphrase":{}}'])
def test_invalid_source_not_written_or_deleted(state, monkeypatch, payload):
    state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] = payload
    monkeypatch.setattr(credentials, "save_encrypted_credentials", lambda *_a, **_k: pytest.fail("invalid source written"))
    result = credentials.resolve_exchange_credentials("deepcoin")
    assert result.credentials is None
    assert result.storage_error == "Stored exchange credentials are invalid"
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == payload
    assert encrypted_store.load_encrypted_credentials("deepcoin") is None


@pytest.mark.parametrize("fault", ["db_write", "missing_key", "invalid_key", "readback", "mismatch"])
def test_failed_copy_preserves_source_and_no_secrets_in_errors(state, monkeypatch, caplog, fault):
    def fail(*args, **kwargs):
        raise encrypted_store.EncryptedCredentialStoreError(PAYLOAD + KEY)

    with monkeypatch.context() as patch:
        if fault == "db_write":
            patch.setattr(credentials, "save_encrypted_credentials", fail)
        elif fault == "missing_key":
            patch.delenv("CREDENTIAL_MASTER_KEY")
        elif fault == "invalid_key":
            patch.setenv("CREDENTIAL_MASTER_KEY", "invalid-synthetic-key")
        else:
            read = credentials.load_encrypted_credentials
            count = 0

            def readback(*args, **kwargs):
                nonlocal count
                count += 1
                if count > 1:
                    if fault == "readback":
                        return fail()
                    return PAYLOAD.replace("synthetic-api", "different-api")
                return read(*args, **kwargs)

            patch.setattr(credentials, "load_encrypted_credentials", readback)
        with pytest.raises(credentials.CredentialStorageError) as error:
            credentials.load_exchange_credentials("deepcoin")
        output = "".join(traceback.format_exception(error.value)) + caplog.text
        for secret in ("synthetic-api", "synthetic-secret", "synthetic-pass", KEY):
            assert secret not in output
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
    assert not any(call[0] == "delete" for call in state.vault.calls)
    assert credentials.resolve_exchange_credentials("deepcoin").credentials is not None


def test_existing_destination_wins_without_legacy_lookup(state):
    current = PAYLOAD.replace("synthetic-api", "newer-api")
    encrypted_store.save_encrypted_credentials("deepcoin", current)
    assert credentials.load_exchange_credentials("deepcoin").api_key == "newer-api"
    assert state.vault.calls == []
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD


def test_concurrent_destination_save_cannot_be_overwritten_by_migration(state, monkeypatch):
    def racing_save(exchange, payload, **kwargs):
        # Another connection commits after the migration's empty-destination read.
        encrypted_store.save_encrypted_credentials(exchange, PAYLOAD.replace("synthetic-api", "newer-api"))
        return encrypted_store.save_encrypted_credentials(exchange, payload, **kwargs)

    monkeypatch.setattr(credentials, "save_encrypted_credentials", racing_save)
    assert credentials.load_exchange_credentials("deepcoin").api_key == "newer-api"
    assert credentials._parse_payload(encrypted_store.load_encrypted_credentials("deepcoin")).api_key == "newer-api"
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD


@pytest.mark.parametrize("mode", ["keyring", "encrypted_db"])
def test_multiple_profiles_save_read_delete_isolated(state, monkeypatch, tmp_path, mode):
    monkeypatch.setenv("CREDENTIAL_STORAGE", mode)
    for name in ("a", "b"):
        state.profile(tmp_path / name)
        credentials.save_local_exchange_credentials("deepcoin", name, "synthetic-secret")
    for name in ("a", "b"):
        state.profile(tmp_path / name)
        assert credentials.load_exchange_credentials("deepcoin").api_key == name
    state.profile(tmp_path / "a")
    credentials.delete_exchange_credentials("deepcoin")
    assert credentials.load_exchange_credentials("deepcoin") is None
    state.profile(tmp_path / "b")
    assert credentials.load_exchange_credentials("deepcoin").api_key == "b"
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
    assert all(call[1] != keyring_store.SERVICE_NAME for call in state.vault.calls)


def test_status_never_deletes_sources_including_owned_env(state, monkeypatch):
    env = state.normal / ".env"
    original = "BINANCE_API_KEY=synthetic-env-api\nBINANCE_SECRET_KEY=synthetic-env-secret\n"
    env.write_text(original)
    settings._load_local_env()
    monkeypatch.setattr(credentials, "remove_legacy_values", lambda *_: pytest.fail("status cleanup"))
    for _ in range(2):
        assert all(item["configured"] for item in status())
    assert env.read_text() == original
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
    assert not any(call[0] == "delete" for call in state.vault.calls)


def test_inherited_loaded_legacy_values_are_not_consumed_by_custom_profile(state, tmp_path, monkeypatch):
    state.loaded.update(legacy_env.legacy_keys("deepcoin"))
    monkeypatch.setenv("DEEPCOIN_API_KEY", "synthetic-env-api")
    monkeypatch.setenv("DEEPCOIN_SECRET_KEY", "synthetic-env-secret")
    state.profile(tmp_path / "custom")
    assert credentials.load_exchange_credentials("deepcoin") is None


def test_namespace_stable_for_resolved_alias_and_distinct_for_source_checkout(state, monkeypatch, tmp_path):
    assert settings.credential_profile_id() == "normal"
    state.profile(state.normal / ".")
    assert settings.credential_profile_id() == "normal"
    monkeypatch.setattr(settings, "PROJECT_ROOT", tmp_path / "source")
    assert settings.credential_profile_id() != "normal"


@pytest.mark.parametrize("override", ["none", "root", "db", "journal"])
def test_frozen_startup_profile_selection_precedes_env_loading(tmp_path, override):
    env = os.environ.copy()
    if sys.platform == "win32":
        platform_root = tmp_path / "roaming"
        env["APPDATA"] = str(platform_root)
        normal = platform_root / "Trade Journal Free"
    elif sys.platform == "darwin":
        platform_root = tmp_path / "home"
        env["HOME"] = str(platform_root)
        normal = platform_root / "Library" / "Application Support" / "Trade Journal Free"
    else:
        platform_root = tmp_path / "xdg-data"
        env["XDG_DATA_HOME"] = str(platform_root)
        normal = platform_root / "trade-journal-free"
    normal.mkdir(parents=True)
    (normal / ".env").write_text("DEEPCOIN_API_KEY=synthetic-env-api\nDEEPCOIN_SECRET_KEY=synthetic-env-secret\n")
    for name in ("TRADE_JOURNAL_DATA_DIR", "JOURNAL_DIR", "JOURNAL_DB_PATH", "DEEPCOIN_API_KEY", "DEEPCOIN_SECRET_KEY"):
        env.pop(name, None)
    if override != "none":
        name = {"root": "TRADE_JOURNAL_DATA_DIR", "db": "JOURNAL_DB_PATH", "journal": "JOURNAL_DIR"}[override]
        env[name] = str(tmp_path / "isolated")
    code = """
import os, sys
sys.frozen = True
from backend.config import settings
normal = sys.argv[1] == 'none'
diagnostics = {
    'sys_frozen': bool(getattr(sys, 'frozen', False)),
    'sys_executable': sys.executable,
    'profile_environment': {key: os.getenv(key) for key in ('APPDATA', 'XDG_DATA_HOME', 'HOME', 'TRADE_JOURNAL_DATA_DIR', 'JOURNAL_DIR', 'JOURNAL_DB_PATH')},
    'app_data_dir': str(settings.APP_DATA_DIR),
    'project_root': str(settings.PROJECT_ROOT),
    'journal_dir': str(settings.JOURNAL_DIR),
    'journal_db_path': str(settings.JOURNAL_DB_PATH),
    'local_env_path': str(settings.LOCAL_ENV_PATH),
    'expected_profile_identity': 'normal' if normal else 'isolated',
    'actual_profile_identity': settings.credential_profile_id(),
    'expected_credential_env_loaded': normal,
    'actual_credential_env_loaded': 'DEEPCOIN_API_KEY' in os.environ,
    'expected_local_env_owned': normal,
    'actual_local_env_owned': settings.owns_local_credential_env(),
}
print(diagnostics)
assert (diagnostics['actual_profile_identity'] == 'normal') == normal, diagnostics
assert diagnostics['actual_credential_env_loaded'] == normal, diagnostics
assert diagnostics['actual_local_env_owned'] == normal, diagnostics
"""
    result = subprocess.run([sys.executable, "-B", "-c", code, override], env=env, cwd=settings.SOURCE_ROOT, capture_output=True)
    assert result.returncode == 0, f"Synthetic packaged-settings probe failed\nstdout:\n{result.stdout.decode(errors='replace')}\nstderr:\n{result.stderr.decode(errors='replace')}"


def test_path_override_inside_env_does_not_carry_credentials_into_new_profile(state):
    env = state.normal / ".env"
    env.write_text(f"APP_ENV=production\nJOURNAL_DB_PATH={state.normal.as_posix()}/other.db\nDEEPCOIN_API_KEY=synthetic-env-api\nDEEPCOIN_SECRET_KEY=synthetic-env-secret\n")
    os.environ.pop("JOURNAL_DB_PATH")
    os.environ.pop("APP_ENV")
    settings._load_local_env()
    assert not os.getenv("DEEPCOIN_API_KEY")
    assert not settings.owns_local_credential_env()
    assert settings.credential_profile_id() != "normal"
    assert settings.get_app_environment() == "production"
    assert env.is_file()


def test_restart_without_ephemeral_key_keeps_source_and_persistent_key_reads_destination(state):
    credentials.load_exchange_credentials("deepcoin")
    code = """
import keyring
keyring.get_keyring = lambda: (_ for _ in ()).throw(AssertionError('OS vault forbidden'))
from backend.modules.exchanges.encrypted_store import load_encrypted_credentials, EncryptedCredentialStoreError
import json, sys
try:
    result = json.loads(load_encrypted_credentials('deepcoin'))
    assert result['api_key'] == 'synthetic-api'
    assert sys.argv[1] == 'available'
except EncryptedCredentialStoreError:
    assert sys.argv[1] == 'unavailable'
"""
    for expected in ("available", "unavailable"):
        env = os.environ.copy()
        if expected == "unavailable":
            env.pop("CREDENTIAL_MASTER_KEY", None)
        result = subprocess.run([sys.executable, "-B", "-c", code, expected], env=env, cwd=settings.SOURCE_ROOT, capture_output=True)
        assert result.returncode == 0, "Synthetic restart probe failed"
    assert state.vault.values[(keyring_store.SERVICE_NAME, "deepcoin")] == PAYLOAD
