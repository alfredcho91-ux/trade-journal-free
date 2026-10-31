"""Pure bounded search. Candidate selection finishes before holdout evaluation."""

from collections import Counter
from decimal import Decimal
from itertools import product

from backend.modules.analytics.core import TradeFacts, aggregate_group, close_timestamp
from backend.modules.analytics.schemas import GroupIdentity
from backend.modules.journal.trade_selection import timestamp_ms
from backend.modules.strategy_discovery import feature_policy as policy
from backend.modules.strategy_discovery.schemas import Candidate, Condition, RunSummary, Segment
from backend.utils.error_handler import ValidationError

IDENTITY = GroupIdentity(key="all", label="All selected trades", state="ALL")


def feature(fact, field):
    observation = fact.observations[f"trade.{field}"]
    return str(observation.value) if observation.available else None


def metrics(facts):
    result = {metric: aggregate_group(IDENTITY, facts, [], metric)
              for metric in policy.METRICS if metric != "profit_factor"}
    # Journal stores fee currency, not a verified PnL settlement currency.
    # Never infer a common PnL unit from fee_currency or aggregate it across markets.
    result["profit_factor"] = result["win_rate_pct"].model_copy(update={
        "value": None, "evaluable_sample": 0, "unavailable_sample": len(facts),
        "unavailable_reason": "PNL_CURRENCY_UNVERIFIED",
        "unavailable_reasons": {"PNL_CURRENCY_UNVERIFIED": len(facts)} if facts else {},
        "profit_factor_infinite": False,
    })
    return result


def sufficient(group):
    return (group.evaluable_sample >= policy.MIN_SAMPLE and group.total_sample > 0
            and group.evaluable_sample * 100 >= group.total_sample * policy.MIN_COVERAGE_PCT
            and group.value is not None)


def delta(group, baseline):
    if group.value is None or baseline.value is None:
        return None
    return str(Decimal(str(group.value)) - Decimal(str(baseline.value)))


def segment(facts, baseline, metric):
    values = metrics(facts)
    return Segment(sample=len(facts), metrics=values, baseline=baseline,
                   primary_delta=delta(values[metric], baseline[metric]),
                   trade_ids=[int(fact.entry["id"]) for fact in facts])


def rule_document(conditions):
    return {"schema_version": 2, "entry_rules": [
        {"id": f"discovery-{condition.field}", "text": f"{condition.field.title()} {condition.operator} {condition_label(condition)}",
         "evaluation": {"metric_id": f"trade.{condition.field}", "operator": condition.operator, "expected": condition.value}}
        for condition in conditions
    ], "risk_rules": [], "exit_rules": []}


def condition_label(condition):
    if isinstance(condition.value, str):
        return condition.value
    values = ", ".join(condition.value)
    return values if len(values) <= 80 else f"{len(condition.value)} selected {condition.field}s"


def scope_conditions(request):
    return [Condition(field=field, operator="eq" if len(values) == 1 else "in",
                      value=values[0] if len(values) == 1 else values)
            for field, values in (("symbol", request.symbols), ("direction", request.directions)) if values]


def effective_conditions(conditions, scope):
    # The discovery condition may narrow a scope, never silently widen it.
    by_field = {condition.field: condition for condition in scope}
    by_field.update({condition.field: condition for condition in conditions})
    return [by_field[field] for field in ("symbol", "direction") if field in by_field]


