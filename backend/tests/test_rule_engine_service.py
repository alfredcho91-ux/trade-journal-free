from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.journal import repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.rule_engine import repository as evaluation_repository
from backend.modules.rule_engine.service import get_strategy_evaluation_service
from backend.modules.strategies import repository as strategy_repository
from backend.modules.strategy_assignments import repository as assignment_repository
from backend.utils.error_handler import NotFoundError


@pytest.fixture
def evaluation_db(monkeypatch, tmp_path):
    root = tmp_path / "rule-evaluation"
    db_path = root / "trade_journal.db"
    csv_path = root / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path
    journal_repository.INITIALIZED_DATABASES.clear()


def _rule(identifier, metric_id=None, operator=None, expected=None):
    result = {"id": identifier, "text": f"Rule {identifier}"}
    if metric_id is not None:
        result["evaluation"] = {
            "metric_id": metric_id,
            "operator": operator,
            "expected": expected,
        }
    return result


def _document(*, schema_version=2, entry=(), risk=(), exit=()):
    return {
        "schema_version": schema_version,
        "entry_rules": list(entry),
        "risk_rules": list(risk),
        "exit_rules": list(exit),
    }


def _journal(db_path, identifier="position-1", **overrides):
    payload = {
        "source": "binance_position",
        "external_id": f"binance:position:{identifier}",
        "lifecycle_id": f"lifecycle:{identifier}",
        "datetime": "2026-01-01T11:30:00+00:00",
        "entry_datetime": "2026-01-01T10:00:00+00:00",
        "symbol": "BTC/USDT",
        "timeframe": "4h",
        "direction": "Long",
        "size": 1.0,
        "entry_price": 100.0,
        "exit_price": 104.0,
        "pnl_pct": 4.0,
        "r_multiple": 2.0,
        "outcome": "Win",
        "confidence_score": 4,
        "focus_score": 5,
        "fomo": False,
        "revenge_trade": True,
        "setup_tags": ["Breakout Momentum"],
        "mistake_tags": [],
        "exchange": "Binance",
        "created_at": "2026-01-01T11:31:00+00:00",
    }
    payload.update(overrides)
    entry, created = journal_repository.add_entry_if_new_external_id(
        payload,
        db_path=db_path,
    )
    assert created
    return entry


def _strategy(db_path, name, rules):
    strategy = strategy_repository.create_strategy(
        name=name,
        name_key=name.casefold(),
        description=f"{name} description",
        version_label="v1",
        version_label_key="v1",
        version_description="Initial rules",
        rules=rules,
        db_path=db_path,
    )
    version = strategy_repository.get_version(
        strategy["id"], strategy["active_version_id"], db_path=db_path
    )
    assert version is not None
    return strategy, version


def _new_version(db_path, strategy_id, label, rules):
    return strategy_repository.create_version(
        strategy_id,
        version_label=label,
        version_label_key=label.casefold(),
        description=f"Rules {label}",
        rules=rules,
        db_path=db_path,
    )


def _assign(db_path, journal_entry_id, version_id):
    return assignment_repository.put_assignment(
        journal_entry_id,
        version_id,
        db_path=db_path,
    )


def _result_map(data):
    return {rule["rule_id"]: rule for rule in data["rules"]}


def _linked_plan(db_path, entry, monkeypatch, *, received_at, stop=98.0, target=104.0):
    monkeypatch.setattr(plan_repository, "utc_now", lambda: received_at)
    plan = plan_repository.create_plan(
        {
            "exchange": "binance",
            "symbol": entry["symbol"],
            "side": entry["direction"],
            "client_created_at": None,
            "revision": {
                "entry_price": 100.0,
                "entry_min": None,
                "entry_max": None,
                "stop_loss": stop,
                "take_profit": target,
                "take_profit_2": None,
                "setup": "breakout",
                "entry_note": None,
                "exit_note": None,
                "memo": None,
                "max_hold_hours": 12.0,
                "client_created_at": None,
            },
        },
        db_path=db_path,
    )
    return plan_repository.link_plan(plan["id"], entry["id"], db_path=db_path)


def test_missing_journal_and_unassigned_journal_api_semantics(evaluation_db):
    entry = _journal(
        evaluation_db,
        "unassigned",
        setup_tags=["A Strategy Name", "must-not-infer"],
    )
    with TestClient(app) as client:
        missing = client.get("/api/journal/999999/strategy-evaluation")
        unassigned = client.get(
            f"/api/journal/{entry['id']}/strategy-evaluation"
        )

    assert missing.status_code == 404
    assert missing.json()["error_code"] == "NOT_FOUND"
    assert unassigned.status_code == 200
    assert unassigned.json() == {"success": True, "data": None}


