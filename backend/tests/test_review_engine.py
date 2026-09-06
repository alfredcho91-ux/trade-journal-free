"""PR3 behavioral contracts, including real SQLite snapshot concurrency."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import localcontext
import json
import sqlite3
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.analytics import repository as snapshots
from backend.modules.analytics.core import TradeFacts, analyze
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.review import context, core, service
from backend.modules.review.context import ReviewContext, load_context
from backend.modules.review.schemas import DIAGNOSIS_RULE_METRIC_ROLES, DIMENSIONS, ReviewPolicy, ReviewRequest
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.registry import METRIC_REGISTRY as RULE_METRIC_REGISTRY
from backend.modules.rule_engine.service import _evaluate_document
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_assignments import repository as assignments
from backend.utils.error_handler import ValidationError as APIValidationError

START = 1767225600000
DAY = 86400000


def request(**overrides):
    return ReviewRequest(filters={"start_time": START, "end_time": START + DAY - 1}, **overrides)


def row(identifier=1, **overrides):
    return {"id": identifier, "external_id": f"pr3-{identifier}", "source": "binance_position",
            "datetime": "2026-01-01T11:00:00Z", "entry_datetime": "2026-01-01T10:00:00Z",
            "symbol": "BTC/USDT", "direction": "Long", "entry_price": 100., "exit_price": 104.,
            "realized_pnl": 20., "invested_amount": 100., "fee": 0., "funding_fee": 0.,
            "r_multiple": 2., "setup_tags": ["breakout"], "confidence_score": 4, "focus_score": 5,
            "fomo": False, "revenge_trade": False, **overrides}


def document(expected=False, descriptive=False):
    return {"schema_version": 2, "entry_rules": [{"id": "entry-deviation", "text": "Entry deviation <= 0.1R",
            **({} if descriptive else {"evaluation": {"metric_id": "execution.entry_deviation_r", "operator": "lte", "expected": .1}})}],
            "risk_rules": [], "exit_rules": []}


def evaluator_rule(identifier, metric_id, operator, expected):
    return {"id": identifier, "text": identifier,
            "evaluation": {"metric_id": metric_id, "operator": operator, "expected": expected}}


def rule_document(*rules):
    return {"schema_version": 2, "entry_rules": list(rules), "risk_rules": [], "exit_rules": []}


def categorized_document(*, entry=(), risk=(), exit=()):
    return {"schema_version": 2, "entry_rules": list(entry), "risk_rules": list(risk), "exit_rules": list(exit)}


def fomo_document(expected=False):
    return rule_document(evaluator_rule("fomo", "journal.fomo", "eq", expected))


def assigned(version=10, strategy=1, rules=None):
    return {"strategy_id": strategy, "strategy_version_id": version, "strategy_name": "Strategy",
            "version_label": "v1", "version_rules": document() if rules is None else rules}


def linked(entry, **revision_overrides):
    return {"id": entry["id"], "symbol": entry["symbol"], "side": "Long", "source": "VERIFIED_PRETRADE",
            "link": {"journal_entry_id": entry["id"], "journal_external_id": entry["external_id"], "link_status": "LINKED"},
            "revisions": [{"id": entry["id"], "version": 1, "entry_price": 100., "stop_loss": 98.,
                           "take_profit": 105., "max_hold_hours": 12., "received_at": "2026-01-01T09:00:00Z",
                           **revision_overrides}]}


def fact(entry, assignment=None, plan=True, plan_revision=None):
    observations = extract_metric_observations(entry, linked_plan=linked(entry, **(plan_revision or {})) if plan else None)
    rules = _evaluate_document(assignment["version_rules"], observations) if assignment else []
    return TradeFacts(entry, assignment, observations, tuple(rules))


def cohort(count=5, *, assignment=None, plan=True, plan_revision=None, **overrides):
    return tuple(fact(row(i + 1, **overrides), assignment if assignment is not None else assigned(), plan, plan_revision) for i in range(count))


def diagnosis(facts):
    return core.diagnose(facts, request()).diagnoses[0]


def test_diagnosis_policy_explicitly_classifies_every_rule_registry_metric():
    assert set(DIAGNOSIS_RULE_METRIC_ROLES) == set(RULE_METRIC_REGISTRY)
    assert {metric for metric, role in DIAGNOSIS_RULE_METRIC_ROLES.items() if role == "EXECUTION_PROCESS"} == {
        "plan.recorded_before_entry", "execution.entry_deviation_r",
    }
    assert {metric for metric, role in DIAGNOSIS_RULE_METRIC_ROLES.items() if role == "OUTCOME"} == {
        "execution.holding_minutes", "execution.price_return_pct", "execution.realized_r",
    }


@pytest.mark.parametrize("positive,healthy,expected", [
    (True, True, "STRATEGY_POSITIVE_EXECUTION_HEALTHY"),
    (True, False, "STRATEGY_POSITIVE_EXECUTION_DRAG"),
    (False, True, "STRATEGY_WEAK_EXECUTION_HEALTHY"),
    (False, False, "STRATEGY_WEAK_EXECUTION_DRAG"),
])
def test_four_classifications_use_independent_observed_signals(positive, healthy, expected):
    result = diagnosis(cohort(realized_pnl=20 if positive else -20, r_multiple=2 if positive else -2,
                              entry_price=100 if healthy else 101, fomo=not healthy))
    assert result.classification == expected
    assert result.evidence_semantics == "OBSERVED_ASSOCIATION"
    assert result.entry_deviation.evaluable_sample == result.evaluable_rule_trade_sample == 5
    assert result.entry_deviation.within_entry_limit_sample == (5 if healthy else 0)
    assert result.entry_deviation.value == pytest.approx(0 if healthy else 1 / 3)
    assert result.entry_deviation.unit == "R" and result.entry_deviation.aggregation == "MEAN"
    assert result.execution_rule_evidence.summary.adherence_pct == ("100" if healthy else "0")
    assert len(result.reasons) == 2 and all(code.startswith("OBSERVED_") for code in result.reasons)


@pytest.mark.parametrize("options,reason", [
    ({"count": 4}, "STRATEGY_SMALL_SAMPLE"),
    ({"plan": False}, "INSUFFICIENT_PLAN_ENTRY_SAMPLE"),
    ({"r_multiple": None}, "STRATEGY_METRIC_UNAVAILABLE"),
    ({"r_multiple": 0}, "STRATEGY_SIGNALS_CONFLICT_OR_NEUTRAL"),
    ({"r_multiple": -2}, "STRATEGY_SIGNALS_CONFLICT_OR_NEUTRAL"),
    ({"entry_price": 101, "assignment": assigned(rules=rule_document(evaluator_rule("lenient-entry", "execution.entry_deviation_r", "lte", 1)))}, "EXECUTION_SIGNALS_CONFLICT"),
    ({"entry_price": None}, "NO_EVALUABLE_RULES"),
    ({"assignment": assigned(rules={"schema_version": 2, "entry_rules": [], "risk_rules": [], "exit_rules": []})}, "NO_RULES"),
    ({"assignment": assigned(rules=document(descriptive=True))}, "NO_EXECUTION_ELIGIBLE_RULES"),
])
def test_unknown_small_or_conflicting_evidence_is_inconclusive(options, reason):
    result = diagnosis(cohort(**options))
    assert result.classification == "INCONCLUSIVE"
    assert any(reason in code for code in result.reasons)


def test_low_rule_coverage_is_not_execution_drag():
    facts = cohort(5) + tuple(fact(row(i, entry_price=None), assigned()) for i in range(6, 16))
    result = diagnosis(facts)
    assert result.classification == "INCONCLUSIVE" and "LOW_RULE_COVERAGE" in result.reasons
    summary = result.execution_rule_evidence.summary
    assert (summary.followed_rules, summary.violated_rules, summary.not_evaluable_rules) == (5, 0, 10)
    assert summary.adherence_pct == "100"
    assert float(summary.coverage_pct) == pytest.approx(100 / 3)


def _outcome_rules(metric_id, expected):
    return categorized_document(
        entry=[evaluator_rule("entry-process", "execution.entry_deviation_r", "lte", .1)],
        exit=[evaluator_rule("outcome", metric_id, "gte", expected)],
    )


def _rule_by_id(facts, identifier):
    return next(rule for rule in facts[0].rules if rule.rule_id == identifier)


def test_realized_r_outcome_rule_does_not_change_execution_diagnosis():
    rules = _outcome_rules("execution.realized_r", 1)
    followed = cohort(5, assignment=assigned(rules=rules), r_multiple=2)
    violated = cohort(5, assignment=assigned(rules=rules), r_multiple=.5)
    first, second = diagnosis(followed), diagnosis(violated)
    assert _rule_by_id(followed, "outcome").status.value == "FOLLOWED"
    assert _rule_by_id(violated, "outcome").status.value == "VIOLATED"
    assert first.execution_rule_evidence.model_dump() == second.execution_rule_evidence.model_dump()
    assert first.classification == second.classification == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"
    assert first.strategy_evidence[0].groups[0].value == 2
    assert second.strategy_evidence[0].groups[0].value == .5
    # General PR2B evidence still includes, and truthfully reports, the outcome rule.
    first_global = core.build_review(ReviewContext(followed, ()), request()).execution.rule_and_holding_metrics
    second_global = core.build_review(ReviewContext(violated, ()), request()).execution.rule_and_holding_metrics
    assert next(item for item in first_global if item.metric.id == "adherence_pct").groups[0].value == "100"
    assert next(item for item in second_global if item.metric.id == "adherence_pct").groups[0].value == "50"


def test_price_return_outcome_rule_does_not_change_execution_diagnosis():
    rules = _outcome_rules("execution.price_return_pct", 3)
    followed = cohort(5, assignment=assigned(rules=rules), exit_price=104)
    violated = cohort(5, assignment=assigned(rules=rules), exit_price=102)
    first, second = diagnosis(followed), diagnosis(violated)
    assert _rule_by_id(followed, "outcome").status.value == "FOLLOWED"
    assert _rule_by_id(violated, "outcome").status.value == "VIOLATED"
    assert first.execution_rule_evidence.model_dump() == second.execution_rule_evidence.model_dump()
    assert first.classification == second.classification == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"


def test_execution_process_rule_changes_execution_quality_while_outcomes_do_not():
    rules = _outcome_rules("execution.realized_r", 1)
    healthy = diagnosis(cohort(5, assignment=assigned(rules=rules), entry_price=100, r_multiple=.5))
    drag = diagnosis(cohort(5, assignment=assigned(rules=rules), entry_price=101, r_multiple=.5))
    assert healthy.execution_rule_evidence.summary.adherence_pct == "100"
    assert drag.execution_rule_evidence.summary.adherence_pct == "0"
    assert healthy.classification == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"
    assert drag.classification == "STRATEGY_POSITIVE_EXECUTION_DRAG"


def test_outcome_context_and_psychology_rules_are_excluded_from_execution_denominators():
    rules = categorized_document(
        entry=[
            evaluator_rule("process", "execution.entry_deviation_r", "lte", .1),
            evaluator_rule("direction", "trade.direction", "eq", "Long"),
            evaluator_rule("fomo", "journal.fomo", "eq", False),
        ],
        risk=[evaluator_rule("stop", "plan.stop_distance_pct", "lte", 5)],
        exit=[
            evaluator_rule("return", "execution.price_return_pct", "gte", 1),
            evaluator_rule("realized", "execution.realized_r", "gte", 1),
        ],
    )
    evidence = diagnosis(cohort(5, assignment=assigned(rules=rules))).execution_rule_evidence
    assert (evidence.total_rule_count, evidence.execution_eligible_rule_count, evidence.excluded_rule_count) == (30, 5, 25)
    assert evidence.summary.total_rules == evidence.summary.evaluable_rules == evidence.execution_evaluable_rule_count == 5
    assert evidence.summary.coverage_pct == evidence.summary.adherence_pct == "100"
    assert evidence.excluded_rule_counts_by_role == {"CONTEXT": 5, "NOT_DIAGNOSTIC": 5, "OUTCOME": 10, "PSYCHOLOGY": 5}


def test_no_eligible_or_no_evaluable_execution_rules_are_inconclusive():
    outcome_only = categorized_document(exit=[evaluator_rule("outcome", "execution.realized_r", "gte", 1)])
    no_eligible = diagnosis(cohort(5, assignment=assigned(rules=outcome_only)))
    assert no_eligible.classification == "INCONCLUSIVE"
    assert "NO_EXECUTION_ELIGIBLE_RULES" in no_eligible.reasons
    assert no_eligible.execution_rule_evidence.execution_eligible_rule_count == 0
    no_evaluable = diagnosis(cohort(5, entry_price=None))
    assert no_evaluable.classification == "INCONCLUSIVE"
    assert "NO_EVALUABLE_EXECUTION_RULES" in no_evaluable.reasons
    assert no_evaluable.execution_rule_evidence.execution_evaluable_rule_count == 0


@pytest.mark.parametrize("good_count,expected", [(7, "INCONCLUSIVE"), (8, "STRATEGY_POSITIVE_EXECUTION_HEALTHY"), (9, "STRATEGY_POSITIVE_EXECUTION_HEALTHY")])
def test_execution_evidence_availability_threshold_is_inclusive(good_count, expected):
    rules = assigned()
    facts = cohort(good_count, assignment=rules) + tuple(
        fact(row(identifier, entry_price=None), rules) for identifier in range(good_count + 1, 11)
    )
    result = diagnosis(facts)
    evidence = result.execution_rule_evidence
    assert (evidence.execution_evaluable_rule_count, evidence.execution_eligible_rule_count) == (good_count, 10)
    assert result.entry_deviation.evaluable_sample == good_count
    assert result.classification == expected
    assert ("LOW_RULE_COVERAGE" in result.reasons) is (good_count < 8)


@pytest.mark.parametrize("actual_entry,within,expected", [
    (10.9, True, "STRATEGY_POSITIVE_EXECUTION_HEALTHY"),
    (11, True, "STRATEGY_POSITIVE_EXECUTION_HEALTHY"),
    (11.1, False, "STRATEGY_POSITIVE_EXECUTION_DRAG"),
])
def test_entry_deviation_threshold_is_exact_and_inclusive(actual_entry, within, expected):
    revision = {"entry_price": 10, "stop_loss": 1, "take_profit": 20}
    result = diagnosis(cohort(5, entry_price=actual_entry, plan_revision=revision))
    assert result.entry_deviation.within_entry_limit_sample == (5 if within else 0)
    assert result.execution_rule_evidence.summary.adherence_pct == ("100" if within else "0")
    assert result.classification == expected


@pytest.mark.parametrize("good_count,expected", [(7, "STRATEGY_POSITIVE_EXECUTION_DRAG"), (8, "STRATEGY_POSITIVE_EXECUTION_HEALTHY"), (9, "STRATEGY_POSITIVE_EXECUTION_HEALTHY")])
def test_execution_adherence_threshold_is_inclusive(good_count, expected):
    facts = cohort(good_count) + tuple(fact(row(identifier, entry_price=101), assigned()) for identifier in range(good_count + 1, 11))
    result = diagnosis(facts)
    assert result.execution_rule_evidence.summary.adherence_pct == str(good_count * 10)
    assert result.classification == expected


def test_strategy_axis_can_change_without_outcome_contaminating_execution_axis():
    rules = _outcome_rules("execution.realized_r", 1)
    positive = diagnosis(cohort(5, assignment=assigned(rules=rules), r_multiple=2, realized_pnl=20))
    weak = diagnosis(cohort(5, assignment=assigned(rules=rules), r_multiple=-.5, realized_pnl=-20))
    assert positive.execution_rule_evidence.model_dump() == weak.execution_rule_evidence.model_dump()
    assert positive.classification == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"
    assert weak.classification == "STRATEGY_WEAK_EXECUTION_HEALTHY"


def test_followed_violated_unknown_denominators_are_pr2b_exact():
    facts = tuple(fact(row(i + 1, fomo=value), assigned(rules=fomo_document())) for i, value in enumerate([False, True, None]))
    data = core.build_review(ReviewContext(facts, ()), request())
    metrics = {item.metric.id: item.groups[0] for item in data.execution.rule_and_holding_metrics}
    assert metrics["adherence_pct"].value == "50"
    assert float(metrics["coverage_pct"].value) == pytest.approx(200 / 3)
    assert metrics["not_evaluable_count"].value == 1
    assert metrics["violated_count"].value == 1


def test_exact_version_identity_and_unassigned_not_setup_inference():
    facts = (fact(row(1), assigned(10)), fact(row(2), assigned(11)), fact(row(3)))
    result = core.diagnose(facts, request())
    assert {item.identity.strategy_version_id for item in result.diagnoses} == {10, 11, None}
    unassigned = next(item for item in result.diagnoses if item.identity.state == "UNASSIGNED")
    assert unassigned.classification == "INCONCLUSIVE" and "NO_ASSIGNED_STRATEGY_VERSION" in unassigned.reasons


def test_pattern_baseline_delta_samples_and_order():
    facts = cohort(5, fomo=False, r_multiple=2) + tuple(fact(row(i, fomo=True, r_multiple=-1), assigned()) for i in range(6, 11))
    query = request(pattern_dimensions=["fomo"], pattern_metrics=["average_r"])
    result = core.detect_patterns(facts, query)
    assert result.eligible_count == 2
    first, second = result.candidates
    assert first.observed.identity.label == "FALSE" and second.observed.identity.label == "TRUE"
    assert first.observed.value == 2 and second.observed.value == -1
    assert first.baseline.value == second.baseline.value == .5
    assert (first.signed_delta, second.signed_delta) == ("1.5", "-1.5")
    assert first.absolute_delta == second.absolute_delta == "1.5"
    assert (first.observed.total_sample, first.observed.evaluable_sample, first.observed.unavailable_sample) == (5, 5, 0)
    assert first.baseline.total_sample == 10 and first.evaluable_trade_sample == 5
    assert core.detect_patterns(tuple(reversed(facts)), query).model_dump() == result.model_dump()
    assert "confidence" not in result.candidates[0].model_dump()


def test_small_and_missing_patterns_visible_not_zero():
    facts = (fact(row(1, fomo=True, r_multiple=None)), fact(row(2, fomo=False, r_multiple=1)))
    result = core.detect_patterns(facts, request(pattern_dimensions=["fomo"], pattern_metrics=["average_r"]))
    assert len(result.candidates) == result.insufficient_count == 2
    missing = next(item for item in result.candidates if item.observed.identity.label == "TRUE")
    assert missing.observed.value is missing.signed_delta is missing.absolute_delta is None
    assert missing.observed.unavailable_sample == 1 and "SEGMENT_METRIC_UNAVAILABLE" in missing.reasons
    assert "SEGMENT_SMALL_SAMPLE" in missing.reasons


def test_many_rules_on_one_evaluable_trade_do_not_manufacture_sample():
    rules = fomo_document()
    rules["entry_rules"] = [{**rules["entry_rules"][0], "id": f"r-{i}"} for i in range(10)]
    facts = tuple(fact(row(i, fomo=False if i == 1 else None), assigned(rules=rules)) for i in range(1, 6))
    result = core.detect_patterns(facts, request(pattern_dimensions=["strategy_version"], pattern_metrics=["adherence_pct"]))
    candidate = result.candidates[0]
    assert candidate.observed.evaluable_sample == 10 and candidate.evaluable_trade_sample == 1
    assert candidate.status == "INSUFFICIENT_EVIDENCE"
    assert "SEGMENT_INSUFFICIENT_EVALUABLE_TRADES" in candidate.reasons
    assert diagnosis(facts).classification == "INCONCLUSIVE"


@pytest.mark.parametrize("field,values,states", [
    ("fomo", [False, None, "false"], {"FALSE", "UNRECORDED", "INVALID"}),
    ("revenge_trade", [False, None, 0], {"FALSE", "UNRECORDED", "INVALID"}),
    ("confidence_score", [1, None, 0, 6], {"1", "UNRECORDED", "INVALID"}),
    ("focus_score", [5, None, True], {"5", "UNRECORDED", "INVALID"}),
])
def test_psychology_states_never_coerced(field, values, states):
    facts = tuple(fact(row(i, **{field: value}), assigned()) for i, value in enumerate(values, 1))
    result = core.build_review(ReviewContext(facts, ()), request())
    groups = next(item for item in result.psychology if item.dimension.id == field and item.metric.id == "trade_count").groups
    assert {item.identity.label for item in groups} == states
    evidence = next(item for item in result.evidence_quality.observations if item.metric == f"journal.{field}")
    assert evidence.evaluable_sample == 1 and evidence.unavailable_sample == len(values) - 1
    if field in {"fomo", "revenge_trade"}:
        assert evidence.false_sample == 1 and evidence.true_sample == 0


def test_empty_review_has_all_sections_and_explicit_unavailability():
    data = core.build_review(ReviewContext((), ()), request())
    assert data.state == data.patterns.state == data.strategy_execution.state == "EMPTY_PERIOD"
    assert data.patterns.candidates == data.strategy_execution.diagnoses == []
    assert data.performance[0].groups[0].value == 0
    assert next(item for item in data.performance if item.metric.id == "average_r").groups[0].value is None
    assert data.evidence_quality.selected_trade_count == 0 and data.period_comparison.state == "NOT_REQUESTED"
    assert all(item.evaluable_sample == 0 for item in data.execution.market_dependent)
    assert {"performance", "strategy", "execution", "psychology", "patterns", "evidence_quality"}.issubset(data.model_dump())


def test_market_evidence_concepts_remain_separate_without_fake_formulas():
    data = core.build_review(ReviewContext(cohort(), ()), request())
    metrics = {item.metric: item for item in data.execution.market_dependent}
    assert set(metrics) == {"mfe_pct", "mae_pct", "mfe_capture_efficiency", "plan_exit_adherence", "post_exit_opportunity"}
    for item in metrics.values():
        assert item.unavailable_sample == 5 and item.unavailable_reason == "MARKET_PATH_NOT_IN_SNAPSHOT"
    assert "COUNTERFACTUAL_SIMULATION" not in data.model_dump_json()
    assert "ESTIMATED_OPPORTUNITY_COST" not in data.model_dump_json()


def test_all_aggregations_match_pr2c_direct_results():
    facts, query = cohort(), request()
    data = core.build_review(ReviewContext(facts, ()), query)
    for item in data.performance + data.strategy + data.psychology + data.execution.rule_and_holding_metrics:
        expected = analyze(list(facts), AnalyticsQuery(metric=item.metric.id, dimension=item.dimension.id, filters=query.filters))
        assert item.model_dump() == expected.model_dump()


def test_period_comparison_equal_length_inclusive_boundary_and_delta():
    query = request(compare_previous=True)
    current = cohort()
    previous = tuple(fact(row(i + 20, datetime="2025-12-31T23:59:59.999Z", r_multiple=-1), assigned()) for i in range(5))
    data = core.build_review(ReviewContext(current, previous), query).period_comparison
    assert data.state == "AVAILABLE"
    assert (data.filters.start_time, data.filters.end_time) == (START - DAY, START - 1)
    result = next(item for item in data.metrics if item.metric == "average_r")
    assert result.current.value == 2 and result.comparison.value == -1 and result.signed_delta == "3"
    assert result.current.evaluable_sample == result.comparison.evaluable_sample == 5


def test_empty_comparison_preserves_missing_metric():
    data = core.build_review(ReviewContext(cohort(), ()), request(compare_previous=True)).period_comparison
    assert data.state == "INSUFFICIENT_EVIDENCE"
    item = next(item for item in data.metrics if item.metric == "average_r")
    assert item.comparison.value is item.signed_delta is None and item.unavailable_reason == "METRIC_UNAVAILABLE"


def test_precision_repetition_input_immutability_and_json_safety():
    facts = cohort(r_multiple=0.00000001)
    query = request(compare_previous=True)
    original, request_original = deepcopy(facts), query.model_dump()
    outputs = []
    for precision in (6, 12, 28, 50):
        with localcontext() as caller:
            caller.prec = precision
            before = (caller.prec, caller.rounding, caller.Emin, caller.Emax, dict(caller.flags), dict(caller.traps))
            result = core.build_review(ReviewContext(facts, ()), query)
            assert core.build_review(ReviewContext(facts, ()), query).model_dump() == result.model_dump()
            outputs.append(result.model_dump())
            assert (caller.prec, caller.rounding, caller.Emin, caller.Emax, dict(caller.flags), dict(caller.traps)) == before
            json.dumps(result.model_dump(mode="json"), allow_nan=False)
    assert all(output == outputs[0] for output in outputs)
    assert facts == original and query.model_dump() == request_original


@pytest.mark.parametrize("value", [1e-8, -1e-9, 1e300, -1e300])
def test_delta_preserves_small_large_and_negative_numbers(value):
    for precision in (6, 50):
        with localcontext() as caller:
            caller.prec = precision
            assert core.numeric(core.delta(value, 0)) == core.numeric(value)


def test_policy_threshold_edges_are_explicit():
    policy = ReviewPolicy()
    assert policy.minimum_trade_sample == 5 and policy.entry_deviation_limit_r == .1
    facts = cohort(4) + (fact(row(5, fomo=True, entry_price=101), assigned()),)
    assert diagnosis(facts).classification == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"  # exactly 80% in both signals
    facts = cohort(5) + tuple(fact(row(i, fomo=True, entry_price=101), assigned()) for i in range(6, 8))
    assert diagnosis(facts).classification == "STRATEGY_POSITIVE_EXECUTION_DRAG"


@pytest.fixture
def db(monkeypatch, tmp_path):
    path = tmp_path / "review.db"
    monkeypatch.setattr(journal, "JOURNAL_DB_PATH", path)
    monkeypatch.setattr(journal, "JOURNAL_CSV_PATH", tmp_path / "absent.csv")
    journal.INITIALIZED_DATABASES.clear()
    assignments.initialize_schema(db_path=path)
    yield path
    journal.INITIALIZED_DATABASES.clear()


def save(db, identifier=1, **changes):
    entry = row(identifier, **changes)
    entry.pop("id")
    record, created = journal.add_entry_if_new_external_id(entry, db_path=db)
    assert created
    return record


def save_strategy(db, name="Strategy", rules=None):
    return strategies.create_strategy(name=name, name_key=name.casefold(), description=None, version_label="v1",
                                      version_label_key="v1", version_description=None, rules=rules or document(), db_path=db)


def save_plan(db, entry, monkeypatch):
    monkeypatch.setattr(plans, "utc_now", lambda: "2026-01-01T09:00:00Z")
    plan = plans.create_plan({"exchange": "binance", "symbol": entry["symbol"], "side": "Long",
                              "revision": {"entry_price": 100, "stop_loss": 98, "take_profit": 105}}, db_path=db)
    return plans.link_plan(plan["id"], entry["id"], db_path=db)


@pytest.mark.parametrize("endpoint", ["trading", "patterns", "strategy-execution"])
def test_api_typed_deterministic_json_and_empty_period(db, endpoint):
    with TestClient(app) as client:
        payload = request().model_dump(mode="json")
        first = client.post(f"/api/review/{endpoint}", json=payload)
        second = client.post(f"/api/review/{endpoint}", json=payload)
    assert first.status_code == 200 and first.json() == second.json()
    assert first.json()["success"] is True and first.json()["data"]["state"] == "EMPTY_PERIOD"
    json.dumps(first.json(), allow_nan=False)


@pytest.mark.parametrize("change", [
    {"pattern_dimensions": ["all"]}, {"pattern_dimensions": ["fomo", "fomo"]},
    {"pattern_dimensions": [["fomo", "symbol"]]}, {"pattern_dimensions": []},
    {"pattern_metrics": ["confidence_score"]}, {"sql": "SELECT 1"}, {"compare_previous": "true"},
    {"filters": {"start_time": START + 1, "end_time": START}},
    {"filters": {"start_time": True, "end_time": START}},
    {"filters": {"start_time": START, "end_time": START + DAY, "rule_statuses": ["VIOLATED"]}},
    {"filters": {"start_time": START, "end_time": START + DAY, "symbols": [f"s{i}" for i in range(51)]}},
    {"filters": {"start_time": 1, "end_time": 2}, "compare_previous": True},
])
def test_api_rejects_invalid_or_unbounded_inputs(db, change):
    with TestClient(app) as client:
        response = client.post("/api/review/trading", json={**request().model_dump(), **change})
    assert response.status_code == 422


@pytest.mark.parametrize("endpoint", ["patterns", "strategy-execution"])
def test_comparison_not_silently_ignored_by_current_only_endpoints(db, endpoint):
    with TestClient(app) as client:
        response = client.post(f"/api/review/{endpoint}", json=request(compare_previous=True).model_dump())
    assert response.status_code == 422


def test_db_filters_and_inclusive_period_edges_use_single_population(db):
    for i, timestamp in enumerate(["2025-12-30T23:59:59.999Z", "2025-12-31T00:00:00Z",
                                   "2025-12-31T23:59:59.999Z", "2026-01-01T00:00:00Z",
                                   "2026-01-01T23:59:59.999Z", "2026-01-02T00:00:00Z"], 1):
        save(db, i, datetime=timestamp)
    loaded = load_context(request(compare_previous=True), db_path=db)
    assert [fact.entry["id"] for fact in loaded.current] == [4, 5]
    assert [fact.entry["id"] for fact in loaded.previous] == [2, 3]
    filtered = request().model_copy(update={"filters": request().filters.model_copy(update={"symbols": ["ETH/USDT"]})})
    assert service.trading_review(filtered, db_path=db).data.state == "EMPTY_PERIOD"


def test_unassigned_plan_evidence_is_loaded_without_strategy_inference(db, monkeypatch):
    entry = save(db)
    save_plan(db, entry, monkeypatch)
    result = service.trading_review(request(), db_path=db).data
    entry_evidence = next(item for item in result.execution.observations if item.metric == "execution.entry_deviation_r")
    assert entry_evidence.evaluable_sample == entry_evidence.within_entry_limit_sample == 1
    assert result.evidence_quality.unassigned_trade_count == 1
    assert result.strategy_execution.diagnoses[0].identity.state == "UNASSIGNED"


def test_archived_retired_version_still_authoritative_and_filters_exact(db):
    entry = save(db)
    strategy = save_strategy(db)
    old_id = strategy["active_version_id"]
    assignments.put_assignment(entry["id"], old_id, db_path=db)
    version = strategies.create_version(strategy["id"], version_label="v2", version_label_key="v2", description=None,
                                        rules=document(expected=True), db_path=db)
    strategies.activate_version(strategy["id"], version["id"], db_path=db)
    strategies.retire_version(strategy["id"], old_id, db_path=db)
    strategies.set_strategy_archived(strategy["id"], True, db_path=db)
    result = service.strategy_execution_review(request(), db_path=db).data.diagnoses[0]
    assert result.identity.strategy_version_id == old_id
    assert result.execution_rule_evidence.execution_eligible_rule_count == 1
    filtered = request().model_copy(update={"filters": request().filters.model_copy(update={"strategy_version_ids": [version["id"]]})})
    assert service.strategy_execution_review(filtered, db_path=db).data.state == "EMPTY_PERIOD"


def test_one_request_snapshot_remains_coherent_across_journal_assignment_plan_mutation(db, monkeypatch):
    entry = save(db)
    old, new = save_strategy(db, "Old"), save_strategy(db, "New", document(expected=True))
    assignments.put_assignment(entry["id"], old["active_version_id"], db_path=db)
    plan = save_plan(db, entry, monkeypatch)
    read, resume = Event(), Event()
    original = snapshots._read_journal

    def paused(conn):
        values = original(conn)
        read.set()
        assert resume.wait(15)
        return values

    with monkeypatch.context() as patch, ThreadPoolExecutor(max_workers=1) as pool:
        patch.setattr(snapshots, "_read_journal", paused)
        future = pool.submit(service.trading_review, request(), db_path=db)
        assert read.wait(15)
        try:
            with sqlite3.connect(db) as writer:
                writer.execute("UPDATE journal_entries SET fomo=1, r_multiple=-2 WHERE id=?", (entry["id"],))
                writer.execute("UPDATE journal_strategy_assignments SET strategy_version_id=? WHERE journal_entry_id=?", (new["active_version_id"], entry["id"]))
                writer.execute("UPDATE trading_plan_revisions SET entry_price=102, stop_loss=90 WHERE plan_id=?", (plan["id"],))
        finally:
            resume.set()
        before = future.result(timeout=20).data
    after = service.trading_review(request(), db_path=db).data
    old_diagnosis, new_diagnosis = before.strategy_execution.diagnoses[0], after.strategy_execution.diagnoses[0]
    assert old_diagnosis.identity.strategy_version_id == old["active_version_id"]
    assert new_diagnosis.identity.strategy_version_id == new["active_version_id"]
    assert old_diagnosis.strategy_evidence[0].groups[0].value == 2
    assert new_diagnosis.strategy_evidence[0].groups[0].value == -2
    assert old_diagnosis.entry_deviation.within_entry_limit_sample == 1
    assert new_diagnosis.entry_deviation.outside_entry_limit_sample == 1
    old_psych = next(data for data in before.psychology if data.dimension.id == "fomo" and data.metric.id == "trade_count")
    new_psych = next(data for data in after.psychology if data.dimension.id == "fomo" and data.metric.id == "trade_count")
    assert old_psych.groups[0].identity.label == "FALSE" and new_psych.groups[0].identity.label == "TRUE"
    assert {c.observed.identity.strategy_version_id for c in before.patterns.candidates if c.dimension == "strategy_version"} == {old["active_version_id"]}
    assert old_diagnosis.execution_rule_evidence.summary.adherence_pct == "100"
    assert new_diagnosis.execution_rule_evidence.summary.adherence_pct == "0"


def test_snapshot_queries_constant_readonly_and_no_per_pattern_loading(db, monkeypatch):
    statements, connects = [], []
    real_connect = sqlite3.connect

    def traced(*args, **kwargs):
        connects.append(args)
        conn = real_connect(*args, **kwargs)
        conn.set_trace_callback(statements.append)
        return conn

    entry = save(db)
    save_plan(db, entry, monkeypatch)
    counts = []
    for size in (1, 10):
        if size == 10:
            for i in range(2, 11):
                save(db, i)
        statements.clear()
        connects.clear()
        with monkeypatch.context() as patch:
            patch.setattr(snapshots.sqlite3, "connect", traced)
            service.trading_review(request(compare_previous=True), db_path=db)
        assert len(connects) == 1
        assert all(sql.lstrip().upper().startswith(("SELECT", "BEGIN", "PRAGMA QUERY_ONLY")) for sql in statements)
        counts.append(sum(sql.lstrip().upper().startswith("SELECT") for sql in statements))
    assert counts == [5, 5]


@pytest.mark.parametrize("constant,value", [("MAX_REVIEW_TRADES", 0), ("MAX_RULE_RESULTS", 0), ("MAX_VERSION_GROUPS", 0), ("MAX_MEMBERSHIPS", 0)])
def test_work_limits_fail_explicitly_not_truncate(db, monkeypatch, constant, value):
    entry, strategy = save(db), save_strategy(db)
    assignments.put_assignment(entry["id"], strategy["active_version_id"], db_path=db)
    monkeypatch.setattr(context, constant, value)
    with pytest.raises(APIValidationError):
        service.trading_review(request(), db_path=db)


def test_candidate_bound_is_explicit_and_scope_one_dimensional(monkeypatch):
    assert set(DIMENSIONS) == {"strategy", "strategy_version", "setup", "confidence_score", "focus_score", "fomo",
                               "revenge_trade", "symbol", "direction", "rule", "rule_status", "weekday", "hour"}
    monkeypatch.setattr(core, "MAX_CANDIDATES", 1)
    with pytest.raises(APIValidationError):
        core.detect_patterns(cohort(), request())


def test_current_request_has_no_db_or_filesystem_side_effect_for_absent_db(tmp_path):
    path = tmp_path / "absent.db"
    assert service.trading_review(request(), db_path=path).data.state == "EMPTY_PERIOD"
    assert not path.exists()


@pytest.mark.parametrize("endpoint", ["trading", "patterns", "strategy-execution"])
def test_populated_api_preserves_json_contract_and_historical_unknowns(db, monkeypatch, endpoint):
    strategy = save_strategy(db)
    for i in range(1, 6):
        entry = save(db, i, r_multiple=1e-8)
        assignments.put_assignment(entry["id"], strategy["active_version_id"], db_path=db)
        save_plan(db, entry, monkeypatch)
    with TestClient(app) as client:
        first = client.post(f"/api/review/{endpoint}", json=request().model_dump())
        second = client.post(f"/api/review/{endpoint}", json=request().model_dump())
    assert first.status_code == 200 and first.json() == second.json()
    assert first.json()["data"]["state"] == "AVAILABLE"
    json.dumps(first.json(), allow_nan=False)
    if endpoint == "strategy-execution":
        assert first.json()["data"]["diagnoses"][0]["classification"] == "STRATEGY_POSITIVE_EXECUTION_HEALTHY"


def test_invalid_historical_dates_isolate_missing_plan_from_r_outcomes(db):
    save(db, 1, entry_datetime="NaT", r_multiple=3)
    save(db, 2, datetime=None)
    data = service.trading_review(request(), db_path=db).data
    assert data.evidence_quality.selected_trade_count == 1
    assert data.evidence_quality.excluded_close_time_count_all_stored_positions == 1
    assert next(item for item in data.performance if item.metric.id == "average_r").groups[0].value == 3
    assert next(item for item in data.execution.observations if item.metric == "execution.entry_deviation_r").evaluable_sample == 0


def test_numeric_overflow_stays_null_not_json_infinity():
    facts = cohort(r_multiple=1e308, realized_pnl=1e308)
    result = core.build_review(ReviewContext(facts, ()), request())
    json.dumps(result.model_dump(mode="json"), allow_nan=False)
    assert next(item for item in result.performance if item.metric.id == "average_r").groups[0].unavailable_reason == "NUMERIC_OVERFLOW"
    assert result.strategy_execution.diagnoses[0].classification == "INCONCLUSIVE"


def test_close_utc_weekday_hour_and_overlapping_setup_memberships():
    facts = (fact(row(1, datetime="2026-01-01T20:00:00+09:00", setup_tags=["b", "a", "a"]), assigned()),)
    result = core.detect_patterns(facts, request(pattern_dimensions=["setup", "hour", "weekday"], pattern_metrics=["average_r"]))
    identities = {(item.dimension, item.observed.identity.label) for item in result.candidates}
    assert identities == {("setup", "a"), ("setup", "b"), ("hour", "11"), ("weekday", "3")}
    assert all(item.observed.trade_sample == item.baseline.trade_sample == 1 for item in result.candidates)


def test_pattern_limit_is_reported_as_422_api(db, monkeypatch):
    save(db)
    monkeypatch.setattr(core, "MAX_CANDIDATES", 0)
    with TestClient(app) as client:
        response = client.post("/api/review/patterns", json=request().model_dump())
    assert response.status_code == 422


def test_plan_recorded_false_means_no_eligible_record_not_actual_absence():
    facts = cohort(plan=False)
    result = core.build_review(ReviewContext(facts, ()), request())
    plan = next(item for item in result.execution.observations if item.metric == "plan.recorded_before_entry")
    assert plan.false_sample == plan.evaluable_sample == 5
    assert result.strategy_execution.diagnoses[0].classification == "INCONCLUSIVE"


def test_context_extracts_and_evaluates_once_per_trade(db, monkeypatch):
    strategy = save_strategy(db)
    for i in range(1, 6):
        entry = save(db, i)
        assignments.put_assignment(entry["id"], strategy["active_version_id"], db_path=db)
    calls = {"extract": 0, "evaluate": 0}
    original_extract, original_evaluate = context.extract_metric_observations, context._evaluate_document

    def extract(*args, **kwargs):
        calls["extract"] += 1
        return original_extract(*args, **kwargs)

    def evaluate(*args, **kwargs):
        calls["evaluate"] += 1
        return original_evaluate(*args, **kwargs)

    monkeypatch.setattr(context, "extract_metric_observations", extract)
    monkeypatch.setattr(context, "_evaluate_document", evaluate)
    service.trading_review(request(), db_path=db)
    assert calls == {"extract": 5, "evaluate": 5}
