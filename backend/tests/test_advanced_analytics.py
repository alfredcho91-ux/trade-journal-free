from copy import deepcopy
from dataclasses import asdict
from decimal import getcontext, localcontext
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app
from backend.modules.analytics import core, repository, service
from backend.modules.analytics.core import TradeFacts, analyze
from backend.modules.analytics.registry import DIMENSION_REGISTRY, METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.analytics.service import query_analytics
from backend.modules.journal import performance
from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.service import _evaluate_document, get_strategy_evaluation_service
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_assignments import repository as assignments
from backend.utils.error_handler import APIError, ValidationError as APIValidationError

START = 1767225600000  # 2026-01-01T00:00:00Z
END = 1798761599999  # 2026-12-31T23:59:59.999Z


def query(metric="trade_count", dimension="all", **filters):
    return AnalyticsQuery(metric=metric, dimension=dimension, filters={"start_time": START, "end_time": END, **filters})


def entry(identifier=1, **changes):
    return {"id": identifier, "source": "binance_position", "external_id": f"position-{identifier}",
            "datetime": "2026-01-01T11:00:00Z", "entry_datetime": "2026-01-01T10:00:00Z",
            "symbol": "BTC/USDT", "direction": "Long", "entry_price": 100., "exit_price": 110.,
            "realized_pnl": 20., "invested_amount": 100., "fee": 0., "funding_fee": 0.,
            "r_multiple": 2., "setup_tags": ["breakout"], "confidence_score": 4, "focus_score": 5,
            "fomo": False, "revenge_trade": True, **changes}


def document(schema=2, expected=False):
    return {"schema_version": schema,
            "entry_rules": [{"id": "fomo", "text": "No FOMO", **({"evaluation": {"metric_id": "journal.fomo", "operator": "eq", "expected": expected}} if schema == 2 else {})}],
            "risk_rules": [], "exit_rules": []}


def assignment(version=10, strategy=1, rules=None):
    return {"strategy_id": strategy, "strategy_version_id": version, "strategy_name": f"Strategy {strategy}",
            "version_label": f"v{version}", "version_rules": rules or document()}


def fact(row, assigned=None):
    observations = extract_metric_observations(row)
    results = _evaluate_document(assigned["version_rules"], observations) if assigned else []
    return TradeFacts(row, assigned, observations, tuple(results))


def result(facts, metric="trade_count", dimension="all", **filters):
    return analyze(facts, query(metric, dimension, **filters))


@pytest.fixture
def db(monkeypatch, tmp_path):
    path = tmp_path / "analytics.db"
    monkeypatch.setattr(journal, "JOURNAL_DB_PATH", path)
    monkeypatch.setattr(journal, "JOURNAL_CSV_PATH", tmp_path / "absent.csv")
    journal.INITIALIZED_DATABASES.clear()
    assignments.initialize_schema(db_path=path)
    yield path
    journal.INITIALIZED_DATABASES.clear()


def save(db, identifier=1, **changes):
    row = entry(identifier, **changes)
    row.pop("id")
    record, created = journal.add_entry_if_new_external_id(row, db_path=db)
    assert created
    return record


def save_strategy(db, name="Strategy", rules=None):
    return strategies.create_strategy(name=name, name_key=name.casefold(), description=None, version_label="v1",
                                      version_label_key="v1", version_description=None, rules=rules or document(), db_path=db)


def link_plan(db, row, monkeypatch):
    monkeypatch.setattr(plans, "utc_now", lambda: "2026-01-01T09:00:00Z")
    plan = plans.create_plan({"exchange": "binance", "symbol": row["symbol"], "side": "Long", "revision": {
        "entry_price": 100, "stop_loss": 98, "take_profit": 105}}, db_path=db)
    return plans.link_plan(plan["id"], row["id"], db_path=db)


