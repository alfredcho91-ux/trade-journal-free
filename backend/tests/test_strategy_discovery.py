from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.analytics import repository as analytics
from backend.modules.analytics.repository import AnalyticsSnapshot
from backend.modules.journal import repository as journal
from backend.modules.strategy_discovery import adoption, engine, feature_policy, repository, service
from backend.modules.strategy_discovery.schemas import AdoptionRequest, RunRequest
from backend.utils.error_handler import APIError

REQUEST = RunRequest(start_time=1000, end_time=101000)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


def entries():
    return [{"id": i + 1, "external_id": f"position-{i}", "source": "binance_position",
             "symbol": "BTCUSDT" if i % 2 == 0 else "ETHUSDT", "direction": "Long" if i % 2 == 0 else "Short",
             "entry_datetime": iso(1950 + i * 2500), "datetime": iso(2000 + i * 2500),
             "realized_pnl": 40 if i % 2 == 0 else -10, "invested_amount": 1000,
             "fee_currency": "USDT" if i % 2 == 0 else "BTC", "fee": 1, "exchange": "binance",
             "notes": "must not persist private notes", "setup_tags": ["after-the-fact"], "fomo": True}
            for i in range(40)]


@pytest.fixture
def discovery_db(tmp_path, monkeypatch):
    path = tmp_path / "profile" / "journal.db"
    monkeypatch.setattr(journal, "JOURNAL_DB_PATH", path)
    monkeypatch.setattr(journal, "JOURNAL_CSV_PATH", path.with_suffix(".csv"))
    journal.INITIALIZED_DATABASES.clear()
    monkeypatch.setattr(analytics, "load_snapshot", lambda *a, **k: AnalyticsSnapshot(entries(), {}, {}))
    yield path
    journal.INITIALIZED_DATABASES.clear()


def run(db):
    return service.create_run(REQUEST, str(uuid4()), db_path=db)


def payload(candidate, name="Discovered BTC"):
    return AdoptionRequest(strategy={"name": name, "description": "Historical candidate",
        "initial_version": {"version_label": "v1", "description": None,
                            "rules": candidate.rules.model_dump(mode="json")}})


def test_discovery_is_deterministic_bounded_and_uses_existing_metrics(discovery_db):
    first = run(discovery_db)
    second = run(discovery_db)
    assert first.summary == second.summary
    assert first.input_fingerprint == second.input_fingerprint
    assert first.summary.discovery_trades == 28
    assert first.summary.validation_trades == 12
    assert first.summary.candidate_count == 1  # equivalent memberships are deduplicated
    c = first.candidates[0]
    assert c.conditions[0].value == "BTCUSDT"
    assert c.validation_state == "CONSISTENT"
    assert float(c.discovery.metrics["average_return_pct"].value) == 4
    assert float(c.discovery.metrics["win_rate_pct"].value) == 100
    assert c.discovery.metrics["average_r"].value is None
    assert c.discovery.metrics["profit_factor"].value is None
    assert c.discovery.metrics["profit_factor"].unavailable_reason == "PNL_CURRENCY_UNVERIFIED"
    assert c.rules.entry_rules[0].evaluation.metric_id == "trade.symbol"
    assert not c.rules.risk_rules and not c.rules.exit_rules


def test_holdout_cannot_select_rerank_or_generate_conditions(discovery_db):
    frozen = service.freeze_snapshot(AnalyticsSnapshot(entries(), {}, {}))
    original = engine.analyze(service.restore_facts(frozen), REQUEST)[1]
    for row in frozen["facts"][28:]:
        row["entry"]["realized_pnl"] *= -10
        row["observations"]["trade.direction"]["value"] = "Short"
    changed = engine.analyze(service.restore_facts(frozen), REQUEST)[1]
    assert [(c.rank, c.conditions, c.discovery) for c in original] == [(c.rank, c.conditions, c.discovery) for c in changed]
    assert changed[0].validation_state == "WEAKENED"


def test_time_purging_missing_values_and_outcome_features(discovery_db):
    rows = entries()
    rows[0]["entry_datetime"] = iso(500)
    rows[1]["entry_datetime"] = None
    rows[28]["entry_datetime"] = iso(70000)  # closes in holdout; opened in discovery
    frozen = service.freeze_snapshot(AnalyticsSnapshot(rows, {}, {}))
    summary, candidates = engine.analyze(service.restore_facts(frozen), REQUEST)
    assert summary.excluded == {"ENTRY_BEFORE_PERIOD": 1, "INVALID_POSITION_TIME": 1, "CROSSES_SPLIT": 1}
    assert all(condition.field in {"symbol", "direction"} for c in candidates for condition in c.conditions)
    assert not {1, 2, 29}.intersection(identifier for c in candidates for identifier in c.discovery.trade_ids + c.validation.trade_ids)
    assert "must not persist private notes" not in repository.encode(frozen)
    assert "after-the-fact" not in repository.encode(frozen)
    assert engine.analyze(service.restore_facts(frozen), REQUEST.model_copy(update={"primary_metric": "average_r"}))[0].state == "INSUFFICIENT_EVIDENCE"


