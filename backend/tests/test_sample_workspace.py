"""Real engines in disposable child profiles; OS vault access is always forbidden."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import Mock

import pytest

from backend.config import settings
from backend.modules.sample import workspace


def sample_probe(code, *, extra_env=None):
    with tempfile.TemporaryDirectory(prefix="trade-journal-sample-") as directory:
        root = Path(directory).resolve()
        token = "synthetic-owner-token"
        (root / "sample-owner.json").write_text(json.dumps({"token": token}), encoding="utf-8")
        env = workspace.sample_environment(root, token, "http://127.0.0.1:18767/journal", 18768)
        env.update(extra_env or {})
        probe = """
import keyring
def forbidden(*a, **k):
    raise AssertionError('Real credential store access is forbidden')
for name in ('get_keyring','get_password','set_password','delete_password','get_credential'):
    setattr(keyring, name, forbidden)
""" + code
        result = subprocess.run([sys.executable, "-B", "-c", probe], env=env,
            cwd=settings.SOURCE_ROOT, capture_output=True, text=True, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr
        return result.stdout.strip()


def test_sample_startup_fails_closed_before_loading_dotenv(tmp_path):
    normal = tmp_path / "normal.db"
    normal.write_bytes(b"synthetic normal sentinel")
    output = sample_probe("""
try:
    from backend.config import settings
except RuntimeError as error:
    assert 'paths failed isolation' in str(error)
else:
    raise AssertionError('Normal DB override was accepted')
""", extra_env={"JOURNAL_DB_PATH": str(normal)})
    assert output == ""
    assert normal.read_bytes() == b"synthetic normal sentinel"


@pytest.mark.parametrize("platform", ["win32", "linux", "darwin"])
def test_sample_frozen_selection_precedes_env_loading(platform):
    sample_probe(f"""
import os, sys
sys.platform = {platform!r}
sys.frozen = True
from backend.config import settings
assert settings.IS_FROZEN
assert settings.credential_profile_id().startswith('sample:')
assert settings.APP_DATA_DIR == settings.PROJECT_ROOT
assert settings.JOURNAL_DIR.parent == settings.APP_DATA_DIR
assert settings.JOURNAL_DB_PATH.parent == settings.JOURNAL_DIR
assert settings.JOURNAL_CSV_PATH.parent == settings.JOURNAL_DIR
assert not settings.owns_local_credential_env()
assert not settings.LOCAL_ENV_KEYS_LOADED
""")


def test_environment_allowlist_strips_credentials_and_import_paths(tmp_path, monkeypatch):
    for key in ("DEEPCOIN_API_KEY", "DEEPCOIN_SECRET_KEY", "CREDENTIAL_MASTER_KEY", "DEMO_PASSWORD", "BINANCE_SYMBOLS", "HTTPS_PROXY"):
        monkeypatch.setenv(key, "synthetic-secret")
    env = workspace.sample_environment(tmp_path, "token", "http://127.0.0.1:1/journal", 2)
    assert not any(key in env for key in ("DEEPCOIN_API_KEY", "CREDENTIAL_MASTER_KEY", "HTTPS_PROXY", "DEMO_PASSWORD"))
    assert env["CREDENTIAL_STORAGE"] == "disabled"
    assert Path(env["JOURNAL_CSV_PATH"]).is_relative_to(tmp_path)


def test_sample_credentials_cannot_resolve_migrate_save_or_delete():
    sample_probe("""
import os
from backend.config import settings
from backend.modules.exchanges import credentials, legacy_env, keyring_store, encrypted_store
from backend.modules.exchanges.ccxt_adapter import exchange_client
from backend.modules.exchanges.models import ExchangeCredentials
from backend.modules.deepcoin.service import DeepcoinClient
for module, names in [(credentials, ('load_keyring_payload','save_keyring_payload','delete_keyring_payload','load_encrypted_credentials','save_encrypted_credentials','delete_encrypted_credentials','has_legacy_values','remove_legacy_values'))]:
    for name in names: setattr(module, name, forbidden)