def test_exact_assigned_retired_version_of_archived_strategy_is_evaluated(
    evaluation_db,
):
    entry = _journal(evaluation_db, "historical-version")
    first_rules = _document(
        entry=[_rule("assigned-v1", "journal.fomo", "eq", False)]
    )
    strategy, first = _strategy(evaluation_db, "Historical Strategy", first_rules)
    second = _new_version(
        evaluation_db,
        strategy["id"],
        "v2",
        _document(entry=[_rule("currently-active-v2", "journal.fomo", "eq", True)]),
    )
    _assign(evaluation_db, entry["id"], first["id"])
    strategy_repository.activate_version(
        strategy["id"], second["id"], db_path=evaluation_db
    )
    strategy_repository.retire_version(
        strategy["id"], first["id"], db_path=evaluation_db
    )
    strategy_repository.set_strategy_archived(
        strategy["id"], True, db_path=evaluation_db
    )

    with TestClient(app) as client:
        response = client.get(f"/api/journal/{entry['id']}/strategy-evaluation")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["strategy"]["id"] == strategy["id"]
    assert data["strategy"]["archived_at"] is not None
    assert data["strategy_version"]["id"] == first["id"]
    assert data["strategy_version"]["is_active"] is False
    assert data["strategy_version"]["retired_at"] is not None
    assert [rule["rule_id"] for rule in data["rules"]] == ["assigned-v1"]
    assert data["rules"][0]["status"] == "FOLLOWED"


