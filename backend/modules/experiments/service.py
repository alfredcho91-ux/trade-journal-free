"""Measure definition periods from one official Analytics snapshot, without writes."""
from dataclasses import replace

from backend.modules.analytics import repository as analytics_repository
from backend.modules.analytics.core import matches_trade
from backend.modules.analytics.registry import METRIC_REGISTRY
from backend.modules.analytics.schemas import AnalyticsQuery
from backend.modules.analytics.service import analyze_snapshot
from backend.modules.experiments.repository import get_experiment
from backend.modules.experiments.schemas import Measurement
from backend.modules.review.core import delta, numeric


def measure(identifier, *, db_path=None):
    experiment = get_experiment(identifier, db_path=db_path)
    definition = experiment.definition
    query = definition.query
    baseline_query = AnalyticsQuery(metric=query.metric, dimension=query.dimension,
                                   filters=query.filters.model_copy(update=definition.baseline.model_dump()))
    union_query = query.model_copy(update={'filters': query.filters.model_copy(update={'start_time': definition.baseline.start_time})})
    snapshot = analytics_repository.load_snapshot(union_query, db_path=db_path,
                  include_plans=METRIC_REGISTRY[query.metric].sample_unit == 'trade_rule')

    def group(period_query):
        entries = [entry for entry in snapshot.entries if matches_trade(entry, snapshot.assignments.get(entry['id']), period_query.filters)]
        data = analyze_snapshot(replace(snapshot, entries=entries), period_query).data
        return next((item for item in data.groups if query.dimension == 'all' or item.identity.key == definition.group_key), None)

    current, baseline = group(query), group(baseline_query)
    change = delta(current.value if current else None, baseline.value if baseline else None)
    reasons = []
    for label, value in [('CURRENT', current), ('BASELINE', baseline)]:
        if value is None or value.value is None:
            reasons.append(f'{label}_UNAVAILABLE')
        if value is None or min(value.evaluable_sample, value.trade_sample) < definition.minimum_sample:
            reasons.append(f'{label}_INSUFFICIENT_SAMPLE')
        if value is not None and value.unavailable_sample:
            reasons.append(f'{label}_PARTIAL_EVIDENCE')
    # Partial evidence is disclosed, but is not silently treated as a violation.
    blockers = [reason for reason in reasons if not reason.endswith('PARTIAL_EVIDENCE')]
    if experiment.status in {'DRAFT', 'CANCELLED'}:
        blockers.append('EXPERIMENT_NOT_ACTIVE_OR_COMPLETED')
        reasons.append(blockers[-1])
    observed = numeric(change if definition.criterion.basis == 'DELTA' else current.value if current else None)
    criterion_status = 'NOT_EVALUABLE'
    if not blockers and observed is not None:
        target = numeric(definition.criterion.target)
        met = observed >= target if definition.criterion.operator == 'gte' else observed <= target
        criterion_status = 'MET' if met else 'NOT_MET'
    return Measurement(experiment_id=identifier, definition_revision=experiment.revision,
        current=current, baseline=baseline, delta=change, criterion_status=criterion_status, reasons=reasons,
        query=query, baseline_query=baseline_query, warnings=[
            'User-defined criterion, not a causal or predictive conclusion.',
            'Fixed inclusive UTC close/exit periods; baseline uses the same recorded filters and group.',
            'Current reconstructed Journal and assignment facts; later source corrections may change measurements, including completed experiments.',
            'Active experiment measurements are interim; lifecycle completion is a user action, not a success claim.',
        ])