os.environ['DEEPCOIN_API_KEY'] = 'synthetic-inherited-key'
os.environ['DEEPCOIN_SECRET_KEY'] = 'synthetic-inherited-secret'
settings.LOCAL_ENV_PATH.write_text('DEEPCOIN_API_KEY=synthetic-env-key')
before = settings.LOCAL_ENV_PATH.read_bytes()
assert credentials.credential_storage_mode() == 'disabled'
assert credentials.load_exchange_credentials('deepcoin') is None
assert credentials.resolve_exchange_credentials('deepcoin').source == 'none'
assert not credentials.delete_exchange_credentials('deepcoin').deleted
try: credentials.save_local_exchange_credentials('deepcoin','fake','fake')
except credentials.CredentialStorageError: pass
else: raise AssertionError('Sample credentials were saved')
assert not legacy_env.has_legacy_values('deepcoin')
legacy_env.remove_legacy_values('deepcoin')
assert settings.LOCAL_ENV_PATH.read_bytes() == before
assert keyring_store.service_name() != keyring_store.SERVICE_NAME
for action in (
    lambda: keyring_store.load_keyring_payload('deepcoin'),
    lambda: keyring_store.delete_keyring_payload('deepcoin'),
    lambda: encrypted_store.load_encrypted_credentials('deepcoin'),
    lambda: encrypted_store.delete_encrypted_credentials('deepcoin'),
    lambda: exchange_client('binance', ExchangeCredentials('fake','fake'), 'SPOT'),
    lambda: DeepcoinClient(settings.DeepcoinCredentials('fake','fake','fake')),
):
    try: action()
    except (PermissionError, keyring_store.KeyringStoreError): pass
    else: raise AssertionError('Sample crossed a credential/adapter boundary')
""")


ENGINE_PROBE = """
import hashlib, json, sqlite3, socket
from fastapi.testclient import TestClient
from backend.main import app
from backend.config import settings
from backend.modules.journal import repository as journal
from backend.modules.journal.planning_context import get_planning_context
from backend.modules.plan_lab import repository as plans
from backend.modules.sample.fixture import build_fixture
from backend.utils import data_service
filters = {'start_time':1767225600000,'end_time':1769903999999}
with TestClient(app) as client:
    state = client.get('/api/workspace').json()['data']
    assert state['mode'] == 'sample' and state['trade_count'] == 36 and state['credential_backend'] == 'disabled'
    assert not state['first_run']
    rows = journal.list_entries()
    assert len(rows) == 36 and {r['direction'] for r in rows} == {'Long','Short'}
    assert any(r['realized_pnl'] > 0 for r in rows) and any(r['realized_pnl'] < 0 for r in rows)
    assert any(r['r_multiple'] is None for r in rows)
    assert {r['fomo'] for r in rows} == {None, False, True}
    context = get_planning_context(1).data
    assert context.journal_notes.has_notes and not context.journal_notes.timing_verified
    assert context.linked_plan.plan['latest_revision']['version'] == 2
    assert context.linked_plan.entry_time_revision['version'] == 1
    assert context.linked_plan.analysis_revision['version'] == 1
    assert get_planning_context(5).data.linked_plan.analysis_basis == 'RETROSPECTIVE'
    assert get_planning_context(6).data.link_state == 'NO_LINKED_PLAN'
    outputs = []
    for metric, dimension in [('average_return_pct','confidence_score'),('average_r','fomo'),('adherence_pct','strategy'),('coverage_pct','rule_status')]:
        response = client.post('/api/analytics/query', json={'metric':metric,'dimension':dimension,'filters':filters})
        assert response.status_code == 200, response.text
        result = response.json()['data']
        assert result['selected_trade_count'] == 36
        outputs.append(result)
        if dimension == 'rule_status':
            assert {g['identity']['label'] for g in result['groups']} == {'FOLLOWED','VIOLATED','NOT_EVALUABLE'}
    review = client.post('/api/review/trading', json={'filters':filters})
    assert review.status_code == 200, review.text
    result = review.json()['data']
    assert result['state'] == 'AVAILABLE'
    assert result['patterns']['eligible_count'] > 0, result['patterns']
    outputs.append(result)
    for endpoint in ('/api/exchanges/deepcoin/sync','/api/exchanges/deepcoin/credentials','/api/deepcoin/sync'):
        assert client.post(endpoint, json={}).status_code == 403
        assert client.delete(endpoint).status_code == 403
    assert data_service.get_market_prices() is None
    assert data_service.fetch_binance_klines('BTCUSDT','1h') is None
    assert data_service.BASE_DIR.is_relative_to(settings.APP_DATA_DIR)
    with socket.socket() as sock:
        try: sock.connect(('127.0.0.1', 1))
        except PermissionError: pass
        else: raise AssertionError('Sample opened an outgoing socket')
    try: build_fixture()
    except RuntimeError: pass
    else: raise AssertionError('Fixture overwrote an existing DB')
    with sqlite3.connect(settings.JOURNAL_DB_PATH) as conn:
        assert conn.execute('SELECT COUNT(*) FROM strategies').fetchone()[0] == 2
        assert conn.execute('SELECT COUNT(*) FROM strategy_versions').fetchone()[0] == 3
        source = [conn.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall() for table in ('journal_entries','strategies','strategy_versions','journal_strategy_assignments','trading_plans','trading_plan_revisions','trading_plan_links','daily_journal_entries')]
    print(hashlib.sha256(json.dumps([source, outputs], sort_keys=True).encode()).hexdigest())