@pytest.mark.parametrize("metric,expected,sample", [
    ("trade_count", 4, 4), ("win_rate_pct", 100 / 3, 3), ("loss_rate_pct", 100 / 3, 3),
    ("net_return_pct", 2.5, 3), ("average_return_pct", 5., 3),
    ("total_realized_r", 1., 3), ("average_r", 1 / 3, 3), ("profit_factor", 2., 3),
    ("average_holding_minutes", 60., 4),
    ("followed_count", 1, 3), ("violated_count", 2, 3), ("not_evaluable_count", 1, 3),
    ("adherence_pct", 100 / 3, 3), ("coverage_pct", 75., 3),
])
def test_each_metric_has_independent_expected_formula(metric, expected, sample):
    rows = [entry(1), entry(2, realized_pnl=-10, invested_amount=200, r_multiple=-1, fomo=True),
            entry(3, realized_pnl=0, r_multiple=0, fomo=True),
            entry(4, realized_pnl=None, r_multiple=None, fomo=None)]
    data = result([fact(row, assignment()) for row in rows], metric)
    group = data.groups[0]
    assert float(group.value) == pytest.approx(expected)
    assert group.total_sample == 4
    assert group.evaluable_sample == sample
    assert group.unavailable_sample == 4 - sample
    assert sum(group.unavailable_reasons.values()) == group.unavailable_sample
    assert data.metric.id == metric and data.metric.aggregation and data.metric.availability
    assert group.evidence_semantics == data.evidence_semantics == "OBSERVED_ASSOCIATION"


def test_registered_metrics_are_exactly_covered():
    assert set(METRIC_REGISTRY) == {"trade_count", "win_rate_pct", "loss_rate_pct", "net_return_pct",
                                   "average_return_pct", "total_realized_r", "average_r", "profit_factor",
                                   "average_holding_minutes", "followed_count", "violated_count", "not_evaluable_count",
                                   "adherence_pct", "coverage_pct"}


@pytest.mark.parametrize("dimension,key", [
    ("all", "all"), ("strategy", "strategy:1"), ("strategy_version", "strategy_version:10"),
    ("setup", "value:breakout"), ("confidence_score", "value:4"), ("focus_score", "value:5"),
    ("fomo", "value:FALSE"), ("revenge_trade", "value:TRUE"), ("symbol", "value:BTC/USDT"),
    ("direction", "value:Long"), ("day", "value:2026-01-01"), ("week", "value:2026-W01"),
    ("month", "value:2026-01"), ("weekday", "value:3"), ("hour", "value:11"),
    ("rule", "rule:10:ENTRY:fomo"), ("rule_status", "status:FOLLOWED"),
])
def test_each_dimension_has_stable_identity(dimension, key):
    metric = "followed_count" if dimension in {"rule", "rule_status"} else "trade_count"
    data = result([fact(entry(), assignment())], metric, dimension)
    assert data.groups[0].identity.key == key
    assert data.groups[0].value == 1
    assert data.dimension.id == dimension and data.dimension.semantics


def test_dimension_allowlist_is_complete():
    assert set(DIMENSION_REGISTRY) == {"all", "strategy", "strategy_version", "setup", "confidence_score", "focus_score",
                                      "fomo", "revenge_trade", "symbol", "direction", "day", "week", "month", "weekday",
                                      "hour", "rule", "rule_status"}


@pytest.mark.parametrize("metric", list(METRIC_REGISTRY))
def test_empty_sample_is_explicit(metric):
    group = result([], metric).groups[0]
    assert group.total_sample == group.evaluable_sample == group.unavailable_sample == group.trade_sample == 0
    if metric.endswith("count"):
        assert group.value == 0
    else:
        assert group.value is None and group.unavailable_reason == "EMPTY_SAMPLE"


def test_profit_factor_no_losses_and_breakeven():
    win = result([fact(entry())], "profit_factor").groups[0]
    assert win.value is None and win.profit_factor_infinite and win.unavailable_reason == "NO_LOSSES"
    flat = result([fact(entry(realized_pnl=0))], "profit_factor").groups[0]
    assert flat.value is None and not flat.profit_factor_infinite
    loss = result([fact(entry(realized_pnl=-20))], "profit_factor").groups[0]
    assert loss.value == 0 and not loss.profit_factor_infinite


def test_existing_performance_semantics_and_margin_inference_reused(monkeypatch):
    rows = [entry(1, invested_amount=None, leverage=2, fee=2, funding_fee=-1), entry(2, realized_pnl=-10, invested_amount=200)]
    monkeypatch.setattr(performance.repository, "list_entries", lambda: rows)
    old = performance.run_journal_performance_service(START, END)["data"]
    for metric in ("win_rate_pct", "profit_factor", "net_return_pct"):
        assert result([fact(row) for row in rows], metric).groups[0].value == old[metric]
    assert old == performance.summarize_performance(rows)