def test_v1_descriptive_rules_are_no_evaluator(evaluation_db):
    entry = _journal(evaluation_db, "v1")
    rules = _document(
        schema_version=1,
        entry=[_rule("v1-entry")],
        risk=[_rule("v1-risk")],
        exit=[_rule("v1-exit")],
    )
    _, version = _strategy(evaluation_db, "Legacy Rules", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    with TestClient(app) as client:
        data = client.get(
            f"/api/journal/{entry['id']}/strategy-evaluation"
        ).json()["data"]

    assert [rule["rule_id"] for rule in data["rules"]] == [
        "v1-entry",
        "v1-risk",
        "v1-exit",
    ]
    assert {rule["status"] for rule in data["rules"]} == {"NOT_EVALUABLE"}
    assert {rule["reason_code"] for rule in data["rules"]} == {"NO_EVALUATOR"}


def test_mixed_v2_rules_use_backend_results_and_category_summaries(evaluation_db):
    entry = _journal(evaluation_db, "mixed", fomo=None)
    rules = _document(
        entry=[
            _rule("descriptive"),
            _rule("bool-follow", "journal.revenge_trade", "eq", True),
            _rule("bool-violate", "journal.revenge_trade", "eq", False),
            _rule("bool-unknown", "journal.fomo", "eq", False),
            _rule("no-plan-is-false", "plan.recorded_before_entry", "eq", False),
        ],
        risk=[
            _rule("numeric-follow", "journal.confidence_score", "gte", 4),
            _rule("missing-plan", "plan.stop_distance_pct", "lte", 2),
        ],
        exit=[_rule("closed-r", "execution.realized_r", "gte", 1)],
    )
    _, version = _strategy(evaluation_db, "Mixed V2", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    with TestClient(app) as client:
        response = client.get(f"/api/journal/{entry['id']}/strategy-evaluation")

    assert response.status_code == 200
    data = response.json()["data"]
    results = _result_map(data)
    assert data["evaluation_basis"] == "CURRENT_RECONSTRUCTED"
    assert results["descriptive"]["reason_code"] == "NO_EVALUATOR"
    assert results["bool-follow"]["status"] == "FOLLOWED"
    assert results["bool-violate"]["status"] == "VIOLATED"
    assert results["bool-unknown"]["reason_code"] == "MISSING_METRIC"
    assert results["numeric-follow"]["status"] == "FOLLOWED"
    assert results["missing-plan"]["status"] == "NOT_EVALUABLE"
    assert results["missing-plan"]["reason_code"] == "MISSING_PLAN"
    assert results["no-plan-is-false"]["status"] == "FOLLOWED"
    assert results["no-plan-is-false"]["observation"]["value"] is False
    assert data["summary"]["overall"] == {
        "total_rules": 8,
        "evaluable_rules": 5,
        "followed_rules": 4,
        "violated_rules": 1,
        "not_evaluable_rules": 3,
        "adherence_pct": "80",
        "coverage_pct": "62.5",
    }
    assert data["summary"]["entry"]["coverage_pct"] == "60"
    assert data["summary"]["risk"]["coverage_pct"] == "50"
    assert data["summary"]["exit"]["coverage_pct"] == "100"


def test_open_trade_stale_r_is_not_evaluable_through_api(evaluation_db):
    entry = _journal(
        evaluation_db,
        "open-stale-r",
        datetime=None,
        exit_price=None,
        r_multiple=9.25,
    )
    rules = _document(
        exit=[
            _rule("stale-r", "execution.realized_r", "gte", 1),
            _rule("open-hold", "execution.holding_minutes", "lte", 120),
        ]
    )
    _, version = _strategy(evaluation_db, "Open Trade", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    with TestClient(app) as client:
        data = client.get(
            f"/api/journal/{entry['id']}/strategy-evaluation"
        ).json()["data"]

    assert {rule["reason_code"] for rule in data["rules"]} == {
        "TRADE_NOT_CLOSED"
    }
    assert data["summary"]["exit"]["adherence_pct"] is None
    assert data["summary"]["exit"]["coverage_pct"] == "0"


def test_open_trade_is_freshly_evaluated_after_exchange_close(evaluation_db):
    entry = _journal(
        evaluation_db,
        "open-to-closed",
        datetime=None,
        exit_price=None,
        pnl_pct=None,
        outcome=None,
    )
    rules = _document(
        exit=[_rule("closed-return", "execution.price_return_pct", "gte", 2)]
    )
    _, version = _strategy(evaluation_db, "Close Freshness", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    with TestClient(app) as client:
        open_response = client.get(
            f"/api/journal/{entry['id']}/strategy-evaluation"
        )
    open_result = open_response.json()["data"]["rules"][0]
    assert open_result["status"] == "NOT_EVALUABLE"
    assert open_result["reason_code"] == "TRADE_NOT_CLOSED"

    closed_payload = {
        **entry,
        "datetime": "2026-01-01T11:30:00+00:00",
        "exit_price": 104.0,
        "pnl_pct": 4.0,
        "outcome": "Win",
    }
    updated = journal_repository.update_imported_entry_by_external_id(
        closed_payload,
        db_path=evaluation_db,
    )
    assert updated is not None

    with TestClient(app) as client:
        closed_response = client.get(
            f"/api/journal/{entry['id']}/strategy-evaluation"
        )
    closed_result = closed_response.json()["data"]["rules"][0]
    assert closed_result["status"] == "FOLLOWED"
    assert closed_result["reason_code"] is None
    assert closed_result["observation"]["value"] == "4"


def test_journal_psychology_edit_changes_next_get(evaluation_db):
    entry = _journal(evaluation_db, "journal-edit")
    rules = _document(entry=[_rule("fomo-rule", "journal.fomo", "eq", False)])
    _, version = _strategy(evaluation_db, "Journal Freshness", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    before = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    journal_repository.update_entry_behavior(
        entry["id"], {"fomo": True}, db_path=evaluation_db
    )
    after = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)

    assert before["data"]["rules"][0]["status"] == "FOLLOWED"
    assert after["data"]["rules"][0]["status"] == "VIOLATED"


def test_assignment_change_changes_next_get_rule_set(evaluation_db):
    entry = _journal(evaluation_db, "assignment-edit")
    strategy, first = _strategy(
        evaluation_db,
        "Assignment Freshness",
        _document(entry=[_rule("version-one", "journal.fomo", "eq", False)]),
    )
    second = _new_version(
        evaluation_db,
        strategy["id"],
        "v2",
        _document(entry=[_rule("version-two", "journal.fomo", "eq", True)]),
    )
    _assign(evaluation_db, entry["id"], first["id"])
    before = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    _assign(evaluation_db, entry["id"], second["id"])
    after = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)

    assert before["data"]["strategy_version"]["id"] == first["id"]
    assert [rule["rule_id"] for rule in before["data"]["rules"]] == ["version-one"]
    assert after["data"]["strategy_version"]["id"] == second["id"]
    assert [rule["rule_id"] for rule in after["data"]["rules"]] == ["version-two"]


def test_plan_link_and_revision_change_next_get_with_one_revision_per_response(
    evaluation_db, monkeypatch,
):
    entry = _journal(evaluation_db, "plan-refresh", entry_price=102.0)
    rules = _document(
        risk=[
            _rule("stop", "plan.stop_distance_pct", "lte", 2),
            _rule("reward-risk", "plan.total_reward_risk_ratio", "gte", 2),
            _rule("max-hold", "plan.max_hold_hours", "lte", 24),
        ],
        entry=[_rule("deviation", "execution.entry_deviation_r", "lte", 0.5)],
    )
    _, version = _strategy(evaluation_db, "Plan Freshness", rules)
    _assign(evaluation_db, entry["id"], version["id"])

    without_plan = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    linked = _linked_plan(
        evaluation_db,
        entry,
        monkeypatch,
        received_at="2026-01-01T09:00:00+00:00",
    )
    with_plan = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)

    monkeypatch.setattr(
        plan_repository,
        "utc_now",
        lambda: "2026-01-01T09:30:00+00:00",
    )
    revised = plan_repository.add_revision(
        linked["id"],
        {
            "entry_price": 100.0,
            "entry_min": None,
            "entry_max": None,
            "stop_loss": 97.0,
            "take_profit": 106.0,
            "take_profit_2": None,
            "setup": "breakout revised",
            "entry_note": None,
            "exit_note": None,
            "memo": None,
            "max_hold_hours": 24.0,
            "client_created_at": None,
        },
        db_path=evaluation_db,
    )
    after_revision = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)

    assert {rule["reason_code"] for rule in without_plan["data"]["rules"]} == {
        "MISSING_PLAN"
    }
    assert _result_map(with_plan["data"])["stop"]["status"] == "FOLLOWED"
    revised_results = _result_map(after_revision["data"])
    assert revised_results["stop"]["status"] == "VIOLATED"
    assert revised is not None
    revision_id = revised["latest_revision"]["id"]
    assert {
        result["observation"]["record_id"] for result in revised_results.values()
    } == {revision_id}


def test_unexpected_error_is_sanitized(evaluation_db, monkeypatch):
    entry = _journal(evaluation_db, "error-boundary")

    def fail_snapshot(*_args, **_kwargs):
        raise RuntimeError("private database internals must never escape")

    monkeypatch.setattr(evaluation_repository, "load_evaluation_snapshot", fail_snapshot)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(f"/api/journal/{entry['id']}/strategy-evaluation")

    assert response.status_code == 500
    payload = response.json()
    assert payload["error_code"] == "INTERNAL_ERROR"
    assert "private database" not in response.text
    assert "traceback" not in payload


def test_get_persists_no_evaluation_result(evaluation_db):
    entry = _journal(evaluation_db, "no-storage")
    _, version = _strategy(
        evaluation_db,
        "No Storage",
        _document(entry=[_rule("one", "journal.fomo", "eq", False)]),
    )
    _assign(evaluation_db, entry["id"], version["id"])
    get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)

    with sqlite3.connect(evaluation_db) as conn:
        evaluation_tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%evaluation%'"
        ).fetchall()
    assert evaluation_tables == []


