"""
pytest 설정 및 공통 픽스처
"""

# Apply isolation before test collection imports settings/main. Tests must never
# load the developer's .env, database or OS credentials, including subprocesses.
import os
import tempfile
from pathlib import Path

import keyring
import pytest

_profile = tempfile.TemporaryDirectory(prefix="trade-journal-tests-")
os.environ["TRADE_JOURNAL_DATA_DIR"] = _profile.name
os.environ["JOURNAL_DIR"] = _profile.name
os.environ["JOURNAL_DB_PATH"] = str(Path(_profile.name) / "journal.db")
os.environ["JOURNAL_CSV_PATH"] = str(Path(_profile.name) / "journal.csv")
os.environ["CREDENTIAL_STORAGE"] = "keyring"
os.environ.pop("CREDENTIAL_MASTER_KEY", None)
os.environ["APP_ENV"] = "development"
for _exchange in ("BINANCE", "DEEPCOIN", "BYBIT", "OKX"):
    for _suffix in ("API_KEY", "SECRET_KEY", "PASSPHRASE"):
        os.environ.pop(f"{_exchange}_{_suffix}", None)


def _forbid_os_vault(*args, **kwargs):
    raise AssertionError("Tests must inject a fake credential store")


for _operation in ("get_keyring", "get_password", "set_password", "delete_password", "get_credential"):
    setattr(keyring, _operation, _forbid_os_vault)


@pytest.fixture(autouse=True)
def isolated_credential_boundary(monkeypatch):
    from backend.modules.exchanges import keyring_store
    monkeypatch.setattr(keyring_store, "_keyring_module", _forbid_os_vault)
    environment = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(environment)