@pytest.mark.parametrize("field,values,states", [
    ("fomo", [False, True, None, "false", 0], {"value:FALSE": 1, "value:TRUE": 1, "state:UNRECORDED": 1, "state:INVALID": 2}),
    ("revenge_trade", [False, True, None, 1], {"value:FALSE": 1, "value:TRUE": 1, "state:UNRECORDED": 1, "state:INVALID": 1}),
    ("confidence_score", [1, 5, None, 0, 6, True], {"value:1": 1, "value:5": 1, "state:UNRECORDED": 1, "state:INVALID": 3}),
    ("focus_score", [1, 5, None, -1, "3"], {"value:1": 1, "value:5": 1, "state:UNRECORDED": 1, "state:INVALID": 2}),
])
def test_psychology_tristate_and_invalid_are_not_coerced(field, values, states):
    facts = [fact(entry(i, **{field: value})) for i, value in enumerate(values, 1)]
    assert {group.identity.key: group.value for group in result(facts, dimension=field).groups} == states
    assert result(facts, **{field: ["UNRECORDED"]}).groups[0].value == 1


def test_setup_multimembership_deduplicates_and_never_infers_strategy():
    facts = [fact(entry(1, setup_tags=["Strategy 1", "breakout", "breakout"])), fact(entry(2, setup_tags=[]))]
    assert result(facts, dimension="strategy").groups[0].identity.state == "UNASSIGNED"
    groups = result(facts, dimension="setup").groups
    assert {g.identity.key: g.value for g in groups} == {"state:UNRECORDED": 1, "value:Strategy 1": 1, "value:breakout": 1}
    assert result(facts, dimension="setup").dimension.multi_membership


@pytest.mark.parametrize("filters,expected", [
    ({"strategy_ids": [1]}, 2), ({"strategy_version_ids": [11]}, 1), ({"assignment": "UNASSIGNED"}, 1),
    ({"assignment": "ASSIGNED"}, 2), ({"symbols": ["ETH/USDT"]}, 1), ({"directions": ["Short"]}, 1),
    ({"setups": ["reversal"]}, 1), ({"fomo": ["FALSE"]}, 1), ({"fomo": ["UNRECORDED"]}, 1),
    ({"focus_score": ["1"]}, 1), ({"confidence_score": ["2"]}, 1), ({"revenge_trade": ["FALSE"]}, 1),
    ({"strategy_ids": [1], "directions": ["Short"], "fomo": ["TRUE"]}, 1), ({"strategy_ids": [999]}, 0),
])
def test_typed_filters_apply_and_across_fields_or_within_lists(filters, expected):
    facts = [fact(entry(1), assignment()), fact(entry(2, symbol="ETH/USDT", direction="Short", setup_tags=["reversal"],
                                                   fomo=True, confidence_score=2, focus_score=1, revenge_trade=False), assignment(11)),
             fact(entry(3, fomo=None))]
    assert result(facts, **filters).groups[0].value == expected


def test_close_date_boundaries_and_exclusions():
    facts = [fact(entry(1, datetime="2026-01-01T00:00:00Z")), fact(entry(2, datetime="2026-12-31T23:59:59.999Z")),
             fact(entry(3, datetime="2025-12-31T23:59:59.999Z")), fact(entry(4, datetime="2027-01-01T00:00:00Z")),
             fact(entry(5, source="binance_fill")), fact(entry(6, datetime=None, r_multiple=99))]
    assert result(facts).groups[0].value == 2
    assert result(facts, "total_realized_r").groups[0].value == 4
    assert result(facts, start_time=START, end_time=START).groups[0].value == 1


def test_utc_offsets_naive_and_iso_week_year():
    facts = [fact(entry(1, datetime="2026-01-01T00:30:00+09:00")), fact(entry(2, datetime="2025-12-31T15:30:00"))]
    for dimension, expected in (("day", "2025-12-31"), ("hour", "15"), ("weekday", "2"), ("week", "2026-W01"), ("month", "2025-12")):
        groups = result(facts, dimension=dimension, start_time=START - 86400000).groups
        assert len(groups) == 1 and groups[0].identity.label == expected and groups[0].value == 2


