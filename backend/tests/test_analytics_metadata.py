import json
from dataclasses import asdict

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app
from backend.modules.analytics import repository
from backend.modules.analytics.registry import DIMENSION_REGISTRY, METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsFilters, AnalyticsQuery


FILTER_IDS = list(AnalyticsFilters.model_fields)
EXPECTED_FILTER_IDS = [
    "start_time", "end_time", "strategy_ids", "strategy_version_ids", "assignment", "symbols",
    "directions", "setups", "confidence_score", "focus_score", "fomo", "revenge_trade", "rule_statuses",
]
BASE_FILTERS = {"start_time": 1767225600000, "end_time": 1798761599999}


def metadata():
    with TestClient(app) as client:
        response = client.get("/api/analytics/metadata")
    assert response.status_code == 200
    return response.json()


def test_metadata_is_versioned_complete_ordered_and_registry_derived():
    first = metadata()
    assert first == metadata()
    assert set(first) == {"success", "data"}
    assert first["success"] is True
    data = first["data"]
    assert data["registry_version"] == 1
    assert data["timezone"] == "UTC"
    assert data["time_basis"] == "CLOSE_DATETIME_INCLUSIVE"
    assert len(data["metrics"]) == 14
    assert len(data["dimensions"]) == 17
    assert [item["id"] for item in data["metrics"]] == list(METRIC_REGISTRY)
    assert [item["id"] for item in data["dimensions"]] == list(DIMENSION_REGISTRY)
    assert [item["id"] for item in data["filters"]] == FILTER_IDS
    assert FILTER_IDS == EXPECTED_FILTER_IDS
    assert data["metrics"] == [asdict(item) | {"supported_dimensions": list(item.supported_dimensions)}
                               for item in METRIC_REGISTRY.values()]
    assert data["dimensions"] == [asdict(item) for item in DIMENSION_REGISTRY.values()]


def test_advertised_compatibility_exactly_matches_query_validation():
    exposed = {item["id"]: item for item in metadata()["data"]["metrics"]}
    for metric_id, metric in METRIC_REGISTRY.items():
        assert exposed[metric_id]["supported_dimensions"] == list(metric.supported_dimensions)
        for dimension_id in DIMENSION_REGISTRY:
            advertised = dimension_id in exposed[metric_id]["supported_dimensions"]
            if advertised:
                AnalyticsQuery(metric=metric_id, dimension=dimension_id, filters=BASE_FILTERS)
            else:
                with pytest.raises(ValidationError):
                    AnalyticsQuery(metric=metric_id, dimension=dimension_id, filters=BASE_FILTERS)


def test_filter_metadata_matches_validation_schema_domains_and_bounds():
    root = AnalyticsFilters.model_json_schema(mode="validation")
    exposed = {item["id"]: item for item in metadata()["data"]["filters"]}
    assert set(exposed) == set(root["properties"])
    for identifier, public in root["properties"].items():
        choices = public.get("anyOf", [public])
        contract = next(choice for choice in choices if choice.get("type") != "null")
        item_contract = contract.get("items", contract)
        if "$ref" in item_contract:
            item_contract = root["$defs"][item_contract["$ref"].split("/")[-1]]
        assert exposed[identifier]["enum_values"] == item_contract.get("enum", [])
        assert exposed[identifier]["min_items"] == contract.get("minItems")
        assert exposed[identifier]["max_items"] == contract.get("maxItems")
        assert exposed[identifier]["min_length"] == item_contract.get("minLength")
        assert exposed[identifier]["max_length"] == item_contract.get("maxLength")
        assert exposed[identifier]["minimum"] == item_contract.get("minimum")
        assert exposed[identifier]["maximum"] == item_contract.get("maximum")
        assert exposed[identifier]["exclusive_minimum"] == item_contract.get("exclusiveMinimum")

    assert exposed["directions"]["enum_values"] == ["Long", "Short"]
    assert exposed["assignment"]["enum_values"] == ["ALL", "ASSIGNED", "UNASSIGNED"]
    assert exposed["rule_statuses"]["enum_values"] == ["FOLLOWED", "VIOLATED", "NOT_EVALUABLE"]
    assert exposed["rule_statuses"]["applicable_sample_units"] == ["trade_rule"]
    assert exposed["symbols"]["option_source"] == "JOURNAL_SYMBOLS"
    assert exposed["strategy_ids"]["option_source"] == "STRATEGIES"


@pytest.mark.parametrize("identifier", ["directions", "confidence_score", "focus_score", "fomo", "revenge_trade", "rule_statuses"])
def test_every_advertised_static_enum_value_is_accepted(identifier):
    exposed = {item["id"]: item for item in metadata()["data"]["filters"]}[identifier]
    for value in exposed["enum_values"]:
        AnalyticsFilters(**BASE_FILTERS, **{identifier: [value]})
    with pytest.raises(ValidationError):
        AnalyticsFilters(**BASE_FILTERS, **{identifier: ["NOT_IN_DOMAIN"]})


