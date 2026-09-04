from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from backend.main import app
from backend.modules.journal import repository as journal_repository
from backend.modules.rule_engine.registry import METRIC_REGISTRY
from backend.modules.strategies import repository as strategy_repository
from backend.modules.strategies.schemas import StrategyVersionCreate


@pytest.fixture
def rule_db(monkeypatch, tmp_path):
    db_path = tmp_path / "rule-schema-v2" / "trade_journal.db"
    csv_path = tmp_path / "rule-schema-v2" / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path
    journal_repository.INITIALIZED_DATABASES.clear()


def _v1_rules():
    return {
        "schema_version": 1,
        "entry_rules": [{"id": "entry-lineage", "text": "Wait for confirmation"}],
        "risk_rules": [{"id": "risk-lineage", "text": "Keep risk bounded"}],
        "exit_rules": [],
    }


def _evaluation(metric_id="journal.fomo", operator="eq", expected=False):
    return {"metric_id": metric_id, "operator": operator, "expected": expected}


def _v2_rules(evaluation=...):
    rule = {"id": "entry-lineage", "text": "Follow the recorded process"}
    if evaluation is not ...:
        rule["evaluation"] = evaluation
    return {
        "schema_version": 2,
        "entry_rules": [rule],
        "risk_rules": [],
        "exit_rules": [],
    }


def _version(rules, label="v1.0"):
    return {"version_label": label, "description": None, "rules": rules}


def _strategy(rules, name="Rule Strategy"):
    return {
        "name": name,
        "description": None,
        "initial_version": _version(rules),
    }


def _validate(rules):
    return StrategyVersionCreate.model_validate(_version(rules))


def _assert_invalid(rules):
    with pytest.raises(PydanticValidationError):
        _validate(rules)


def test_existing_schema_version_1_still_validates():
    model = _validate(_v1_rules())
    assert model.rules.schema_version == 1
    assert model.model_dump()["rules"] == _v1_rules()


def test_v1_descriptive_strategy_create_still_works(rule_db):
    with TestClient(app) as client:
        response = client.post("/api/strategies", json=_strategy(_v1_rules()))
    assert response.status_code == 200
    assert response.json()["data"]["active_version_id"] is not None


def test_v1_version_create_still_works(rule_db):
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(_v1_rules())).json()["data"]
        response = client.post(
            f"/api/strategies/{strategy['id']}/versions",
            json=_version(_v1_rules(), "v1.1"),
        )
    assert response.status_code == 200
    assert response.json()["data"]["rules"] == _v1_rules()


def test_v2_descriptive_only_rule_validates():
    model = _validate(_v2_rules())
    assert model.rules.schema_version == 2
    assert model.rules.entry_rules[0].evaluation is None


def test_v2_boolean_evaluator_validates():
    assert _validate(_v2_rules(_evaluation())).rules.entry_rules[0].evaluation.expected is False


@pytest.mark.parametrize("operator", ["lte", "gte"])
def test_v2_numeric_threshold_operators_validate(operator):
    evaluator = _evaluation("plan.stop_distance_pct", operator, 1.25)
    assert _validate(_v2_rules(evaluator)).rules.entry_rules[0].evaluation.operator == operator


def test_v2_enum_eq_validates():
    _validate(_v2_rules(_evaluation("trade.direction", "eq", "Long")))


def test_v2_enum_in_validates():
    _validate(_v2_rules(_evaluation("trade.direction", "in", ["Long", "Short"])))


def test_unknown_schema_version_is_rejected():
    rules = _v2_rules()
    rules["schema_version"] = 3
    _assert_invalid(rules)


def test_schema_version_is_required():
    rules = _v1_rules()
    rules.pop("schema_version")
    _assert_invalid(rules)


def test_unknown_metric_is_rejected():
    _assert_invalid(_v2_rules(_evaluation("trade.arbitrary_field", "eq", True)))


def test_metric_specific_unsupported_operator_is_rejected():
    _assert_invalid(_v2_rules(_evaluation("journal.fomo", "lte", 1)))


def test_unknown_operator_is_rejected():
    _assert_invalid(_v2_rules(_evaluation("journal.fomo", "gt", False)))


@pytest.mark.parametrize("expected", ["true", 1, 0, None])
def test_boolean_wrong_expected_type_is_rejected(expected):
    _assert_invalid(_v2_rules(_evaluation("journal.fomo", "eq", expected)))


