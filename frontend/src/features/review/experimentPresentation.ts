import type { AnalyticsGroup, AnalyticsMetadata } from '../../types/analytics';
import { analyticsLabel, textFor } from '../../utils/localization';
import { displayAnalyticsValue } from '../analytics/analyticsDisplay';
import type { ExperimentSeed, ReviewSource } from './reviewHandoff';
import { groupLabel, reviewMetricLabel } from './reviewPresentation';

export function experimentMetric(id: string, metadata: AnalyticsMetadata, isKo: boolean): string {
  const known = reviewMetricLabel(id, isKo);
  if (known !== textFor(isKo, '기록된 비교', 'Recorded comparison')) return known;
  const label = metadata.metrics.find(item => item.id === id)?.label;
  return label ? analyticsLabel(label, isKo) : textFor(isKo, '선택한 결과', 'Selected outcome');
}

export function experimentGroup(source: ReviewSource, metadata: AnalyticsMetadata, isKo: boolean): string {
  if (source.kind === 'diagnosis') return groupLabel(source.item.identity, isKo);
  const dimension = metadata.dimensions.find(item => item.id === source.item.dimension);
  // Reuse the existing ID translations when the server's English label is not localized.
  const label = isKo ? analyticsLabel(source.item.dimension, true) : dimension?.label;
  const readable = label && label !== source.item.dimension ? label : analyticsLabel(dimension?.label ?? '', isKo);
  return `${readable || textFor(isKo, '기록된 그룹', 'Recorded group')}: ${groupLabel(source.item.observed.identity, isKo)}`;
}

export function experimentTitle(seed: ExperimentSeed, metadata: AnalyticsMetadata, isKo: boolean): string {
  return seed.review ? `${experimentGroup(seed.review, metadata, isKo)} · ${textFor(isKo, '후속 관찰', 'follow-up')}`.slice(0, 160) : '';
}

export function experimentValue(value: AnalyticsGroup['value'], unit: string, isKo: boolean): string {
  const formatted = displayAnalyticsValue(value);
  return formatted === 'Unavailable' ? textFor(isKo, '판정 불가', 'Unavailable') : `${formatted}${unit === 'percent' ? '%' : unit ? ` ${unit}` : ''}`;
}

/** Format only. Never round-trip these local labels into the UTC definition. */
export function experimentPeriod(start: number, end: number, isKo: boolean): string {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return textFor(isKo, '고급 설정에서 날짜를 확인하세요.', 'Check the dates in Advanced settings.');
  const format = new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return `${format.format(start)} – ${format.format(end)}`;
}

export function experimentEvidence(kind: string, isKo: boolean): string {
  switch (kind) {
    case 'OBSERVED_ASSOCIATION': return textFor(isKo, '관찰된 연관성', 'Observed association');
    case 'ESTIMATED_OPPORTUNITY_COST': return textFor(isKo, '추정 기회비용', 'Estimated opportunity cost');
    case 'COUNTERFACTUAL_SIMULATION': return textFor(isKo, '가정에 따른 시뮬레이션', 'Counterfactual simulation');
    default: return textFor(isKo, '기타 근거 — 고급 설정에서 확인', 'Other evidence — inspect Advanced settings');
  }
}