def test_concurrent_assignment_change_cannot_mix_version_identity_and_rules(
    evaluation_db, monkeypatch,
):
    entry = _journal(evaluation_db, "concurrent-assignment")
    strategy, first = _strategy(
        evaluation_db,
        "Concurrent Assignment",
        _document(entry=[_rule("first-rule", "journal.fomo", "eq", False)]),
    )
    second = _new_version(
        evaluation_db,
        strategy["id"],
        "v2",
        _document(entry=[_rule("second-rule", "journal.fomo", "eq", True)]),
    )
    _assign(evaluation_db, entry["id"], first["id"])

    assignment_read = Event()
    continue_read = Event()
    original = evaluation_repository._fetch_assignment_version

    def blocked_assignment_read(conn, journal_entry_id):
        result = original(conn, journal_entry_id)
        assignment_read.set()
        if not continue_read.wait(10):
            raise RuntimeError("Timed out waiting for assignment writer")
        return result

    monkeypatch.setattr(
        evaluation_repository,
        "_fetch_assignment_version",
        blocked_assignment_read,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        future = executor.submit(
            get_strategy_evaluation_service,
            entry["id"],
            db_path=evaluation_db,
        )
        assert assignment_read.wait(10)
        _assign(evaluation_db, entry["id"], second["id"])
        continue_read.set()
        result = future.result(timeout=10)

    assert result["data"]["strategy_version"]["id"] == first["id"]
    assert [rule["rule_id"] for rule in result["data"]["rules"]] == ["first-rule"]
    fresh = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    assert fresh["data"]["strategy_version"]["id"] == second["id"]
    assert [rule["rule_id"] for rule in fresh["data"]["rules"]] == ["second-rule"]


def test_concurrent_plan_revision_uses_one_sqlite_snapshot(
    evaluation_db, monkeypatch,
):
    entry = _journal(evaluation_db, "concurrent-plan", entry_price=102.0)
    rules = _document(
        entry=[
            _rule("recorded", "plan.recorded_before_entry", "eq", True),
            _rule("deviation", "execution.entry_deviation_r", "lte", 0.5),
        ],
        risk=[
            _rule("stop", "plan.stop_distance_pct", "lte", 2),
            _rule("reward-risk", "plan.total_reward_risk_ratio", "gte", 2),
            _rule("max-hold", "plan.max_hold_hours", "lte", 12),
        ],
    )
    _, version = _strategy(evaluation_db, "Concurrent Plan", rules)
    _assign(evaluation_db, entry["id"], version["id"])
    linked = _linked_plan(
        evaluation_db,
        entry,
        monkeypatch,
        received_at="2026-01-01T09:00:00+00:00",
    )
    revision_a = linked["latest_revision"]

    journal_read = Event()
    continue_read = Event()
    original = evaluation_repository._fetch_journal_entry

    def blocked_journal_read(conn, journal_entry_id):
        result = original(conn, journal_entry_id)
        journal_read.set()
        if not continue_read.wait(10):
            raise RuntimeError("Timed out waiting for Plan revision writer")
        return result

    monkeypatch.setattr(
        evaluation_repository,
        "_fetch_journal_entry",
        blocked_journal_read,
    )
    monkeypatch.setattr(
        plan_repository,
        "utc_now",
        lambda: "2026-01-01T09:30:00+00:00",
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        future = executor.submit(
            get_strategy_evaluation_service,
            entry["id"],
            db_path=evaluation_db,
        )
        assert journal_read.wait(10)
        revised = plan_repository.add_revision(
            linked["id"],
            {
                "entry_price": 100.0,
                "entry_min": None,
                "entry_max": None,
                "stop_loss": 95.0,
                "take_profit": 105.0,
                "take_profit_2": None,
                "setup": "concurrent revision",
                "entry_note": None,
                "exit_note": None,
                "memo": None,
                "max_hold_hours": 24.0,
                "client_created_at": None,
            },
            db_path=evaluation_db,
        )
        continue_read.set()
        snapshot_a = future.result(timeout=10)

    assert revised is not None
    revision_b = revised["latest_revision"]
    results_a = _result_map(snapshot_a["data"])
    assert {
        result["observation"]["record_id"] for result in results_a.values()
    } == {revision_a["id"]}
    assert results_a["stop"]["status"] == "FOLLOWED"
    assert results_a["max-hold"]["status"] == "FOLLOWED"

    fresh = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
    results_b = _result_map(fresh["data"])
    assert {
        result["observation"]["record_id"] for result in results_b.values()
    } == {revision_b["id"]}
    assert results_b["stop"]["status"] == "VIOLATED"
    assert results_b["max-hold"]["status"] == "VIOLATED"


@pytest.mark.parametrize("mutation", ["update", "delete"])
def test_concurrent_journal_change_cannot_produce_mixed_response(
    evaluation_db, monkeypatch, mutation,
):
    entry = _journal(evaluation_db, f"concurrent-journal-{mutation}")
    _, version = _strategy(
        evaluation_db,
        f"Concurrent Journal {mutation}",
        _document(entry=[_rule("journal-rule", "journal.fomo", "eq", False)]),
    )
    _assign(evaluation_db, entry["id"], version["id"])

    journal_read = Event()
    continue_read = Event()
    original = evaluation_repository._fetch_journal_entry

    def blocked_journal_read(conn, journal_entry_id):
        result = original(conn, journal_entry_id)
        journal_read.set()
        if not continue_read.wait(10):
            raise RuntimeError("Timed out waiting for Journal writer")
        return result

    monkeypatch.setattr(
        evaluation_repository,
        "_fetch_journal_entry",
        blocked_journal_read,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        future = executor.submit(
            get_strategy_evaluation_service,
            entry["id"],
            db_path=evaluation_db,
        )
        assert journal_read.wait(10)
        if mutation == "update":
            journal_repository.update_entry_behavior(
                entry["id"], {"fomo": True}, db_path=evaluation_db
            )
        else:
            assert journal_repository.delete_entry(entry["id"], db_path=evaluation_db)
        continue_read.set()
        result = future.result(timeout=10)

    assert result["data"]["journal_entry_id"] == entry["id"]
    assert result["data"]["strategy_version"]["id"] == version["id"]
    assert result["data"]["rules"][0]["status"] == "FOLLOWED"
    if mutation == "update":
        fresh = get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
        assert fresh["data"]["rules"][0]["status"] == "VIOLATED"
    else:
        with pytest.raises(NotFoundError):
            get_strategy_evaluation_service(entry["id"], db_path=evaluation_db)
