"""Immutable metadata and compatibility allowlists. No user expressions or SQL."""

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class DimensionDefinition:
    id: str
    label: str
    semantics: str
    multi_membership: bool = False


_DIMENSIONS = (
    DimensionDefinition("all", "All trades", "One aggregate, including an empty sample."),
    DimensionDefinition("strategy", "Strategy", "Exact assignment's Strategy ID; archived included; UNASSIGNED separate."),
    DimensionDefinition("strategy_version", "Strategy version", "Exact assigned version ID, including retired versions; never current active substitution."),
    DimensionDefinition("setup", "Recorded setup", "Distinct recorded setup_tags; one membership per tag; UNRECORDED separate. Group totals may overlap.", True),
    *(DimensionDefinition(field, field.replace("_", " ").title(), "Recorded Journal value; null is UNRECORDED; invalid historical value is INVALID.")
      for field in ("confidence_score", "focus_score", "fomo", "revenge_trade")),
    DimensionDefinition("symbol", "Symbol", "Exact stored Journal symbol; no cross-market normalization."),
    DimensionDefinition("direction", "Direction", "Recorded Long/Short; missing and invalid distinct."),
    DimensionDefinition("rule", "Rule", "Identity = assigned version ID + category + rule ID; each trade-rule is one sample."),
    DimensionDefinition("rule_status", "Rule status", "PR2B FOLLOWED / VIOLATED / NOT_EVALUABLE; no-rule trades are separate context."),
    *(DimensionDefinition(field, field.title(), "Journal close datetime in UTC; naive timestamps treated as UTC; ISO week starts Monday.")
      for field in ("day", "week", "month", "weekday", "hour")),
)
DIMENSION_REGISTRY = MappingProxyType({item.id: item for item in _DIMENSIONS})
TRADE_DIMENSIONS = tuple(item.id for item in _DIMENSIONS if item.id not in {"rule", "rule_status"})


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    label: str
    unit: str
    sample_unit: str
    aggregation: str
    availability: str
    supported_dimensions: tuple[str, ...]


def _trade(identifier, label, unit, aggregation, availability):
    return MetricDefinition(identifier, label, unit, "trade", aggregation, availability, TRADE_DIMENSIONS)


def _rule(identifier, label, unit, aggregation):
    return MetricDefinition(identifier, label, unit, "trade_rule", aggregation,
                            "Assigned version's reconstructed rules; missing observations remain NOT_EVALUABLE. Empty denominator returns null.",
                            tuple(DIMENSION_REGISTRY))


_METRICS = (
    _trade("trade_count", "Closed trade count", "count", "Count selected Journal positions, even when PnL is missing.", "source ends with _position and valid close datetime in inclusive range."),
    _trade("win_rate_pct", "Win rate", "percent", "100 * positive net realized PnL count / finite PnL count; breakevens included in denominator.", "Finite stored realized_pnl."),
    _trade("loss_rate_pct", "Loss rate", "percent", "100 * negative net realized PnL count / finite PnL count; breakevens included in denominator.", "Finite stored realized_pnl."),
    _trade("net_return_pct", "Net return on invested margin", "percent", "Existing Journal Performance: 100 * sum(net PnL) / sum(invested margin) on the same eligible subset; not compounded.", "Finite net PnL and positive stored or existing Performance-inferred invested amount; stored PnL units are not currency-converted."),
    _trade("average_return_pct", "Average net return", "percent", "Arithmetic mean of per-trade net return on invested margin; not weighted or compounded.", "Existing Performance per-trade net return must be finite."),
    _trade("total_realized_r", "Total recorded realized R", "R", "Sum finite recorded realized R; no reconstruction from price returns.", "PR2B execution.realized_r available."),
    _trade("average_r", "Average recorded realized R", "R", "Arithmetic mean of finite recorded realized R.", "PR2B execution.realized_r available."),
    _trade("profit_factor", "Profit factor", "ratio", "Existing Journal Performance: gross positive net PnL / abs(gross negative net PnL). No currency conversion.", "Finite net PnL; zero gross loss returns null with NO_LOSSES and an infinite flag when profit > 0."),
    _trade("average_holding_minutes", "Average holding time", "minutes", "Arithmetic mean of PR2B execution.holding_minutes.", "Valid entry and close timestamps, close >= entry."),
    _rule("followed_count", "Followed rules", "count", "Count FOLLOWED trade-rule results."),
    _rule("violated_count", "Violated rules", "count", "Count VIOLATED trade-rule results."),
    _rule("not_evaluable_count", "Not evaluable rules", "count", "Count NOT_EVALUABLE trade-rule results; never violations."),
    _rule("adherence_pct", "Rule adherence", "percent", "PR2B: 100 * FOLLOWED / (FOLLOWED + VIOLATED)."),
    _rule("coverage_pct", "Rule evaluation coverage", "percent", "PR2B: 100 * (FOLLOWED + VIOLATED) / total rules, including descriptive rules."),
)
METRIC_REGISTRY = MappingProxyType({item.id: item for item in _METRICS})
REGISTRY_VERSION = 1
MAX_TRADES = 20_000
MAX_GROUPS = 2_000
MAX_PLAN_ROWS = 100_000
MAX_RULE_RESULTS = 100_000
