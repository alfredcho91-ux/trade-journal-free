import { ApiClientError } from '../../api/config';
import type { AnalyticsMetadata, AnalyticsRequest, FilterValue } from '../../types/analytics';

export interface BuilderDraft { metric: string; dimension: string; filters: Record<string, string | string[]> }
export const analyticsQueryKeys = {
  metadata: ['analytics', 'metadata'] as const,
  result: (request: AnalyticsRequest | null) => ['analytics', 'query', request ? canonicalRequest(request) : null] as const,
};
export function canonicalRequest(request: AnalyticsRequest): AnalyticsRequest {
  return { metric: request.metric, dimension: request.dimension, filters: Object.fromEntries(
    Object.entries(request.filters).filter(([, value]) => value !== null).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort((a, b) => String(a).localeCompare(String(b))) : value]),
  ) };
}
export function initialDraft(metadata: AnalyticsMetadata): BuilderDraft {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 86400000);
  const timestamps = metadata.filters.filter(f => f.value_type === 'timestamp_ms');
  return { metric: metadata.metrics[0]?.id ?? '', dimension: metadata.metrics[0]?.supported_dimensions[0] ?? '',
    filters: Object.fromEntries(timestamps.map((f, i) => [f.id, (i === 0 ? start : end).toISOString().slice(0, 23)])) };
}
export function buildRequest(metadata: AnalyticsMetadata, draft: BuilderDraft): { request: AnalyticsRequest | null; errors: string[] } {
  const errors: string[] = [];
  const metric = metadata.metrics.find(item => item.id === draft.metric);
  if (!metric || !metric.supported_dimensions.includes(draft.dimension) || !metadata.dimensions.some(d => d.id === draft.dimension)) {
    return { request: null, errors: ['Select a supported metric and dimension.'] };
  }
  const filters: Record<string, FilterValue> = {};
  for (const field of metadata.filters) {
    const raw = draft.filters[field.id];
    const empty = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (empty) { if (field.required) errors.push(`${field.label}: required.`); continue; }
    if (!field.applicable_sample_units.includes(metric.sample_unit)) {
      errors.push(`${field.label}: not applicable to this metric; clear the filter.`); continue;
    }
    const values = Array.isArray(raw) ? raw : field.input_mode === 'list' ? raw.split(',').map(s => s.trim()) : [raw];
    if (field.input_mode === 'list') {
      if (field.min_items !== null && values.length < field.min_items) errors.push(`${field.label}: minimum ${field.min_items} values.`);
      if (field.max_items !== null && values.length > field.max_items) errors.push(`${field.label}: maximum ${field.max_items} values.`);
    }
    const converted: (number | string)[] = values.map(value => {
      if (field.value_type === 'timestamp_ms') return Date.parse(`${value}Z`);
      if (field.value_type === 'positive_integer') return Number(value);
      return value;
    });
    for (const value of converted) {
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || (field.minimum !== null && value < field.minimum)
          || (field.maximum !== null && value > field.maximum)
          || (field.exclusive_minimum !== null && value <= field.exclusive_minimum)) errors.push(`${field.label}: invalid number or date.`);
      } else if ((field.enum_values.length && !field.enum_values.includes(value))
        || (field.min_length !== null && value.length < field.min_length)
        || (field.max_length !== null && value.length > field.max_length)) errors.push(`${field.label}: invalid value.`);
    }
    filters[field.id] = field.input_mode === 'list' ? converted : converted[0];
  }
  for (const constraint of metadata.filter_constraints) {
    if (constraint.kind === 'ORDER') {
      const [start, end] = constraint.fields.map(id => filters[id]);
      if (typeof start === 'number' && typeof end === 'number' && start > end) errors.push(constraint.description);
    } else if (filters[constraint.fields[0]] === constraint.value
      && constraint.fields.slice(1).some(id => filters[id] != null)) errors.push(constraint.description);
  }
  return { request: errors.length ? null : canonicalRequest({ metric: draft.metric, dimension: draft.dimension, filters }), errors };
}
export function analyticsError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unable to load analysis.';
  if (!(error instanceof ApiClientError)) return message;
  const details = error.details as { fields?: { location?: string[]; message?: string }[] } | undefined;
  return [message, ...(details?.fields ?? []).map(f => `${f.location?.join('.') ?? ''}: ${f.message ?? ''}`)].join(' ');
}
export const presets = [
  { label: 'Performance by Strategy', metric: 'net_return_pct', dimension: 'strategy' },
  { label: 'Performance by Strategy Version', metric: 'net_return_pct', dimension: 'strategy_version' },
  { label: 'Average R by Confidence', metric: 'average_r', dimension: 'confidence_score' },
  { label: 'Average R by FOMO', metric: 'average_r', dimension: 'fomo' },
  { label: 'Adherence by Strategy', metric: 'adherence_pct', dimension: 'strategy' },
  { label: 'Performance by Close Weekday', metric: 'net_return_pct', dimension: 'weekday' },
  { label: 'Performance by Close Hour', metric: 'net_return_pct', dimension: 'hour' },
];
