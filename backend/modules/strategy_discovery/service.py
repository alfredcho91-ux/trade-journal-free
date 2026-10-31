"""One immutable read snapshot, bounded CPU work, then one short result transaction."""

from threading import BoundedSemaphore

from backend.modules.analytics import repository as analytics
from backend.modules.analytics.core import TradeFacts
from backend.modules.analytics.schemas import AnalyticsFilters, AnalyticsQuery
from backend.modules.journal.closed_position_returns import closed_position_net_return_pct
from backend.modules.journal.trade_selection import finite_float
from backend.modules.rule_engine.extractors import extract_metric_observations
from backend.modules.rule_engine.models import Observation
from backend.modules.plan_lab.repository import normalize_symbol
from backend.modules.strategy_discovery import engine, feature_policy as policy, repository
from backend.modules.strategy_discovery.schemas import EvidencePage, EvidenceTrade
from backend.utils.error_handler import APIError, ValidationError

_analysis_slot = BoundedSemaphore(1)
ENTRY_FIELDS = ("id", "external_id", "source", "symbol", "direction", "entry_datetime", "datetime", "exchange")
NUMBER_FIELDS = ("realized_pnl", "invested_amount", "entry_price", "exit_price", "leverage", "fee", "funding_fee")
OBSERVATION_FIELDS = ("trade.symbol", "trade.direction", "execution.realized_r")


def freeze_snapshot(snapshot):
    """Only calculation inputs: never notes, API credentials or entire Plan documents."""
    if len(snapshot.entries) > policy.MAX_TRADES:
        raise ValidationError("Discovery trade limit exceeded; narrow the period or filters")
    rows = []
    for entry in sorted(snapshot.entries, key=lambda item: int(item["id"])):
        observations = extract_metric_observations(entry, linked_plan=snapshot.linked_plans.get(entry["id"]))
        rows.append({"entry": {**{field: entry.get(field) for field in ENTRY_FIELDS},
                               **{field: finite_float(entry.get(field)) for field in NUMBER_FIELDS}},
                     "assigned": int(entry["id"]) in snapshot.assignments,
                     "observations": {field: observations[field].model_dump(mode="json") for field in OBSERVATION_FIELDS}})
    return {"facts": rows, "excluded_unavailable_close_count": snapshot.excluded_unavailable_close_count}


def restore_facts(snapshot):
    return [TradeFacts(row["entry"], {} if row["assigned"] else None,
                       {key: Observation.model_validate(value) for key, value in row["observations"].items()})
            for row in snapshot["facts"]]


def create_run(request, key, *, db_path=None):
    request_hash = repository.fingerprint(request.model_dump(mode="json"))
    existing = repository.find_run(key, request_hash, db_path=db_path)
    if existing:
        return existing
    if not _analysis_slot.acquire(blocking=False):
        raise APIError("Another discovery analysis is running; retry shortly", error_code="DISCOVERY_BUSY", status_code=429)
    try:
        existing = repository.find_run(key, request_hash, db_path=db_path)
        if existing:
            return existing
        filters = AnalyticsFilters(start_time=request.start_time, end_time=request.end_time,
                                   directions=request.directions)
        source = analytics.load_snapshot(AnalyticsQuery(metric="trade_count", filters=filters), db_path=db_path,
                                         include_plans=True, include_unassigned_plans=True)
        if request.symbols is not None:
            source = analytics.AnalyticsSnapshot(
                [entry for entry in source.entries if normalize_symbol(entry.get("symbol")) in request.symbols],
                source.assignments, source.linked_plans, source.excluded_unavailable_close_count,
            )
        frozen = freeze_snapshot(source)
        summary, candidates = engine.analyze(restore_facts(frozen), request,
                                            unavailable_close_count=source.excluded_unavailable_close_count)
        return repository.save_run(key, request, frozen, summary, candidates, db_path=db_path)
    finally:
        _analysis_slot.release()


def evidence(identifier, offset=0, limit=50, *, db_path=None):
    frozen, candidate = repository.candidate_snapshot(identifier, db_path=db_path)
    partitions = {identifier: "DISCOVERY" for identifier in candidate.discovery.trade_ids}
    partitions.update({identifier: "VALIDATION" for identifier in candidate.validation.trade_ids})
    facts = [fact for fact in restore_facts(frozen) if int(fact.entry["id"]) in partitions]
    facts.sort(key=lambda fact: (str(fact.entry.get("datetime") or ""), int(fact.entry["id"])))
    items = []
    for fact in facts[offset:offset + limit]:
        entry = fact.entry
        recorded_r = fact.observations["execution.realized_r"]
        items.append(EvidenceTrade(journal_id=entry["id"], external_id=entry.get("external_id"),
            symbol=entry.get("symbol"), direction=entry.get("direction"), entry_datetime=entry.get("entry_datetime"),
            datetime=entry.get("datetime"), average_return_pct=closed_position_net_return_pct(entry),
            realized_r=str(recorded_r.value) if recorded_r.available else None, segment=partitions[entry["id"]]))
    return EvidencePage(items=items, offset=offset, has_more=offset + limit < len(facts))