def test_list_bounds_are_enforced_by_the_same_filter_contract():
    exposed = {item["id"]: item for item in metadata()["data"]["filters"]
               if item["input_mode"] == "list"}
    factories = {
        "strategy_ids": lambda count: list(range(1, count + 1)),
        "strategy_version_ids": lambda count: list(range(1, count + 1)),
        "symbols": lambda count: [f"S{index}" for index in range(count)],
        "setups": lambda count: [f"setup-{index}" for index in range(count)],
    }
    for identifier, factory in factories.items():
        maximum = exposed[identifier]["max_items"]
        AnalyticsFilters(**BASE_FILTERS, **{identifier: factory(maximum)})
        with pytest.raises(ValidationError):
            AnalyticsFilters(**BASE_FILTERS, **{identifier: factory(maximum + 1)})


def test_filter_metric_applicability_matches_query_validation():
    exposed = {item["id"]: item for item in metadata()["data"]["filters"]}
    assert exposed["rule_statuses"]["applicable_sample_units"] == ["trade_rule"]
    AnalyticsQuery(metric="adherence_pct", dimension="all", filters={
        **BASE_FILTERS, "rule_statuses": ["FOLLOWED"],
    })
    with pytest.raises(ValidationError):
        AnalyticsQuery(metric="trade_count", dimension="all", filters={
            **BASE_FILTERS, "rule_statuses": ["FOLLOWED"],
        })


def test_cross_filter_constraints_match_request_validation():
    constraints = {item["id"]: item for item in metadata()["data"]["filter_constraints"]}
    assert constraints["close_time_order"] == {
        "id": "close_time_order", "kind": "ORDER", "fields": ["start_time", "end_time"], "value": None,
        "description": "start_time must be less than or equal to end_time.",
    }
    assert constraints["unassigned_excludes_strategy_ids"]["fields"] == [
        "assignment", "strategy_ids", "strategy_version_ids",
    ]
    with pytest.raises(ValidationError):
        AnalyticsFilters(start_time=2, end_time=1)
    with pytest.raises(ValidationError):
        AnalyticsFilters(**BASE_FILTERS, assignment="UNASSIGNED", strategy_ids=[1])


def test_close_time_semantics_are_explicit_for_every_time_dimension():
    dimensions = {item["id"]: item for item in metadata()["data"]["dimensions"]}
    for identifier in ("day", "week", "month", "weekday", "hour"):
        item = dimensions[identifier]
        assert item["category"] == "time"
        assert item["time_basis"] == "CLOSE_DATETIME"
        assert item["timezone"] == "UTC"
        assert "close/exit" in item["semantics"].lower()
    assert dimensions["hour"]["label"] == "Close hour"
    assert dimensions["weekday"]["label"] == "Close weekday"


def test_endpoint_is_json_safe_db_independent_and_side_effect_free(monkeypatch):
    before_metrics = tuple(METRIC_REGISTRY.items())
    before_dimensions = tuple(DIMENSION_REGISTRY.items())
    monkeypatch.setattr(repository, "load_snapshot", lambda *args, **kwargs: pytest.fail("metadata queried analytics data"))
    payload = metadata()
    encoded = json.dumps(payload, allow_nan=False)
    assert "<function" not in encoded and "MappingProxyType" not in encoded
    assert tuple(METRIC_REGISTRY.items()) == before_metrics
    assert tuple(DIMENSION_REGISTRY.items()) == before_dimensions


def test_query_response_preserves_pre_metadata_public_keys_and_openapi_schema():
    with TestClient(app) as client:
        response = client.post("/api/analytics/query", json={
            "metric": "trade_count", "dimension": "all", "filters": BASE_FILTERS,
        })
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data["metric"]) == {
        "id", "label", "unit", "sample_unit", "aggregation", "availability", "supported_dimensions",
    }
    assert set(data["dimension"]) == {"id", "label", "semantics", "multi_membership"}
    assert "value_type" not in data["metric"]
    assert not ({"category", "time_basis", "timezone"} & set(data["dimension"]))

    schemas = app.openapi()["components"]["schemas"]
    query_metric = schemas["MetricMetadata"]["properties"]
    query_dimension = schemas["DimensionMetadata"]["properties"]
    assert "value_type" not in query_metric
    assert not ({"category", "time_basis", "timezone"} & set(query_dimension))
    assert "value_type" in schemas["AnalyticsDiscoveryMetricMetadata"]["properties"]
    assert {"category", "time_basis", "timezone"} <= set(
        schemas["AnalyticsDiscoveryDimensionMetadata"]["properties"]
    )