def test_rule_denominators_unknown_no_rules_and_status_filter():
    no_rules = {"schema_version": 2, "entry_rules": [], "risk_rules": [], "exit_rules": []}
    facts = [fact(entry(1, fomo=False), assignment()), fact(entry(2, fomo=True), assignment()),
             fact(entry(3, fomo=None), assignment()), fact(entry(4), assignment(11, rules=document(schema=1))),
             fact(entry(5)), fact(entry(6), assignment(12, rules=no_rules))]
    group = result(facts, "adherence_pct").groups[0]
    assert group.value == "50"
    assert group.rule_summary.model_dump() == {"total_rules": 4, "evaluable_rules": 2, "followed_rules": 1,
                                              "violated_rules": 1, "not_evaluable_rules": 2, "adherence_pct": "50", "coverage_pct": "50"}
    assert group.trade_sample == 6 and group.unassigned_trade_count == group.assigned_without_rules_count == 1
    groups = result(facts, "not_evaluable_count", "rule_status").groups
    assert {g.identity.key: g.value for g in groups} == {"status:FOLLOWED": 0, "status:VIOLATED": 0,
                                                       "status:NOT_EVALUABLE": 2, "state:UNASSIGNED": 0, "state:NO_RULES": 0}
    filtered = result(facts, "coverage_pct", rule_statuses=["NOT_EVALUABLE"]).groups[0]
    assert filtered.value == "0" and filtered.rule_summary.violated_rules == 0 and filtered.trade_sample == 2


def test_rule_identity_keeps_same_rule_id_in_different_versions_separate():
    facts = [fact(entry(1), assignment(10)), fact(entry(2), assignment(11, rules=document(expected=True)))]
    groups = result(facts, "adherence_pct", "rule").groups
    assert [(g.identity.strategy_version_id, g.value) for g in groups] == [(10, "100"), (11, "0")]


@pytest.mark.parametrize("payload", [
    {"metric": "sql"}, {"dimension": "session"}, {"metric": "trade_count", "dimension": "rule"},
    {"filters": {"rule_statuses": ["VIOLATED"]}}, {"filters": {"strategy_ids": list(range(1, 52))}},
    {"filters": {"strategy_ids": [True]}}, {"filters": {"strategy_ids": [0]}},
    {"filters": {"strategy_ids": [1, 1]}}, {"filters": {"symbols": []}}, {"filters": {"symbols": [" "]}},
    {"filters": {"symbols": ["x" * 161]}}, {"filters": {"directions": ["Sell"]}},
    {"filters": {"fomo": [False]}}, {"filters": {"confidence_score": ["0"]}},
    {"filters": {"strategy_ids": [1], "assignment": "UNASSIGNED"}}, {"filters": {"start_time": END, "end_time": START}},
    {"filters": {"start_time": "2026-01-01"}}, {"filters": {"where": "1=1"}}, {"expression": "SELECT *"},
])
def test_query_rejects_unbounded_or_unsupported_contract(payload):
    base = {"metric": "trade_count", "filters": {"start_time": START, "end_time": END}}
    merged = {**base, **payload, "filters": {**base["filters"], **payload.get("filters", {})}}
    with pytest.raises(ValidationError):
        AnalyticsQuery.model_validate(merged)


def test_pure_engine_determinism_context_and_input_immutability():
    facts = [fact(entry(2, fomo=None), assignment()), fact(entry(1), assignment())]
    before, registry_before = deepcopy(facts), [asdict(item) for item in METRIC_REGISTRY.values()]
    results = []
    for precision in (6, 12, 28, 50):
        with localcontext() as context:
            context.prec = precision
            caller = getcontext().copy()
            results.append(result(facts, "adherence_pct").model_dump())
            assert getcontext().prec == caller.prec and getcontext().flags == caller.flags
    assert all(item == results[0] for item in results)
    assert result(list(reversed(facts)), "adherence_pct").model_dump() == results[0]
    assert facts == before and [asdict(item) for item in METRIC_REGISTRY.values()] == registry_before


def test_group_limit_is_explicit_not_silent_truncation(monkeypatch):
    monkeypatch.setattr(core, "MAX_GROUPS", 1)
    with pytest.raises(APIValidationError):
        result([fact(entry(1)), fact(entry(2, symbol="ETH/USDT"))], dimension="symbol")