def test_insufficient_holdout_keeps_candidate_and_training_rank(discovery_db):
    frozen = service.freeze_snapshot(AnalyticsSnapshot(entries()[:30], {}, {}))
    _, candidates = engine.analyze(service.restore_facts(frozen), REQUEST)
    assert candidates and candidates[0].validation_state == "INSUFFICIENT_EVIDENCE"
    assert candidates[0].rank == 1


def test_duplicate_trades_and_limits_fail_before_writes(discovery_db, monkeypatch):
    monkeypatch.setattr(analytics, "load_snapshot", lambda *a, **k: AnalyticsSnapshot(entries() + [entries()[0]], {}, {}))
    with pytest.raises(APIError, match="duplicate"):
        run(discovery_db)
    assert not discovery_db.exists()
    monkeypatch.setattr(feature_policy, "MAX_TRADES", 1)
    with pytest.raises(APIError, match="limit"):
        run(discovery_db)


def test_retries_preserve_original_snapshot_and_conflicting_keys_fail(discovery_db, monkeypatch):
    key = str(uuid4())
    first = service.create_run(REQUEST, key, db_path=discovery_db)
    monkeypatch.setattr(analytics, "load_snapshot", lambda *a, **k: pytest.fail("Replay must not read mutable source"))
    replay = service.create_run(REQUEST, key, db_path=discovery_db)
    assert replay == first
    with pytest.raises(APIError) as failure:
        service.create_run(REQUEST.model_copy(update={"end_time": 100000}), key, db_path=discovery_db)
    assert failure.value.status_code == 409
    evidence = service.evidence(first.candidates[0].id, 0, 2, db_path=discovery_db)
    assert evidence.has_more and len(evidence.items) == 2
    assert evidence.items[0].average_return_pct == 4


def test_evidence_survives_source_changes_and_is_immutable(discovery_db):
    result = run(discovery_db)
    before = service.evidence(result.candidates[0].id, db_path=discovery_db)
    with sqlite3.connect(discovery_db) as conn:
        conn.execute("DELETE FROM journal_entries")
        for table in ("runs", "candidates"):
            with pytest.raises(sqlite3.IntegrityError, match="immutable"):
                conn.execute(f"DELETE FROM strategy_discovery_{table}")
        snapshot = conn.execute("SELECT snapshot_json FROM strategy_discovery_runs").fetchone()[0]
    assert service.evidence(result.candidates[0].id, db_path=discovery_db) == before
    assert "notes" not in snapshot and "setup_tags" not in snapshot
    assert json.loads(snapshot)["facts"]