def analyze(facts: list[TradeFacts], request, *, unavailable_close_count=0):
    if len(facts) > policy.MAX_TRADES:
        raise ValidationError("Discovery trade limit exceeded; narrow the period or filters")
    if len({int(fact.entry["id"]) for fact in facts}) != len(facts):
        raise ValidationError("Discovery snapshot contains duplicate trades")
    scope = scope_conditions(request)
    facts = [fact for fact in facts if matches(fact, scope)]
    split = request.start_time + (request.end_time - request.start_time + 1) * policy.DISCOVERY_PCT // 100
    discovery, validation, excluded = [], [], Counter()
    if unavailable_close_count:
        excluded["MISSING_CLOSE_TIME_ALL_STORED_POSITIONS"] = unavailable_close_count
    for fact in sorted(facts, key=lambda item: (close_timestamp(item.entry) or 0, int(item.entry["id"]))):
        close = close_timestamp(fact.entry)
        entry = timestamp_ms(fact.entry.get("entry_datetime"))
        if close is None or entry is None or entry > close:
            excluded["INVALID_POSITION_TIME"] += 1
        elif entry < request.start_time:
            excluded["ENTRY_BEFORE_PERIOD"] += 1
        elif not request.start_time <= close <= request.end_time:
            excluded["CLOSE_OUTSIDE_PERIOD"] += 1
        elif close < split:
            discovery.append(fact)
        elif entry >= split:
            validation.append(fact)
        else:
            excluded["CROSSES_SPLIT"] += 1

    base_train, base_test = metrics(discovery), metrics(validation)
    primary = request.primary_metric
    # The search space is derived exclusively from discovery data.
    symbols = sorted({value for fact in discovery if (value := feature(fact, "symbol")) is not None})
    if len(symbols) > policy.MAX_SYMBOLS:
        raise ValidationError("Discovery symbol limit exceeded; narrow the filters")
    directions = sorted({value for fact in discovery if (value := feature(fact, "direction")) is not None})
    definitions = ([[Condition(field="symbol", value=symbol)] for symbol in symbols]
                   + [[Condition(field="direction", value=direction)] for direction in directions]
                   + [[Condition(field="symbol", value=symbol), Condition(field="direction", value=direction)]
                      for symbol, direction in product(symbols, directions)])
    shortlisted, memberships = [], set()
    for conditions in definitions:
        selected = [fact for fact in discovery if matches(fact, conditions)]
        ids = tuple(int(fact.entry["id"]) for fact in selected)
        if not ids or len(selected) == len(discovery) or ids in memberships:
            continue
        memberships.add(ids)
        observed = segment(selected, base_train, primary)
        if (not sufficient(observed.metrics[primary]) or not sufficient(base_train[primary])
                or Decimal(str(observed.metrics[primary].value)) <= 0
                or Decimal(observed.primary_delta or "0") <= 0):
            continue
        shortlisted.append((conditions, observed))
    # Stable discovery-only ranking. Even a missing/weak holdout keeps its rank.
    shortlisted.sort(key=lambda item: (-Decimal(item[1].primary_delta), -item[1].sample,
                                      tuple((c.field, c.value) for c in item[0])))
    candidates = []
    for rank, (conditions, observed) in enumerate(shortlisted[:policy.MAX_CANDIDATES], 1):
        conditions = effective_conditions(conditions, scope)
        held = segment([fact for fact in validation if matches(fact, conditions)], base_test, primary)
        reasons = ["RECORDED_TRADES_ONLY", "PNL_CURRENCY_UNVERIFIED", "RISK_AND_EXIT_RULES_NOT_GENERATED"]
        if not sufficient(held.metrics[primary]) or not sufficient(base_test[primary]):
            state = "INSUFFICIENT_EVIDENCE"
            reasons.append("HOLDOUT_SAMPLE_OR_COVERAGE_TOO_LOW")
        elif Decimal(str(held.metrics[primary].value)) > 0 and Decimal(held.primary_delta or "0") > 0:
            state = "CONSISTENT"
        else:
            state = "WEAKENED"
            reasons.append("HOLDOUT_UPLIFT_OR_POSITIVE_RESULT_NOT_REPEATED")
        candidates.append(Candidate(rank=rank, name=" · ".join(condition_label(c) for c in conditions),
                                    conditions=conditions, rules=rule_document(conditions), discovery=observed,
                                    validation=held, validation_state=state, reasons=reasons))
    summary = RunSummary(
        selected_trades=len(facts), discovery_trades=len(discovery), validation_trades=len(validation),
        excluded=dict(excluded), split_time=split, searched_conditions=len(definitions),
        shortlisted_candidates=len(shortlisted), candidate_count=len(candidates),
        state="AVAILABLE" if candidates else "NO_CANDIDATES" if sufficient(base_train[primary]) else "INSUFFICIENT_EVIDENCE",
        baseline_discovery=base_train, baseline_validation=base_test,
    )
    return summary, candidates


def matches(fact, conditions):
    return all(feature(fact, condition.field) == condition.value if condition.operator == "eq"
               else feature(fact, condition.field) in condition.value for condition in conditions)
