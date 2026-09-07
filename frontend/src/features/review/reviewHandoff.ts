import type { AnalyticsGroup, AnalyticsRequest } from '../../types/analytics';
import type { ExperimentDefinition, ReviewRequest } from '../../types/review';

export type ExperimentSeed = Pick<ExperimentDefinition, 'query' | 'baseline' | 'group_key'>;
export function findingSeed(request: ReviewRequest, metric: string, dimension = 'all', group: AnalyticsGroup['identity'] | null = null): ExperimentSeed {
  const start = Number(request.filters.start_time), end = Number(request.filters.end_time);
  const filters: AnalyticsRequest['filters'] = { ...request.filters, start_time: end + 1, end_time: end + (end - start + 1) };
  if (group?.strategy_version_id != null) filters.strategy_version_ids = [group.strategy_version_id];
  if (group?.strategy_id != null) filters.strategy_ids = [group.strategy_id];
  return { query: { metric, dimension, filters }, baseline: { start_time: start, end_time: end }, group_key: dimension === 'all' ? null : group?.key ?? null };
}