"""


def test_sample_fixture_real_engines_and_deterministic_recreation():
    first = sample_probe(ENGINE_PROBE)
    assert len(first) == 64
    assert first == sample_probe(ENGINE_PROBE)


def test_first_run_preference_is_independent_of_credentials_and_strategies(tmp_path, monkeypatch):
    from backend.modules.journal import repository as journal
    db = tmp_path / "normal.db"
    monkeypatch.setattr(settings, "JOURNAL_DB_PATH", db)
    journal.list_entries(db_path=db, csv_path=tmp_path / "absent.csv")
    monkeypatch.setenv("DEEPCOIN_API_KEY", "synthetic")
    assert workspace.workspace_status()["first_run"]
    before = db.read_bytes()
    assert not workspace.acknowledge()["data"]["first_run"]
    assert db.read_bytes() == before
    workspace._preference_path().unlink()
    journal.add_entry_if_new_external_id({'external_id':'normal-only', 'source':'deepcoin_position', 'datetime':'2026-01-01'}, db_path=db, csv_path=tmp_path / "absent.csv")
    assert not workspace.workspace_status()["first_run"]


def test_entry_usage_reset_exit_preserve_synthetic_normal_storage_and_results(tmp_path, monkeypatch):
    from backend.modules.journal import repository as journal
    from backend.modules.strategy_assignments.repository import initialize_schema
    from backend.modules.analytics.service import query_analytics
    from backend.modules.analytics.schemas import AnalyticsQuery
    from backend.modules.review.service import trading_review
    from backend.modules.review.schemas import ReviewRequest
    db = tmp_path / "normal.db"
    initialize_schema(db_path=db)
    (tmp_path / '.env').write_text('DEEPCOIN_API_KEY=synthetic-normal')
    (tmp_path / 'encrypted-store.sentinel').write_bytes(b'synthetic encrypted normal sentinel')
    (tmp_path / 'imports.csv').write_text('synthetic normal imports')
    filters = {'start_time':1767225600000,'end_time':1769903999999}
    def outputs():
        return (query_analytics(AnalyticsQuery(metric='trade_count',dimension='all',filters=filters),db_path=db).model_dump(), trading_review(ReviewRequest(filters=filters),db_path=db).model_dump())
    before_results = outputs()
    before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in tmp_path.iterdir() if path.is_file()}
    manager = workspace.SampleProcess()
    try:
        first = manager.start('http://127.0.0.1:18767/journal')
        first_root = Path(manager.directory.name)
        assert not first_root.is_relative_to(tmp_path)
        from urllib.request import urlopen
        with urlopen(first.replace('/journal','/api/journal')) as response:
            assert json.load(response)['success']
        assert manager.start('http://127.0.0.1:18767/journal') == first
        manager.start('http://127.0.0.1:18767/journal', reset=True)
        assert Path(manager.directory.name) != first_root
        assert not first_root.exists()
    finally:
        manager.close()
    assert before == {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in tmp_path.iterdir() if path.is_file()}
    assert outputs() == before_results
    assert journal.list_entries(db_path=db, csv_path=tmp_path / 'absent.csv') == []
