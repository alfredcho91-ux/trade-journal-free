"""Failure/restart tests use isolated fake credentials and an in-memory vault."""

import os
import traceback
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from backend.config import settings
from backend.modules.exchanges import credentials, keyring_store, legacy_env, service
from backend.utils.error_handler import BusinessLogicError


@pytest.fixture
def state(monkeypatch, tmp_path):
    path = tmp_path / ".env"
    loaded = set()
    values = {}
    writes = []
    monkeypatch.setenv("CREDENTIAL_STORAGE", "keyring")
    monkeypatch.setenv("APP_ENV", "development")
    for key in legacy_env.legacy_keys("binance"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(legacy_env, "ENV_FILE", path)
    monkeypatch.setattr(settings, "LOCAL_ENV_PATH", path)
    monkeypatch.setattr(settings, "LOCAL_ENV_KEYS_LOADED", loaded)
    monkeypatch.setattr(legacy_env, "LOCAL_ENV_KEYS_LOADED", loaded)

    def save(exchange, payload):
        writes.append(payload)
        values[exchange] = payload

    monkeypatch.setattr(credentials, "save_keyring_payload", save)
    monkeypatch.setattr(credentials, "load_keyring_payload", lambda exchange: values.get(exchange))
    monkeypatch.setattr(credentials, "delete_keyring_payload", lambda exchange: values.pop(exchange, None) is not None)
    monkeypatch.setattr(credentials, "delete_encrypted_credentials", lambda exchange: False)

    def restart():
        for key in legacy_env.legacy_keys("binance"):
            monkeypatch.delenv(key, raising=False)
        loaded.clear()
        settings._load_local_env()

    def legacy():
        path.write_text("OTHER=keep\nBINANCE_API_KEY=fake-old-api\nBINANCE_SECRET_KEY=fake-old-secret\n", encoding="utf-8")
        restart()

    return SimpleNamespace(path=path, loaded=loaded, values=values, writes=writes, restart=restart, legacy=legacy)


def assert_no_temps(state):
    assert list(state.path.parent.glob(".env.*")) == []


def fail_replace(*args):
    raise OSError("fake-old-secret fake-new-secret")


def test_save_partial_failure_retry_and_restart_keep_vault_authoritative(state, monkeypatch, caplog):
    state.legacy()
    original = state.path.read_bytes()
    new_secret = "fake-new-secret"
    with monkeypatch.context() as fault:
        fault.setattr(legacy_env.os, "replace", fail_replace)
        with pytest.raises(credentials.CredentialCleanupPending) as error:
            credentials.save_local_exchange_credentials("binance", "fake-new-api", new_secret)
        assert "cleanup is pending" in str(error.value)
        formatted = "".join(traceback.format_exception(error.value))
        assert "fake-new-secret" not in formatted
        assert "fake-old-secret" not in formatted
        assert state.path.read_bytes() == original
        assert_no_temps(state)
        for _ in range(3):
            state.restart()
            result = credentials.resolve_exchange_credentials("binance")
            assert result.credentials == credentials.StoredCredentials("fake-new-api", "fake-new-secret")
            assert result.source == "keyring"
            assert result.storage_error == credentials.CLEANUP_PENDING
            assert len(state.writes) == 1
            assert_no_temps(state)
    state.restart()
    for _ in range(3):
        result = credentials.resolve_exchange_credentials("binance")
        assert result.credentials.api_key == "fake-new-api"
        assert result.storage_error is None
        state.restart()
    assert len(state.writes) == 1
    assert state.path.read_text(encoding="utf-8") == "OTHER=keep\n"
    assert not state.loaded
    assert not os.getenv("BINANCE_SECRET_KEY")
    assert "fake-old-secret" not in caplog.text
    assert "fake-new-secret" not in caplog.text


def test_automatic_migration_partial_failure_is_visible_and_idempotent(state, monkeypatch):
    state.legacy()
    with monkeypatch.context() as fault:
        fault.setattr(legacy_env.os, "replace", fail_replace)
        for _ in range(3):
            result = credentials.resolve_exchange_credentials("binance")
            assert result.credentials.api_key == "fake-old-api"
            assert result.storage_error == credentials.CLEANUP_PENDING
            state.restart()
        assert len(state.writes) == 1
        assert_no_temps(state)
    result = credentials.resolve_exchange_credentials("binance")
    assert result.storage_error is None
    assert len(state.writes) == 1
    assert state.path.read_text(encoding="utf-8") == "OTHER=keep\n"


def test_vault_write_failure_preserves_legacy_for_retry(state, monkeypatch, caplog):
    state.legacy()
    original = state.path.read_bytes()

    def unavailable(*args):
        raise keyring_store.KeyringStoreError("fake-old-secret")

    with monkeypatch.context() as fault:
        fault.setattr(credentials, "save_keyring_payload", unavailable)
        result = credentials.resolve_exchange_credentials("binance")
        assert result.credentials is None
        assert result.storage_error == "Protected credential storage is unavailable"
        with pytest.raises(credentials.CredentialStorageError) as error:
            credentials.load_exchange_credentials("binance")
        assert "fake-old-secret" not in "".join(traceback.format_exception(error.value))
        assert state.path.read_bytes() == original
        assert not state.values
        assert_no_temps(state)
    state.restart()
    assert credentials.load_exchange_credentials("binance").api_key == "fake-old-api"
    assert len(state.writes) == 1
    assert "fake-old-secret" not in caplog.text


def test_delete_failure_keeps_authoritative_store_until_cleanup_finishes(state, monkeypatch):
    credentials.save_local_exchange_credentials("binance", "fake-new-api", "fake-new-secret")
    state.legacy()
    with monkeypatch.context() as fault:
        fault.setattr(legacy_env.os, "replace", fail_replace)
        with pytest.raises(credentials.CredentialCleanupPending, match="not deleted"):
            credentials.delete_exchange_credentials("binance")
        assert "binance" in state.values
        state.restart()
        assert credentials.load_exchange_credentials("binance").api_key == "fake-new-api"
        assert_no_temps(state)
    assert credentials.delete_exchange_credentials("binance").deleted
    state.restart()
    assert credentials.resolve_exchange_credentials("binance").credentials is None
    assert not credentials.delete_exchange_credentials("binance").deleted
    assert not state.values


@pytest.mark.parametrize("failure", ["fdopen", "write", "flush", "fsync", "replace"])
def test_injected_file_failures_close_descriptors_and_remove_temps(state, monkeypatch, failure):
    state.legacy()
    original = state.path.read_bytes()
    descriptors = []
    real_mkstemp = legacy_env.tempfile.mkstemp
    real_fdopen = legacy_env.os.fdopen

    def track(*args, **kwargs):
        descriptor, path = real_mkstemp(*args, **kwargs)
        descriptors.append(descriptor)
        return descriptor, path

    class FaultyHandle:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def fileno(self):
            return self.handle.fileno()

        def write(self, value):
            if failure == "write":
                raise OSError("fake-old-secret")
            return self.handle.write(value)

        def flush(self):
            if failure == "flush":
                raise OSError("fake-old-secret")
            return self.handle.flush()

    def fdopen(*args, **kwargs):
        if failure == "fdopen":
            raise OSError("fake-old-secret")
        return FaultyHandle(real_fdopen(*args, **kwargs))

    monkeypatch.setattr(legacy_env.tempfile, "mkstemp", track)
    monkeypatch.setattr(legacy_env.os, "fdopen", fdopen)
    if failure in {"fsync", "replace"}:
        monkeypatch.setattr(legacy_env.os, failure, fail_replace)
    with pytest.raises(legacy_env.LegacyCleanupError) as error:
        legacy_env.remove_legacy_values("binance")
    assert "fake-old-secret" not in "".join(traceback.format_exception(error.value))
    assert len(descriptors) == 1
    with pytest.raises(OSError):
        os.fstat(descriptors[0])
    assert state.path.read_bytes() == original
    assert state.loaded  # Only cleared after successful atomic replacement.
    assert_no_temps(state)


def test_native_platform_file_security_and_no_plaintext_downgrade(state, monkeypatch):
    state.legacy()
    if os.name == "nt":
        def unsupported(*args):
            pytest.fail("Windows must not call POSIX chmod/fchmod")
        monkeypatch.setattr(legacy_env.os, "fchmod", unsupported, raising=False)
        monkeypatch.setattr(legacy_env.os, "chmod", unsupported)
    credentials.save_local_exchange_credentials("binance", "fake-new-api", "fake-new-secret")
    assert state.path.read_text(encoding="utf-8") == "OTHER=keep\n"
    assert_no_temps(state)
    if os.name != "nt":
        assert state.path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("existing", [False, True])
def test_fresh_save_does_not_need_legacy_rewrite(state, monkeypatch, existing):
    if existing:
        state.path.write_text("OTHER=keep\n", encoding="utf-8")
    monkeypatch.setattr(legacy_env, "_replace_env_file", lambda *args: pytest.fail("no legacy values to rewrite"))
    credentials.save_local_exchange_credentials("binance", "fake-new-api", "fake-new-secret")
    assert credentials.load_exchange_credentials("binance").api_key == "fake-new-api"
    assert state.path.exists() == existing


def test_explicit_deployment_env_remains_external_and_authoritative(state, monkeypatch):
    credentials.save_local_exchange_credentials("binance", "fake-vault-api", "fake-vault-secret")
    monkeypatch.setenv("BINANCE_API_KEY", "fake-deploy-api")
    monkeypatch.setenv("BINANCE_SECRET_KEY", "fake-deploy-secret")
    result = credentials.resolve_exchange_credentials("binance")
    assert result.source == "environment"
    assert result.credentials.api_key == "fake-deploy-api"
    assert len(state.writes) == 1
    assert credentials.delete_exchange_credentials("binance").environment_override


def test_mixed_legacy_deployment_values_never_migrate_as_a_guessed_pair(state, monkeypatch):
    state.legacy()
    state.loaded.remove("BINANCE_API_KEY")
    monkeypatch.setenv("BINANCE_API_KEY", "fake-external-api")
    result = credentials.resolve_exchange_credentials("binance")
    assert result.credentials is None
    assert "Mixed" in result.storage_error
    assert not state.writes
    with monkeypatch.context() as fault:
        fault.setattr(legacy_env.os, "replace", fail_replace)
        with pytest.raises(credentials.CredentialCleanupPending):
            credentials.save_local_exchange_credentials("binance", "fake-new-api", "fake-new-secret")
        result = credentials.resolve_exchange_credentials("binance")
        assert result.credentials.api_key == "fake-new-api"
        assert result.storage_error == credentials.CLEANUP_PENDING
    result = credentials.resolve_exchange_credentials("binance")
    assert result.credentials.api_key == "fake-new-api"
    assert result.storage_error is None
    assert len(state.writes) == 1


def test_quoted_assignments_accepted_by_real_loader_are_cleaned(state):
    state.path.write_text('"BINANCE_API_KEY=fake-api"\n"BINANCE_SECRET_KEY=fake-secret"\nOTHER=keep\n', encoding="utf-8")
    state.restart()
    assert credentials.load_exchange_credentials("binance").api_key == "fake-api"
    assert state.path.read_text(encoding="utf-8") == "OTHER=keep\n"
    assert not state.loaded


def test_missing_legacy_file_does_not_preserve_stale_loaded_environment(state):
    state.legacy()
    state.path.unlink()
    credentials.save_local_exchange_credentials("binance", "fake-new-api", "fake-new-secret")
    assert not state.loaded
    assert not os.getenv("BINANCE_SECRET_KEY")
    assert credentials.load_exchange_credentials("binance").api_key == "fake-new-api"


@pytest.mark.parametrize("action", ["save", "delete"])
def test_service_reports_actionable_cleanup_pending_without_secrets(state, monkeypatch, action):
    state.legacy()
    new_secret = "fake-new-secret"
    monkeypatch.setattr(service, "_exchange_client", lambda *args: SimpleNamespace(fetch_balance=lambda: {}))
    monkeypatch.setattr(legacy_env.os, "replace", fail_replace)
    with pytest.raises(BusinessLogicError) as error:
        if action == "save":
            service.configure_exchange_credentials_service("binance", "fake-new-api", new_secret)
        else:
            service.delete_exchange_credentials_service("binance")
    assert error.value.error_code == "EXCHANGE_CREDENTIAL_CLEANUP_PENDING"
    assert "Retry" in str(error.value)
    assert "fake-new-secret" not in "".join(traceback.format_exception(error.value))
    assert "fake-old-secret" not in "".join(traceback.format_exception(error.value))


def test_unloaded_legacy_file_is_not_silently_deleted(state):
    state.path.write_text("BINANCE_API_KEY=fake-api\nBINANCE_SECRET_KEY=fake-secret\n", encoding="utf-8")
    result = credentials.resolve_exchange_credentials("binance")
    assert result.credentials is None
    assert "Restart or configure" in result.storage_error
    assert "fake-secret" in state.path.read_text(encoding="utf-8")
    assert not state.writes


def test_concurrent_cleanup_cannot_restore_another_exchanges_plaintext(state, monkeypatch):
    state.path.write_text("BINANCE_API_KEY=fake-one\nOKX_API_KEY=fake-two\nOTHER=keep\n", encoding="utf-8")
    first_read = threading.Event()
    second_started = threading.Event()
    second_read = threading.Event()
    first_done = threading.Event()
    real_read = type(state.path).read_text

    def coordinated_read(path, *args, **kwargs):
        result = real_read(path, *args, **kwargs)
        if path == state.path:
            if threading.current_thread().name == "cleanup-first":
                first_read.set()
                assert second_started.wait(2)
                # An unprotected second reader obtains a stale snapshot; with
                # serialization it cannot enter until this cleanup finishes.
                second_read.wait(0.2)
            else:
                second_read.set()
                assert first_done.wait(2)
        return result

    def first():
        threading.current_thread().name = "cleanup-first"
        try:
            legacy_env.remove_legacy_values("binance")
        finally:
            first_done.set()

    def second():
        assert first_read.wait(2)
        second_started.set()
        legacy_env.remove_legacy_values("okx")

    with monkeypatch.context() as patch:
        patch.setattr(type(state.path), "read_text", coordinated_read)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(first), pool.submit(second)]
            for future in futures:
                future.result(timeout=5)
    assert state.path.read_text(encoding="utf-8") == "OTHER=keep\n"
    assert_no_temps(state)


def test_concurrent_load_cannot_restore_credentials_after_delete(state, monkeypatch):
    state.legacy()
    load_started = threading.Event()
    delete_started = threading.Event()
    delete_done = threading.Event()
    real_load = credentials._load_payload

    def paused_load(*args):
        load_started.set()
        assert delete_started.wait(2)
        delete_done.wait(0.2)
        return real_load(*args)

    def delete():
        assert load_started.wait(2)
        delete_started.set()
        try:
            return credentials.delete_exchange_credentials("binance")
        finally:
            delete_done.set()

    with monkeypatch.context() as patch:
        patch.setattr(credentials, "_load_payload", paused_load)
        with ThreadPoolExecutor(max_workers=2) as pool:
            pending_load = pool.submit(credentials.resolve_exchange_credentials, "binance")
            pending_delete = pool.submit(delete)
            pending_load.result(timeout=5)
            pending_delete.result(timeout=5)
    state.restart()
    assert credentials.resolve_exchange_credentials("binance").credentials is None
    assert not state.values
    assert_no_temps(state)
