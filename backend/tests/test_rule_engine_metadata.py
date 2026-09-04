from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app
from backend.modules.rule_engine.registry import METRIC_REGISTRY
from backend.modules.strategies.schemas import StrategyRuleDocumentV2


def _metadata():
    with TestClient(app) as client:
        response = client.get("/api/rule-engine/metadata")
    assert response.status_code == 200
    return response.json()


def _document(metric_id: str, operator: str, expected):
    return {
        "schema_version": 2,
        "entry_rules": [
            {
                "id": "metadata-contract",
                "text": "Metadata and validation use one contract",
                "evaluation": {
                    "metric_id": metric_id,
                    "operator": operator,
                    "expected": expected,
                },
            }
        ],
        "risk_rules": [],
        "exit_rules": [],
    }


def test_metadata_endpoint_is_versioned_complete_and_deterministic():
    first = _metadata()
    second = _metadata()

    assert first == second
    assert set(first) == {"success", "data"}
    assert first["success"] is True
    assert set(first["data"]) == {"registry_version", "metrics"}
    assert first["data"]["registry_version"] == 1

    metrics = first["data"]["metrics"]
    assert len(metrics) == 14
    assert [item["metric_id"] for item in metrics] == list(METRIC_REGISTRY)
    assert set(item["metric_id"] for item in metrics) == set(METRIC_REGISTRY)
    for item in metrics:
        assert set(item) == {
            "metric_id",
            "label",
            "value_type",
            "unit",
            "lifecycle",
            "allowed_operators",
            "constraints",
        }
        assert set(item["constraints"]) == {
            "enum_values",
            "minimum",
            "maximum",
            "max_in_values",
            "max_string_length",
            "string_format",
        }


def test_metadata_projects_registry_types_operators_units_and_constraints():
    exposed = {
        item["metric_id"]: item for item in _metadata()["data"]["metrics"]
    }

    for metric_id, definition in METRIC_REGISTRY.items():
        item = exposed[metric_id]
        assert item["label"] == definition.label
        assert item["unit"] == definition.unit
        assert item["lifecycle"] == definition.lifecycle
        assert set(item["allowed_operators"]) == set(definition.allowed_operators)

    assert exposed["journal.fomo"] == {
        "metric_id": "journal.fomo",
        "label": METRIC_REGISTRY["journal.fomo"].label,
        "value_type": "boolean",
        "unit": METRIC_REGISTRY["journal.fomo"].unit,
        "lifecycle": METRIC_REGISTRY["journal.fomo"].lifecycle,
        "allowed_operators": ["eq"],
        "constraints": {
            "enum_values": [],
            "minimum": None,
            "maximum": None,
            "max_in_values": None,
            "max_string_length": None,
            "string_format": None,
        },
    }

    confidence = exposed["journal.confidence_score"]
    focus = exposed["journal.focus_score"]
    for item in (confidence, focus):
        assert item["value_type"] == "numeric"
        assert item["allowed_operators"] == ["lte", "gte"]
        assert item["constraints"]["minimum"] == "1"
        assert item["constraints"]["maximum"] == "5"

    direction = exposed["trade.direction"]
    assert direction["value_type"] == "enum"
    assert direction["allowed_operators"] == ["eq", "in"]
    assert direction["constraints"]["enum_values"] == ["Long", "Short"]
    assert direction["constraints"]["max_in_values"] == 50

    symbol = exposed["trade.symbol"]
    assert symbol["value_type"] == "string"
    assert symbol["allowed_operators"] == ["eq", "in"]
    assert symbol["constraints"] == {
        "enum_values": [],
        "minimum": None,
        "maximum": None,
        "max_in_values": 50,
        "max_string_length": 80,
        "string_format": "uppercase_alphanumeric",
    }


@pytest.mark.parametrize(
    ("metric_id", "allowed_operator", "allowed_expected", "rejected_operator"),
    [
        ("journal.fomo", "eq", False, "gte"),
        ("journal.confidence_score", "gte", 3, "eq"),
        ("trade.direction", "in", ["Long", "Short"], "gte"),
        ("trade.symbol", "eq", "BTCUSDT", "lte"),
    ],
)
def test_metadata_operator_contract_agrees_with_strategy_validation(
    metric_id, allowed_operator, allowed_expected, rejected_operator,
):
    exposed = {
        item["metric_id"]: item for item in _metadata()["data"]["metrics"]
    }
    assert allowed_operator in exposed[metric_id]["allowed_operators"]
    assert rejected_operator not in exposed[metric_id]["allowed_operators"]
    StrategyRuleDocumentV2.model_validate(
        _document(metric_id, allowed_operator, allowed_expected)
    )
    with pytest.raises(ValidationError):
        StrategyRuleDocumentV2.model_validate(
            _document(metric_id, rejected_operator, allowed_expected)
        )


@pytest.mark.parametrize("metric_id", ["journal.confidence_score", "journal.focus_score"])
def test_metadata_numeric_domain_agrees_with_strategy_validation(metric_id):
    exposed = {
        item["metric_id"]: item for item in _metadata()["data"]["metrics"]
    }[metric_id]
    assert exposed["constraints"]["minimum"] == "1"
    assert exposed["constraints"]["maximum"] == "5"

    for value in (1, 5):
        StrategyRuleDocumentV2.model_validate(_document(metric_id, "gte", value))
    for value in (0, 6):
        with pytest.raises(ValidationError):
            StrategyRuleDocumentV2.model_validate(_document(metric_id, "gte", value))


def test_metadata_enum_and_string_constraints_agree_with_strategy_validation():
    exposed = {
        item["metric_id"]: item for item in _metadata()["data"]["metrics"]
    }

    direction = exposed["trade.direction"]
    for value in direction["constraints"]["enum_values"]:
        StrategyRuleDocumentV2.model_validate(
            _document("trade.direction", "eq", value)
        )
    with pytest.raises(ValidationError):
        StrategyRuleDocumentV2.model_validate(
            _document("trade.direction", "eq", "Flat")
        )

    symbol = exposed["trade.symbol"]
    maximum = symbol["constraints"]["max_string_length"]
    assert maximum == 80
    assert symbol["constraints"]["string_format"] == "uppercase_alphanumeric"
    StrategyRuleDocumentV2.model_validate(
        _document("trade.symbol", "eq", "A" * maximum)
    )
    for invalid in ("A" * (maximum + 1), "btcusdt", "BTC/USDT"):
        with pytest.raises(ValidationError):
            StrategyRuleDocumentV2.model_validate(
                _document("trade.symbol", "eq", invalid)
            )