def test_atomic_adoption_uses_existing_active_version_and_modified_rules(discovery_db):
    candidate = run(discovery_db).candidates[0]
    request = payload(candidate)
    key = str(uuid4())
    adopted = adoption.adopt(candidate.id, request, key, db_path=discovery_db)
    assert adopted.evidence_applies_to_saved_rules and not adopted.rules_modified
    assert adoption.adopt(candidate.id, request, key, db_path=discovery_db) == adopted
    with sqlite3.connect(discovery_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM strategies").fetchone()[0] == 1
        assert conn.execute("SELECT is_active FROM strategy_versions WHERE id=?", (adopted.version_id,)).fetchone()[0] == 1
    assert repository.get_candidate(candidate.id, db_path=discovery_db).adoption == adopted
    with pytest.raises(APIError) as failure:
        adoption.adopt(candidate.id, payload(candidate, "Different"), str(uuid4()), db_path=discovery_db)
    assert failure.value.status_code == 409
    other = run(discovery_db).candidates[0]
    changed = payload(other, "Edited strategy")
    changed.strategy.initial_version.rules.entry_rules[0].evaluation.expected = "ETHUSDT"
    result = adoption.adopt(other.id, changed, str(uuid4()), db_path=discovery_db)
    assert result.rules_modified and not result.evidence_applies_to_saved_rules
    assert repository.get_candidate(other.id, db_path=discovery_db).rules == other.rules


def test_name_and_description_edits_do_not_claim_new_rule_evidence(discovery_db):
    candidate = run(discovery_db).candidates[0]
    rules = candidate.rules.model_dump(mode="json")
    changed = json.loads(json.dumps(rules))
    changed["entry_rules"][0]["id"] = "renamed"
    changed["entry_rules"][0]["text"] = "Translated label"
    assert adoption.rules_fingerprint(rules) == adoption.rules_fingerprint(changed)
    changed["risk_rules"].append({"id": "manual", "text": "New manual risk policy"})
    assert adoption.rules_fingerprint(rules) != adoption.rules_fingerprint(changed)


def test_failed_adoption_rolls_back_strategy_and_version(discovery_db):
    candidate = run(discovery_db).candidates[0]
    with sqlite3.connect(discovery_db) as conn:
        conn.execute("""CREATE TRIGGER fail_adoption BEFORE INSERT ON strategy_discovery_adoptions
            BEGIN SELECT RAISE(ABORT, 'forced adoption failure'); END""")
    with pytest.raises(sqlite3.IntegrityError, match="forced adoption failure"):
        adoption.adopt(candidate.id, payload(candidate), str(uuid4()), db_path=discovery_db)
    with sqlite3.connect(discovery_db) as conn:
        for table in ("strategies", "strategy_versions", "strategy_discovery_adoptions"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_concurrent_adoption_creates_only_one_strategy(discovery_db):
    candidate = run(discovery_db).candidates[0]
    key = str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: adoption.adopt(candidate.id, payload(candidate), key, db_path=discovery_db), range(2)))
    assert results[0] == results[1]
    with sqlite3.connect(discovery_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM strategies").fetchone()[0] == 1


def test_profiles_and_read_only_endpoints_do_not_create_database(discovery_db, tmp_path):
    isolated = tmp_path / "separate-profile" / "journal.db"
    assert repository.list_runs(db_path=isolated).items == []
    assert not isolated.parent.exists()
    run(discovery_db)
    assert repository.list_runs(db_path=isolated).items == []
    assert not isolated.exists()


def test_run_storage_failure_is_atomic(discovery_db):
    repository.initialize_schema(db_path=discovery_db)
    with sqlite3.connect(discovery_db) as conn:
        conn.execute("""CREATE TRIGGER fail_candidate BEFORE INSERT ON strategy_discovery_candidates
            BEGIN SELECT RAISE(ABORT, 'forced candidate failure'); END""")
    with pytest.raises(sqlite3.IntegrityError, match="forced candidate failure"):
        run(discovery_db)
    assert repository.list_runs(db_path=discovery_db).items == []


def test_busy_slot_rejects_parallel_analysis_and_recovers(discovery_db):
    assert service._analysis_slot.acquire(blocking=False)
    try:
        with pytest.raises(APIError) as failure:
            run(discovery_db)
        assert failure.value.status_code == 429
        assert not discovery_db.exists()
    finally:
        service._analysis_slot.release()
    assert run(discovery_db).candidates


def test_missing_negative_zero_and_nonfinite_values_remain_explicit(discovery_db):
    rows = entries()
    for index in (0, 2, 4, 6):
        rows[index]["realized_pnl"] = None
    frozen = service.freeze_snapshot(AnalyticsSnapshot(rows, {}, {}))
    summary, candidates = engine.analyze(service.restore_facts(frozen), REQUEST)
    assert not candidates  # positive group has less than 80% primary coverage
    assert summary.baseline_discovery["average_return_pct"].unavailable_sample == 4
    for row in rows:
        row["realized_pnl"] = 0
    assert not engine.analyze(service.restore_facts(service.freeze_snapshot(AnalyticsSnapshot(rows, {}, {}))), REQUEST)[1]
    for row in rows:
        row["realized_pnl"] = float("inf")
    frozen = service.freeze_snapshot(AnalyticsSnapshot(rows, {}, {}))
    summary, candidates = engine.analyze(service.restore_facts(frozen), REQUEST)
    assert not candidates and summary.state == "INSUFFICIENT_EVIDENCE"
    assert "Infinity" not in repository.encode(frozen)


def test_exact_split_boundary_belongs_only_to_holdout(discovery_db):
    rows = entries()
    rows[28]["entry_datetime"] = iso(71000)
    rows[28]["datetime"] = iso(71000)
    summary, candidates = engine.analyze(service.restore_facts(service.freeze_snapshot(AnalyticsSnapshot(rows, {}, {}))), REQUEST)
    assert summary.split_time == 71000
    assert all(29 not in c.discovery.trade_ids for c in candidates)
    assert 29 in candidates[0].validation.trade_ids


def test_adoption_request_key_cannot_be_reused_for_another_candidate(discovery_db):
    first = run(discovery_db).candidates[0]
    second = run(discovery_db).candidates[0]
    key = str(uuid4())
    adoption.adopt(first.id, payload(first), key, db_path=discovery_db)
    with pytest.raises(APIError) as failure:
        adoption.adopt(second.id, payload(second, "Other"), key, db_path=discovery_db)
    assert failure.value.status_code == 409


def test_discovery_symbol_filter_matches_the_generated_rule_not_raw_exchange_spelling(discovery_db, monkeypatch):
    rows = entries()
    for row in rows:
        row["symbol"] = row["symbol"].replace("USDT", "/USDT:USDT")
    def snapshot(query, **kwargs):
        assert query.filters.symbols is None
        return AnalyticsSnapshot(rows, {}, {})
    monkeypatch.setattr(analytics, "load_snapshot", snapshot)
    request = REQUEST.model_copy(update={"symbols": ["BTCUSDT"]})
    result = service.create_run(request, str(uuid4()), db_path=discovery_db)
    assert result.summary.selected_trades == 20
    assert RunRequest(**{**REQUEST.model_dump(), "symbols": ["btc/usdt:usdt"]}).symbols == ["BTCUSDT"]
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        RunRequest(**{**REQUEST.model_dump(), "symbols": ["BTCUSDT", "BTC/USDT"]})


@pytest.mark.parametrize("symbols", [["BTCUSDT"], ["BTCUSDT", "ETHUSDT"]])
def test_generated_and_saved_rules_preserve_the_entire_analysis_scope(discovery_db, monkeypatch, symbols):
    rows = entries()
    for index, row in enumerate(rows):
        row["direction"] = "Long" if (index // 2) % 2 == 0 else "Short"
        row["realized_pnl"] = 40 if row["direction"] == "Long" else -10
    monkeypatch.setattr(analytics, "load_snapshot", lambda *a, **k: AnalyticsSnapshot(rows, {}, {}))
    result = service.create_run(REQUEST.model_copy(update={"symbols": symbols}), str(uuid4()), db_path=discovery_db)
    candidate = result.candidates[0]
    conditions = {condition.field: condition for condition in candidate.conditions}
    assert conditions["symbol"].value == (symbols[0] if len(symbols) == 1 else symbols)
    assert conditions["symbol"].operator == ("eq" if len(symbols) == 1 else "in")
    assert conditions["direction"].value == "Long"
    saved = adoption.adopt(candidate.id, payload(candidate), str(uuid4()), db_path=discovery_db)
    assert saved.evidence_applies_to_saved_rules
    with sqlite3.connect(discovery_db) as conn:
        document = json.loads(conn.execute("SELECT rules_json FROM strategy_versions WHERE id=?", (saved.version_id,)).fetchone()[0])
    assert len(document["entry_rules"]) == 2
    assert document["entry_rules"][0]["evaluation"]["expected"] == conditions["symbol"].value
    modified = json.loads(json.dumps(document))
    modified["entry_rules"] = modified["entry_rules"][1:]
    assert adoption.rules_fingerprint(document) != adoption.rules_fingerprint(modified)


def test_direction_scope_is_not_lost_when_discovering_a_symbol(discovery_db):
    frozen = service.freeze_snapshot(AnalyticsSnapshot(entries(), {}, {}))
    facts = service.restore_facts(frozen)
    # Keep both symbols inside a Long-only scope, with different observed returns.
    for fact in facts:
        fact.entry["direction"] = "Long"
        fact.observations["trade.direction"] = fact.observations["trade.direction"].model_copy(update={"value": "Long"})
    _, candidates = engine.analyze(facts, REQUEST.model_copy(update={"directions": ["Long"]}))
    assert candidates[0].conditions[-1].field == "direction"
    assert candidates[0].rules.entry_rules[-1].evaluation.expected == "Long"


def test_http_contract_authentication_validation_and_history(discovery_db):
    with TestClient(app) as client:
        metadata = client.get("/api/strategy-discovery/metadata")
        assert metadata.status_code == 200
        assert metadata.json()["data"]["features"] == ["symbol", "direction"]
        assert client.post("/api/strategy-discovery/runs", json=REQUEST.model_dump()).status_code == 422
        assert client.post("/api/strategy-discovery/runs", headers={"Idempotency-Key": "bad"}, json=REQUEST.model_dump()).status_code == 422
        headers = {"Idempotency-Key": str(uuid4())}
        response = client.post("/api/strategy-discovery/runs", headers=headers, json=REQUEST.model_dump())
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert client.get(f"/api/strategy-discovery/runs/{result['id']}").json()["data"] == result
        c = result["candidates"][0]
        assert client.get(f"/api/strategy-discovery/candidates/{c['id']}").json()["data"] == c
        assert client.get(f"/api/strategy-discovery/candidates/{c['id']}/evidence?limit=2").json()["data"]["has_more"]
        assert len(client.get("/api/strategy-discovery/runs").json()["data"]["items"]) == 1
        assert client.get("/api/strategy-discovery/runs?limit=1000").status_code == 422
        assert client.get("/api/strategy-discovery/runs/999999").status_code == 404
        assert client.post("/api/strategy-discovery/runs", headers={"Idempotency-Key": str(uuid4())},
            json={**REQUEST.model_dump(), "fomo": ["TRUE"]}).status_code == 422
        assert client.get("/api/strategy-discovery/runs", headers={"host": "evil.example"}).status_code in {400, 403}
