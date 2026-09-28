import type { AnalyticsGroup, AnalyticsRequest } from '../../types/analytics';
import type { Diagnosis, ExperimentDefinition, Pattern, ReviewMetadata, ReviewRequest } from '../../types/review';

// Review evidence is display-only and transient. It is never sent with a saved definition.
export type ReviewSource = { metadata: ReviewMetadata } & (
  { kind: 'pattern'; item: Pattern } | { kind: 'diagnosis'; item: Diagnosis }
);
export type ExperimentSeed = Pick<ExperimentDefinition, 'query' | 'baseline' | 'group_key'> & { review?: ReviewSource };
export function findingSeed(request: ReviewRequest, metric: string, dimension = 'all', group: AnalyticsGroup['identity'] | null = null): ExperimentSeed {
  const start = Number(request.filters.start_time), end = Number(request.filters.end_time);
  const filters: AnalyticsRequest['filters'] = { ...request.filters, start_time: end + 1, end_time: end + (end - start + 1) };
  if (group?.strategy_version_id != null) filters.strategy_version_ids = [group.strategy_version_id];
  if (group?.strategy_id != null) filters.strategy_ids = [group.strategy_id];
  return { query: { metric, dimension, filters }, baseline: { start_time: start, end_time: end }, group_key: dimension === 'all' ? null : group?.key ?? null };
}

export function patternSeed(request: ReviewRequest, item: Pattern, metadata: ReviewMetadata): ExperimentSeed {
  return { ...findingSeed(request, item.metric, item.dimension, item.observed.identity), review: { kind: 'pattern', item, metadata } };
}

export function diagnosisSeed(request: ReviewRequest, item: Diagnosis, metadata: ReviewMetadata): ExperimentSeed {
  const seed = findingSeed(request, 'average_r');
  if (item.identity.strategy_version_id !== null) seed.query.filters = { ...seed.query.filters, strategy_version_ids: [item.identity.strategy_version_id] };
  return { ...seed, review: { kind: 'diagnosis', item, metadata } };
}