def test_api_contract_historical_assignment_and_read_only(db):
    row = save(db)
    unassigned = save(db, 2, setup_tags=["Strategy"])
    strategy = save_strategy(db)
    first = strategy["active_version_id"]
    second = strategies.create_version(strategy["id"], version_label="v2", version_label_key="v2", description=None,
                                       rules=document(expected=True), db_path=db)
    assignments.put_assignment(row["id"], first, db_path=db)
    strategies.activate_version(strategy["id"], second["id"], db_path=db)
    strategies.retire_version(strategy["id"], first, db_path=db)
    strategies.set_strategy_archived(strategy["id"], True, db_path=db)
    with sqlite3.connect(db) as conn:
        before = list(conn.iterdump())
    with TestClient(app) as client:
        response = client.post("/api/analytics/query", json=query("adherence_pct", "strategy_version").model_dump(mode="json"))
        repeated = client.post("/api/analytics/query", json=query("adherence_pct", "strategy_version").model_dump(mode="json"))
        invalid = client.post("/api/analytics/query", json={"metric": "sql", "filters": {"start_time": START, "end_time": END}})
    assert response.status_code == 200 and response.json() == repeated.json()
    assert invalid.status_code == 422 and invalid.json()["error_code"] == "VALIDATION_ERROR"
    data = response.json()["data"]
    groups = {group["identity"]["key"]: group for group in data["groups"]}
    assert groups[f"strategy_version:{first}"]["value"] == "100"
    assert groups["state:UNASSIGNED"]["value"] is None
    assert data["timezone"] == "UTC" and data["evaluation_basis"] == "CURRENT_RECONSTRUCTED"
    assert data["selected_trade_count"] == 2
    assert second["id"] not in [group["identity"]["strategy_version_id"] for group in data["groups"]]
    with sqlite3.connect(db) as conn:
        assert list(conn.iterdump()) == before


def test_batch_plan_evaluation_matches_per_trade_pr2b(db, monkeypatch):
    row = save(db)
    rules = document()
    rules["risk_rules"] = [{"id": "stop", "text": "Stop max 3%", "evaluation": {"metric_id": "plan.stop_distance_pct", "operator": "lte", "expected": 3}}]
    strategy = save_strategy(db, rules=rules)
    assignments.put_assignment(row["id"], strategy["active_version_id"], db_path=db)
    link_plan(db, row, monkeypatch)
    expected = get_strategy_evaluation_service(row["id"], db_path=db)["data"]["summary"]["overall"]
    actual = query_analytics(query("adherence_pct"), db_path=db).data.groups[0]
    assert actual.rule_summary.model_dump() == expected
    assert actual.value == "100"


def test_repository_preserves_invalid_sqlite_psychology_and_exposes_missing_close(db):
    row = save(db)
    save(db, 2, datetime=None)
    with sqlite3.connect(db) as conn:
        conn.execute("PRAGMA ignore_check_constraints=ON")
        conn.execute("UPDATE journal_entries SET fomo='false', confidence_score=9 WHERE id=?", (row["id"],))
    for dimension in ("fomo", "confidence_score"):
        data = query_analytics(query(dimension=dimension), db_path=db).data
        assert data.groups[0].identity.state == "INVALID"
        assert data.excluded_unavailable_close_count == 1


def test_absent_database_is_empty_without_creation(tmp_path):
    path = tmp_path / "absent.db"
    assert query_analytics(query(), db_path=path).data.groups[0].value == 0
    assert not path.exists()


def test_snapshot_uses_constant_queries_and_no_write_statements(db, monkeypatch):
    strategy = save_strategy(db)
    statements = []
    original_connect = sqlite3.connect
    def traced(*args, **kwargs):
        conn = original_connect(*args, **kwargs)
        conn.set_trace_callback(statements.append)
        return conn
    row = save(db)
    link_plan(db, row, monkeypatch)
    assignments.put_assignment(1, strategy["active_version_id"], db_path=db)
    with monkeypatch.context() as patch:
        patch.setattr(repository.sqlite3, "connect", traced)
        query_analytics(query("adherence_pct"), db_path=db)
    single = len([sql for sql in statements if sql.lstrip().upper().startswith("SELECT")])
    for i in range(2, 12):
        row = save(db, i)
        assignments.put_assignment(row["id"], strategy["active_version_id"], db_path=db)
    statements.clear()
    with monkeypatch.context() as patch:
        patch.setattr(repository.sqlite3, "connect", traced)
        query_analytics(query("adherence_pct"), db_path=db)
    assert len([sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]) == single
    assert all(sql.lstrip().upper().startswith(("SELECT", "BEGIN", "PRAGMA QUERY_ONLY")) for sql in statements)
    assert single == 5


