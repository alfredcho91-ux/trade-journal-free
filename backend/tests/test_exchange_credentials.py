from __future__ import annotations

import os

from backend.modules.exchanges import credentials, service


def test_exchange_credentials_use_restricted_git_ignored_env_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("OTHER=value\n", encoding="utf-8")
    monkeypatch.setattr(credentials, "ENV_FILE", env_file)

    credentials.save_local_exchange_credentials("okx", "api key", "secret", "pass phrase")

    saved = env_file.read_text(encoding="utf-8")
    assert "OKX_API_KEY='api key'" in saved
    assert "OKX_SECRET_KEY=secret" in saved
    assert "OKX_PASSPHRASE='pass phrase'" in saved
    assert "OTHER=value" in saved
    assert os.stat(env_file).st_mode & 0o777 == 0o600


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
