"""Deterministic Journal and Plan facts for the Phase 2 Rule Engine.

This module consumes an already-loaded journal entry and its already-resolved
linked Plan.  It deliberately performs no database lookup, Strategy assignment,
or rule evaluation orchestration.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from typing import Any, Dict, Mapping, Optional

from backend.modules.journal.trade_selection import timestamp_ms
from backend.modules.plan_lab.analysis import plan_geometry
from backend.modules.plan_lab.repository import annotate_revisions, normalize_symbol
from backend.modules.rule_engine.models import NotEvaluableReason, Observation
from backend.modules.rule_engine.numeric import canonical_numeric

JOURNAL_SOURCE = "journal_entry"
PLAN_SOURCE = "plan_revision"
PLAN_PROVENANCE_SOURCE = "plan_provenance"

SUPPORTED_METRIC_IDS = (
    "trade.direction",
    "trade.symbol",
    "journal.confidence_score",
    "journal.focus_score",
    "journal.fomo",
    "journal.revenge_trade",
    "plan.recorded_before_entry",
    "plan.stop_distance_pct",
    "plan.total_reward_risk_ratio",
    "plan.max_hold_hours",
    "execution.entry_deviation_r",
    "execution.holding_minutes",
    "execution.price_return_pct",
    "execution.realized_r",
)


@dataclass(frozen=True)
class _PlanResolution:
    revision: Optional[Mapping[str, Any]]
    reason: Optional[NotEvaluableReason]


def _record_id(value: Any) -> Optional[int | str]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _available(
    value: Any,
    *,
    source: str,
    record_id: Optional[int | str],
) -> Observation:
    return Observation(
        available=True,
        value=value,
        source=source,
        record_id=record_id,
    )


def _unavailable(reason: NotEvaluableReason) -> Observation:
    return Observation(available=False, reason_code=reason)


def _numeric(
    value: Any,
    *,
    source: str,
    record_id: Optional[int | str],
    invalid_reason: NotEvaluableReason = NotEvaluableReason.INVALID_HISTORICAL_DATA,
) -> Observation:
    try:
        canonical = canonical_numeric(value)
    except ValueError:
        return _unavailable(invalid_reason)
    return _available(canonical, source=source, record_id=record_id)


def _numeric_decimal(value: Any) -> Optional[Decimal]:
    try:
        return Decimal(canonical_numeric(value))
    except ValueError:
        return None


def _same_identifier(left: Any, right: Any) -> bool:
    left_id = _record_id(left)
    right_id = _record_id(right)
    return left_id is not None and right_id is not None and str(left_id) == str(right_id)


def _plan_is_linked_to_entry(
    entry: Mapping[str, Any], plan: Mapping[str, Any]
) -> bool:
    link = plan.get("link")
    if not isinstance(link, Mapping) or link.get("link_status") != "LINKED":
        return False
    if _same_identifier(link.get("journal_entry_id"), entry.get("id")):
        return True
    linked_external = str(link.get("journal_external_id") or "").strip()
    entry_external = str(entry.get("external_id") or "").strip()
    return bool(linked_external and entry_external and linked_external == entry_external)


def _resolve_pretrade_plan(
    entry: Mapping[str, Any], linked_plan: Optional[Mapping[str, Any]]
) -> _PlanResolution:
    if linked_plan is None or not isinstance(linked_plan, Mapping):
        return _PlanResolution(None, NotEvaluableReason.MISSING_PLAN)
    if not _plan_is_linked_to_entry(entry, linked_plan):
        return _PlanResolution(None, NotEvaluableReason.MISSING_PLAN)
    if linked_plan.get("source") != "VERIFIED_PRETRADE":
        return _PlanResolution(
            None, NotEvaluableReason.PLAN_NOT_EFFECTIVE_AT_ENTRY
        )
    if (
        linked_plan.get("side") != entry.get("direction")
        or normalize_symbol(linked_plan.get("symbol"))
        != normalize_symbol(entry.get("symbol"))
    ):
        return _PlanResolution(None, NotEvaluableReason.INVALID_PLAN)

    try:
        plan_copy = dict(linked_plan)
        revisions = linked_plan.get("revisions")
        if not isinstance(revisions, list) or not all(
            isinstance(item, Mapping) for item in revisions
        ):
            return _PlanResolution(None, NotEvaluableReason.INVALID_PLAN)
        plan_copy["revisions"] = [dict(item) for item in revisions]
        annotated = annotate_revisions(
            plan_copy,
            entry.get("entry_datetime"),
            entry.get("datetime"),
        )
    except (KeyError, TypeError, ValueError):
        return _PlanResolution(None, NotEvaluableReason.INVALID_PLAN)

    revision = annotated.get("plan_effective_at_entry")
    entry_ms = timestamp_ms(entry.get("entry_datetime"))
    received_ms = (
        timestamp_ms(revision.get("received_at"))
        if isinstance(revision, Mapping)
        else None
    )
    if (
        not isinstance(revision, Mapping)
        or entry_ms is None
        or received_ms is None
        or received_ms >= entry_ms
    ):
        return _PlanResolution(
            None, NotEvaluableReason.PLAN_NOT_EFFECTIVE_AT_ENTRY
        )
    return _PlanResolution(revision, None)


def _trade_direction(entry: Mapping[str, Any], record_id: Optional[int | str]) -> Observation:
    value = entry.get("direction")
    if value is None or value == "":
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    if value not in {"Long", "Short"}:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    return _available(value, source=JOURNAL_SOURCE, record_id=record_id)


def _trade_symbol(entry: Mapping[str, Any], record_id: Optional[int | str]) -> Observation:
    value = entry.get("symbol")
    if value is None or str(value).strip() == "":
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    normalized = normalize_symbol(value)
    if not normalized or len(normalized) > 80:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    return _available(normalized, source=JOURNAL_SOURCE, record_id=record_id)


def _score(entry: Mapping[str, Any], field: str, record_id: Optional[int | str]) -> Observation:
    value = entry.get(field)
    if value is None:
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    return _numeric(value, source=JOURNAL_SOURCE, record_id=record_id)


def _journal_flag(
    entry: Mapping[str, Any], field: str, record_id: Optional[int | str]
) -> Observation:
    value = entry.get(field)
    if value is None:
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    if type(value) is not bool:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    return _available(value, source=JOURNAL_SOURCE, record_id=record_id)


def _plan_recorded_before_entry(
    entry_record_id: Optional[int | str], resolution: _PlanResolution
) -> Observation:
    # False means only that this app has no qualifying verified record.  It is
    # not evidence that the trader had no plan outside the application.
    if resolution.revision is None:
        return _available(
            False,
            source=PLAN_PROVENANCE_SOURCE,
            record_id=entry_record_id,
        )
    return _available(
        True,
        source=PLAN_PROVENANCE_SOURCE,
        record_id=_record_id(resolution.revision.get("id")),
    )


def _plan_unavailable(resolution: _PlanResolution) -> Observation:
    return _unavailable(resolution.reason or NotEvaluableReason.MISSING_PLAN)


def _valid_geometry(
    linked_plan: Optional[Mapping[str, Any]],
    resolution: _PlanResolution,
) -> Optional[Dict[str, Any]]:
    if resolution.revision is None or linked_plan is None:
        return None
    try:
        geometry = plan_geometry(str(linked_plan.get("side") or ""), dict(resolution.revision))
    except (TypeError, ValueError, ZeroDivisionError, OverflowError):
        return None
    return geometry if geometry.get("valid") else None


def _plan_geometry_metric(
    key: str,
    resolution: _PlanResolution,
    geometry: Optional[Mapping[str, Any]],
) -> Observation:
    if resolution.revision is None:
        return _plan_unavailable(resolution)
    if geometry is None or geometry.get(key) is None:
        return _unavailable(NotEvaluableReason.INVALID_PLAN)
    return _numeric(
        geometry[key],
        source=PLAN_SOURCE,
        record_id=_record_id(resolution.revision.get("id")),
        invalid_reason=NotEvaluableReason.INVALID_PLAN,
    )


def _max_hold_hours(resolution: _PlanResolution) -> Observation:
    if resolution.revision is None:
        return _plan_unavailable(resolution)
    value = resolution.revision.get("max_hold_hours")
    if value is None:
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    decimal = _numeric_decimal(value)
    if decimal is None or decimal <= 0 or decimal > Decimal(24 * 30):
        return _unavailable(NotEvaluableReason.INVALID_PLAN)
    return _numeric(
        value,
        source=PLAN_SOURCE,
        record_id=_record_id(resolution.revision.get("id")),
        invalid_reason=NotEvaluableReason.INVALID_PLAN,
    )


def _entry_deviation_r(
    entry: Mapping[str, Any],
    linked_plan: Optional[Mapping[str, Any]],
    resolution: _PlanResolution,
) -> Observation:
    if resolution.revision is None:
        return _plan_unavailable(resolution)
    actual_decimal = _numeric_decimal(entry.get("entry_price"))
    if actual_decimal is None:
        reason = (
            NotEvaluableReason.MISSING_METRIC
            if entry.get("entry_price") is None
            else NotEvaluableReason.INVALID_HISTORICAL_DATA
        )
        return _unavailable(reason)
    if actual_decimal <= 0:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)

    try:
        execution_geometry = plan_geometry(
            str((linked_plan or {}).get("side") or ""),
            dict(resolution.revision),
            entry_override=float(actual_decimal),
        )
    except (TypeError, ValueError, ZeroDivisionError, OverflowError):
        return _unavailable(NotEvaluableReason.INVALID_PLAN)
    if not execution_geometry.get("valid"):
        return _unavailable(NotEvaluableReason.INVALID_PLAN)

    revision = resolution.revision
    exact = _numeric_decimal(revision.get("entry_price"))
    lower = _numeric_decimal(revision.get("entry_min"))
    upper = _numeric_decimal(revision.get("entry_max"))
    if lower is None or upper is None:
        lower = upper = exact
    risk = _numeric_decimal(execution_geometry.get("risk_distance"))
    if lower is None or upper is None or lower > upper or risk is None or risk <= 0:
        return _unavailable(NotEvaluableReason.INVALID_PLAN)

    actual_exact = Fraction(actual_decimal)
    lower_exact = Fraction(lower)
    upper_exact = Fraction(upper)
    risk_exact = Fraction(risk)
    if lower_exact <= actual_exact <= upper_exact:
        deviation = Fraction(0)
    else:
        deviation = min(
            abs(actual_exact - lower_exact), abs(actual_exact - upper_exact)
        )
    # Plan Lab's accepted definition is distance to the nearest planned entry
    # boundary divided by the actual-entry-to-planned-stop risk distance. Both source
    # values are current SQLite REALs, so the existing float calculation is the
    # canonical product convention and canonical_numeric removes binary noise.
    deviation_r = float(deviation / risk_exact)
    return _numeric(
        deviation_r,
        source=PLAN_SOURCE,
        record_id=_record_id(revision.get("id")),
        invalid_reason=NotEvaluableReason.INVALID_PLAN,
    )


def _closed_trade_reason(entry: Mapping[str, Any]) -> Optional[NotEvaluableReason]:
    close_value = entry.get("datetime")
    if close_value is None or close_value == "":
        return NotEvaluableReason.TRADE_NOT_CLOSED
    if timestamp_ms(close_value) is None:
        return NotEvaluableReason.INVALID_HISTORICAL_DATA
    return None


def _holding_minutes(entry: Mapping[str, Any], record_id: Optional[int | str]) -> Observation:
    closed_reason = _closed_trade_reason(entry)
    if closed_reason is not None:
        return _unavailable(closed_reason)
    entry_value = entry.get("entry_datetime")
    if entry_value is None or entry_value == "":
        return _unavailable(NotEvaluableReason.MISSING_METRIC)
    entry_ms = timestamp_ms(entry_value)
    exit_ms = timestamp_ms(entry.get("datetime"))
    if entry_ms is None or exit_ms is None or exit_ms < entry_ms:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    return _numeric(
        (exit_ms - entry_ms) / 60_000,
        source=JOURNAL_SOURCE,
        record_id=record_id,
    )


def _price_return_pct(entry: Mapping[str, Any], record_id: Optional[int | str]) -> Observation:
    closed_reason = _closed_trade_reason(entry)
    if closed_reason is not None:
        return _unavailable(closed_reason)
    direction = entry.get("direction")
    if direction not in {"Long", "Short"}:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    entry_price = _numeric_decimal(entry.get("entry_price"))
    exit_price = _numeric_decimal(entry.get("exit_price"))
    if entry_price is None or exit_price is None:
        reason = (
            NotEvaluableReason.MISSING_METRIC
            if entry.get("entry_price") is None or entry.get("exit_price") is None
            else NotEvaluableReason.INVALID_HISTORICAL_DATA
        )
        return _unavailable(reason)
    if entry_price <= 0 or exit_price <= 0:
        return _unavailable(NotEvaluableReason.INVALID_HISTORICAL_DATA)
    direction_sign = 1 if direction == "Long" else -1
    # This is the same direction-aware price-return convention used by current
    # Journal Performance and Plan Lab analysis.  It deliberately excludes fees.
    value = (float(exit_price) - float(entry_price)) / float(entry_price) * 100 * direction_sign
    return _numeric(value, source=JOURNAL_SOURCE, record_id=record_id)


def _realized_r(entry: Mapping[str, Any], record_id: Optional[int | str]) -> Observation:
    closed_reason = _closed_trade_reason(entry)
    if closed_reason is not None:
        return _unavailable(closed_reason)
    value = entry.get("r_multiple")
    if value is None:
        return _unavailable(NotEvaluableReason.LEGACY_DATA_UNAVAILABLE)
    return _numeric(value, source=JOURNAL_SOURCE, record_id=record_id)


def extract_metric_observations(
    journal_entry: Mapping[str, Any],
    *,
    linked_plan: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Observation]:
    """Extract all 14 approved facts from one coherent Journal/Plan snapshot."""
    entry_record_id = _record_id(journal_entry.get("id"))
    resolution = _resolve_pretrade_plan(journal_entry, linked_plan)
    geometry = _valid_geometry(linked_plan, resolution)

    observations = {
        "trade.direction": _trade_direction(journal_entry, entry_record_id),
        "trade.symbol": _trade_symbol(journal_entry, entry_record_id),
        "journal.confidence_score": _score(
            journal_entry, "confidence_score", entry_record_id
        ),
        "journal.focus_score": _score(journal_entry, "focus_score", entry_record_id),
        "journal.fomo": _journal_flag(journal_entry, "fomo", entry_record_id),
        "journal.revenge_trade": _journal_flag(
            journal_entry, "revenge_trade", entry_record_id
        ),
        "plan.recorded_before_entry": _plan_recorded_before_entry(
            entry_record_id, resolution
        ),
        "plan.stop_distance_pct": _plan_geometry_metric(
            "risk_pct", resolution, geometry
        ),
        "plan.total_reward_risk_ratio": _plan_geometry_metric(
            "planned_total_rr", resolution, geometry
        ),
        "plan.max_hold_hours": _max_hold_hours(resolution),
        "execution.entry_deviation_r": _entry_deviation_r(
            journal_entry, linked_plan, resolution
        ),
        "execution.holding_minutes": _holding_minutes(
            journal_entry, entry_record_id
        ),
        "execution.price_return_pct": _price_return_pct(
            journal_entry, entry_record_id
        ),
        "execution.realized_r": _realized_r(journal_entry, entry_record_id),
    }
    if tuple(observations) != SUPPORTED_METRIC_IDS:
        raise RuntimeError("Rule Engine extractor metric set drifted")
    return observations


__all__ = ["SUPPORTED_METRIC_IDS", "extract_metric_observations"]