def test_snapshot_is_coherent_during_concurrent_annotation_and_assignment_write(db, monkeypatch):
    row = save(db)
    old = save_strategy(db, "Old")
    new = save_strategy(db, "New", document(expected=True))
    assignments.put_assignment(row["id"], old["active_version_id"], db_path=db)
    read, resume = Event(), Event()
    original = repository._read_journal
    def paused(conn):
        entries = original(conn)
        read.set()
        assert resume.wait(10)
        return entries
    with monkeypatch.context() as patch, ThreadPoolExecutor(max_workers=1) as pool:
        patch.setattr(repository, "_read_journal", paused)
        future = pool.submit(query_analytics, query("adherence_pct", "strategy_version"), db_path=db)
        assert read.wait(10)
        try:
            journal.update_entry_behavior(row["id"], {"fomo": True}, db_path=db)
            assignments.put_assignment(row["id"], new["active_version_id"], db_path=db)
        finally:
            resume.set()
        group = future.result(timeout=10).data.groups[0]
    assert group.identity.strategy_version_id == old["active_version_id"] and group.value == "100"
    fresh = query_analytics(query("adherence_pct", "strategy_version"), db_path=db).data.groups[0]
    assert fresh.identity.strategy_version_id == new["active_version_id"] and fresh.value == "100"


def test_snapshot_limit_and_broken_provenance_fail_explicitly(db, monkeypatch):
    row = save(db)
    with monkeypatch.context() as patch:
        patch.setattr(repository, "MAX_TRADES", 0)
        with pytest.raises(APIValidationError):
            query_analytics(query(), db_path=db)
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO journal_strategy_assignments VALUES (?,999,'now','now')", (row["id"],))
    with pytest.raises(APIError):
        query_analytics(query(), db_path=db)


def test_rule_result_limit_is_explicit(db, monkeypatch):
    row = save(db)
    strategy = save_strategy(db)
    assignments.put_assignment(row["id"], strategy["active_version_id"], db_path=db)
    monkeypatch.setattr(service, "MAX_RULE_RESULTS", 0)
    with pytest.raises(APIValidationError):
        query_analytics(query("adherence_pct"), db_path=db)


def test_api_rejects_unknown_fields_and_treats_sql_like_symbol_as_literal(db):
    save(db)
    with TestClient(app) as client:
        unknown = client.post("/api/analytics/query", json={**query().model_dump(), "sql": "DROP TABLE journal_entries"})
        literal = client.post("/api/analytics/query", json=query(symbols=["BTC' OR 1=1 --"]).model_dump())
        incompatible = client.post("/api/analytics/query", json={**query().model_dump(), "dimension": "rule_status"})
    assert unknown.status_code == incompatible.status_code == 422
    assert literal.status_code == 200 and literal.json()["data"]["groups"][0]["value"] == 0
    assert query_analytics(query(), db_path=db).data.groups[0].value == 1


def test_plan_revision_snapshot_remains_coherent_under_concurrent_write(db, monkeypatch):
    row = save(db)
    rules = {"schema_version": 2, "entry_rules": [], "exit_rules": [], "risk_rules": [
        {"id": "stop", "text": "stop <= 3", "evaluation": {"metric_id": "plan.stop_distance_pct", "operator": "lte", "expected": 3}}]}
    strategy = save_strategy(db, rules=rules)
    assignments.put_assignment(row["id"], strategy["active_version_id"], db_path=db)
    plan = link_plan(db, row, monkeypatch)
    read, resume = Event(), Event()
    original = repository._read_assignments
    def paused(conn):
        values = original(conn)
        read.set()
        assert resume.wait(10)
        return values
    with monkeypatch.context() as patch, ThreadPoolExecutor(max_workers=1) as pool:
        patch.setattr(repository, "_read_assignments", paused)
        future = pool.submit(query_analytics, query("adherence_pct"), db_path=db)
        assert read.wait(10)
        try:
            # Simulate an atomic committed revision change after the read snapshot.
            with sqlite3.connect(db) as conn:
                conn.execute("UPDATE trading_plan_revisions SET stop_loss=90 WHERE plan_id=?", (plan["id"],))
        finally:
            resume.set()
        old = future.result(timeout=10).data.groups[0]
    assert old.value == "100"
    assert query_analytics(query("adherence_pct"), db_path=db).data.groups[0].value == "0"