@pytest.mark.parametrize(
    "expected",
    ["true", "false", 1, 0, None, [], {}],
    ids=["true-string", "false-string", "one", "zero", "null", "list", "object"],
)
def test_boolean_wrong_expected_type_is_rejected_by_strategy_api(rule_db, expected):
    payload = _strategy(
        _v2_rules(_evaluation("journal.fomo", "eq", expected)),
        name="API Boolean Strictness",
    )
    with TestClient(app) as client:
        response = client.post("/api/strategies", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize("expected", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_numeric_expected_is_rejected(expected):
    _assert_invalid(_v2_rules(_evaluation("execution.realized_r", "gte", expected)))


@pytest.mark.parametrize("expected", [0.99, 5.01])
def test_confidence_threshold_domain_is_enforced(expected):
    _assert_invalid(_v2_rules(_evaluation("journal.confidence_score", "gte", expected)))


@pytest.mark.parametrize("expected", [0, 6])
def test_focus_threshold_domain_is_enforced(expected):
    _assert_invalid(_v2_rules(_evaluation("journal.focus_score", "lte", expected)))


def test_invalid_direction_enum_is_rejected():
    _assert_invalid(_v2_rules(_evaluation("trade.direction", "eq", "long")))


def test_empty_in_list_is_rejected():
    _assert_invalid(_v2_rules(_evaluation("trade.direction", "in", [])))


@pytest.mark.parametrize("expected", ["Long", {"Long": True}, 1])
def test_wrong_expected_shape_for_in_is_rejected(expected):
    _assert_invalid(_v2_rules(_evaluation("trade.direction", "in", expected)))


def test_duplicate_in_values_are_rejected():
    _assert_invalid(_v2_rules(_evaluation("trade.direction", "in", ["Long", "Long"])))


def test_extra_evaluator_field_is_rejected():
    evaluator = {**_evaluation(), "unit": "boolean"}
    _assert_invalid(_v2_rules(evaluator))


def test_extra_rule_field_is_rejected():
    rules = _v2_rules()
    rules["entry_rules"][0]["formula"] = "arbitrary()"
    _assert_invalid(rules)


def test_unit_cannot_be_supplied_by_user():
    evaluator = {**_evaluation("execution.realized_r", "gte", 1), "unit": "R"}
    _assert_invalid(_v2_rules(evaluator))


def test_rule_ids_remain_unique_across_all_categories():
    rules = _v2_rules()
    rules["risk_rules"] = [{"id": "risk-lineage", "text": "Risk rule"}]
    assert _validate(rules).rules.risk_rules[0].id == "risk-lineage"


def test_duplicate_rule_id_across_categories_is_rejected():
    rules = _v2_rules()
    rules["risk_rules"] = [{"id": "entry-lineage", "text": "Duplicate lineage"}]
    _assert_invalid(rules)


def test_mixed_evaluable_and_descriptive_v2_rules_are_accepted():
    rules = _v2_rules(_evaluation())
    rules["risk_rules"] = [{"id": "descriptive-risk", "text": "Stay deliberate"}]
    model = _validate(rules)
    assert model.rules.entry_rules[0].evaluation is not None
    assert model.rules.risk_rules[0].evaluation is None


def test_phase1_categories_do_not_apply_accidental_metric_restrictions():
    rules = _v2_rules()
    rules["entry_rules"] = []
    rules["risk_rules"] = [
        {
            "id": "review-in-risk-column",
            "text": "A category does not change metric validation",
            "evaluation": _evaluation("journal.fomo", "eq", False),
        }
    ]
    assert _validate(rules).rules.risk_rules[0].evaluation.metric_id == "journal.fomo"


@pytest.mark.parametrize("symbol", ["BTCUSDT", "ETHUSDT", "BTCUSD"])
def test_canonical_trade_symbol_validates(symbol):
    _validate(_v2_rules(_evaluation("trade.symbol", "eq", symbol)))


@pytest.mark.parametrize("symbol", ["BTC/USDT", "btcusdt", "BTC:USDT", ""])
def test_noncanonical_trade_symbol_is_rejected_without_silent_rewrite(symbol):
    _assert_invalid(_v2_rules(_evaluation("trade.symbol", "eq", symbol)))


def test_registry_contains_only_the_approved_initial_metrics():
    assert set(METRIC_REGISTRY) == {
        "trade.direction",
        "trade.symbol",
        "plan.recorded_before_entry",
        "execution.entry_deviation_r",
        "plan.stop_distance_pct",
        "plan.total_reward_risk_ratio",
        "plan.max_hold_hours",
        "journal.confidence_score",
        "journal.focus_score",
        "journal.fomo",
        "journal.revenge_trade",
        "execution.holding_minutes",
        "execution.price_return_pct",
        "execution.realized_r",
    }


def test_initial_strategy_with_v2_version_is_created_atomically(rule_db):
    rules = _v2_rules(_evaluation())
    with TestClient(app) as client:
        response = client.post("/api/strategies", json=_strategy(rules))
    assert response.status_code == 200
    with sqlite3.connect(rule_db) as conn:
        counts = (
            conn.execute(f"SELECT COUNT(*) FROM {strategy_repository.STRATEGY_TABLE}").fetchone()[0],
            conn.execute(f"SELECT COUNT(*) FROM {strategy_repository.VERSION_TABLE}").fetchone()[0],
        )
    assert counts == (1, 1)


def test_invalid_initial_v2_version_leaves_no_partial_strategy(rule_db):
    strategy_repository.initialize_schema(db_path=rule_db)
    invalid = _strategy(_v2_rules(_evaluation("unknown.metric", "eq", True)))
    with TestClient(app) as client:
        response = client.post("/api/strategies", json=invalid)
    assert response.status_code == 422
    with sqlite3.connect(rule_db) as conn:
        counts = (
            conn.execute(f"SELECT COUNT(*) FROM {strategy_repository.STRATEGY_TABLE}").fetchone()[0],
            conn.execute(f"SELECT COUNT(*) FROM {strategy_repository.VERSION_TABLE}").fetchone()[0],
        )
    assert counts == (0, 0)


def test_new_v2_version_leaves_previous_version_unchanged(rule_db):
    original_rules = _v1_rules()
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(original_rules)).json()["data"]
        response = client.post(
            f"/api/strategies/{strategy['id']}/versions",
            json=_version(_v2_rules(_evaluation()), "v2.0"),
        )
        original = client.get(
            f"/api/strategies/{strategy['id']}/versions/{strategy['active_version_id']}"
        )
    assert response.status_code == 200
    assert original.json()["data"]["rules"] == original_rules


def test_same_rule_id_may_persist_across_strategy_versions(rule_db):
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(_v1_rules())).json()["data"]
        response = client.post(
            f"/api/strategies/{strategy['id']}/versions",
            json=_version(_v2_rules(_evaluation()), "v2.0"),
        )
    assert response.status_code == 200
    assert response.json()["data"]["rules"]["entry_rules"][0]["id"] == "entry-lineage"