def test_two_assigned_versions_same_strategy_and_unassigned_have_correct_totals(db):
    first, second, third = save(db, 1), save(db, 2), save(db, 3)
    strategy = save_strategy(db)
    version = strategies.create_version(strategy["id"], version_label="v2", version_label_key="v2", description=None,
                                       rules=document(expected=True), db_path=db)
    assignments.put_assignment(first["id"], strategy["active_version_id"], db_path=db)
    assignments.put_assignment(second["id"], version["id"], db_path=db)
    groups = query_analytics(query(dimension="strategy_version"), db_path=db).data.groups
    assert len(groups) == 3 and all(group.value == 1 for group in groups)
    groups = query_analytics(query(dimension="strategy"), db_path=db).data.groups
    assert {group.identity.key: group.value for group in groups} == {f"strategy:{strategy['id']}": 2, "state:UNASSIGNED": 1}


def test_missing_holding_time_and_r_preserve_per_metric_denominators():
    rows = [entry(1), entry(2, entry_datetime=None, r_multiple=None), entry(3, entry_datetime="2026-01-02T00:00:00Z", r_multiple=-1)]
    facts = [fact(row) for row in rows]
    holding = result(facts, "average_holding_minutes").groups[0]
    assert holding.value == 60 and holding.evaluable_sample == 1 and holding.unavailable_sample == 2
    r = result(facts, "average_r").groups[0]
    assert r.value == 0.5 and r.evaluable_sample == 2 and r.unavailable_sample == 1


def test_malformed_entry_time_isolated_from_r_and_return_metrics_api(db):
    valid = save(db, 1, r_multiple=4)
    malformed = save(db, 2, entry_datetime="NaT", r_multiple=2)
    with TestClient(app) as client:
        average_r = client.post("/api/analytics/query", json=query("average_r").model_dump(mode="json"))
        total_r = client.post("/api/analytics/query", json=query("total_realized_r").model_dump(mode="json"))
        holding = client.post("/api/analytics/query", json=query("average_holding_minutes").model_dump(mode="json"))
        returned = client.post("/api/analytics/query", json=query("average_return_pct").model_dump(mode="json"))
    assert average_r.status_code == total_r.status_code == holding.status_code == returned.status_code == 200
    assert average_r.json()["data"]["groups"][0]["value"] == 3
    assert total_r.json()["data"]["groups"][0]["value"] == 6
    holding_group = holding.json()["data"]["groups"][0]
    assert holding_group["value"] == 60 and holding_group["evaluable_sample"] == 1
    assert holding_group["unavailable_sample"] == 1
    assert holding_group["unavailable_reasons"] == {"INVALID_HISTORICAL_DATA": 1}
    assert returned.json()["data"]["groups"][0]["value"] == 20
    assert valid["id"] != malformed["id"]


def test_malformed_independent_psychology_does_not_poison_return_api(db):
    row = save(db, fomo=False)
    with sqlite3.connect(db) as conn:
        conn.execute("PRAGMA ignore_check_constraints=ON")
        conn.execute("UPDATE journal_entries SET fomo='not-a-bool' WHERE id=?", (row["id"],))
    with TestClient(app) as client:
        response = client.post("/api/analytics/query", json=query("average_return_pct").model_dump(mode="json"))
        invalid = client.post("/api/analytics/query", json={"metric": "average_r", "filters": {"start_time": "bad", "end_time": END}})
    assert response.status_code == 200
    assert response.json()["data"]["groups"][0]["value"] == 20
    assert invalid.status_code == 422 and invalid.json()["error_code"] == "VALIDATION_ERROR"


def test_unexpected_observation_programming_error_is_not_silently_hidden(db, monkeypatch):
    save(db)
    def broken(*_args, **_kwargs):
        raise RuntimeError("test-only extractor defect")
    monkeypatch.setattr(service, "extract_metric_observations", broken)
    with pytest.raises(RuntimeError, match="test-only extractor defect"):
        query_analytics(query("average_r"), db_path=db)