def test_evaluator_definition_is_preserved_in_new_immutable_version(rule_db):
    evaluator = _evaluation("plan.stop_distance_pct", "lte", 1.25)
    rules = _v2_rules(evaluator)
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(_v1_rules())).json()["data"]
        created = client.post(
            f"/api/strategies/{strategy['id']}/versions",
            json=_version(rules, "v2.0"),
        ).json()["data"]
        mutation = client.patch(
            f"/api/strategies/{strategy['id']}/versions/{created['id']}",
            json={"rules": _v1_rules()},
        )
    assert created["rules"]["entry_rules"][0]["evaluation"] == evaluator
    assert mutation.status_code == 405


def test_stored_v1_rules_json_is_byte_unchanged_after_phase1_access(rule_db):
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(_v1_rules())).json()["data"]
    with sqlite3.connect(rule_db) as conn:
        before = conn.execute(
            f"SELECT rules_json FROM {strategy_repository.VERSION_TABLE} WHERE id=?",
            (strategy["active_version_id"],),
        ).fetchone()[0]

    strategy_repository.initialize_schema(db_path=rule_db)
    strategy_repository.list_versions(strategy["id"], db_path=rule_db)

    with sqlite3.connect(rule_db) as conn:
        after = conn.execute(
            f"SELECT rules_json FROM {strategy_repository.VERSION_TABLE} WHERE id=?",
            (strategy["active_version_id"],),
        ).fetchone()[0]
    assert after == before
    assert json.loads(after) == _v1_rules()


def test_existing_v1_api_response_shape_remains_frontend_compatible(rule_db):
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(_v1_rules())).json()["data"]
        listed = client.get(f"/api/strategies/{strategy['id']}/versions")
        detail = client.get(
            f"/api/strategies/{strategy['id']}/versions/{strategy['active_version_id']}"
        )
    assert listed.status_code == detail.status_code == 200
    rules = detail.json()["data"]["rules"]
    assert rules == _v1_rules()
    assert set(rules["entry_rules"][0]) == {"id", "text"}


def test_v2_response_is_additive_and_safe_for_current_read_only_rule_rendering(rule_db):
    rules = _v2_rules(_evaluation())
    with TestClient(app) as client:
        strategy = client.post("/api/strategies", json=_strategy(rules)).json()["data"]
        version = client.get(
            f"/api/strategies/{strategy['id']}/versions/{strategy['active_version_id']}"
        ).json()["data"]
    rendered_fields = [
        (rule["id"], rule["text"])
        for group in ("entry_rules", "risk_rules", "exit_rules")
        for rule in version["rules"][group]
    ]
    assert version["rules"]["schema_version"] == 2
    assert rendered_fields == [("entry-lineage", "Follow the recorded process")]


def test_phase4_exposes_only_the_read_only_runtime_evaluation_endpoint():
    routes = [
        route
        for route in app.routes
        if route.path == "/api/journal/{journal_entry_id}/strategy-evaluation"
    ]
    assert len(routes) == 1
    assert routes[0].methods == {"GET"}
