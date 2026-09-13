import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReview } from '../../api/review';
import type { AnalyticsMetadata } from '../../types/analytics';
import type { ReviewRequest } from '../../types/review';
import { AnalyticsFilterInput } from '../analytics/AnalyticsFilters';
import { analyticsError, buildRequest, initialDraft } from '../analytics/analyticsBuilder';
import { DiagnosisCards, panel, PatternFindings, ReviewSections } from './ReviewEvidence';
import { findingSeed, type ExperimentSeed } from './reviewHandoff';
import { textFor } from '../../utils/localization';

export default function ReviewWorkspace({ metadata, onExperiment, isKo = false }: { metadata: AnalyticsMetadata; onExperiment: (seed: ExperimentSeed) => void; isKo?: boolean }) {
  const [draft, setDraft] = useState(() => ({ ...initialDraft(metadata), metric: 'trade_count', dimension: 'all' }));
  const [compare, setCompare] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const built = buildRequest(metadata, draft);
  const request: ReviewRequest | null = built.request ? { filters: built.request.filters, compare_previous: compare } : null;
  const fingerprint = JSON.stringify(request);
  const enabled = request !== null && submitted === fingerprint;
  const review = useQuery({ queryKey: ['review','trading',request], queryFn: ({ signal }) => getReview(request!, signal), enabled, retry: false });
  return <div className="space-y-4">
    <header><h2 className="text-xl font-semibold">{textFor(isKo, '매매 복기 2.0', 'Trading Review 2.0')}</h2><p className="text-sm text-dark-300">{textFor(isKo, '무슨 일이 있었고, 결과가 어디서 달랐으며, 어떤 근거를 살펴봐야 하는지 확인합니다. 과거 관찰만 제공합니다.', 'What happened, where results differed, and which evidence deserves attention. Historical observations only.')}</p></header>
    <form className={panel} onSubmit={event => { event.preventDefault(); setErrors(built.errors); if (request) { setSubmitted(fingerprint); if (enabled) void review.refetch(); } }}>
      <p className="text-xs">{textFor(isKo, '종료 시각 · UTC · 기간 경계 포함', 'Close / exit time · UTC · Inclusive period boundaries')}</p>
      <div className="grid gap-4 md:grid-cols-2">{metadata.filters.filter(field => field.required).map(field => <AnalyticsFilterInput key={field.id} field={field} value={draft.filters[field.id] ?? ''} applicable isKo={isKo} onChange={v => { setDraft({ ...draft, filters: { ...draft.filters, [field.id]: v } }); setSubmitted(null); }} />)}</div>
      <details><summary>{textFor(isKo, '기록된 필터 / 정확한 전략 버전', 'Recorded filters / exact StrategyVersion')}</summary><div className="mt-3 grid gap-4 md:grid-cols-2">{metadata.filters.filter(field => !field.required && field.id !== 'rule_statuses').map(field => <AnalyticsFilterInput key={field.id} field={field} value={draft.filters[field.id] ?? ''} applicable isKo={isKo} onChange={v => { setDraft({ ...draft, filters: { ...draft.filters, [field.id]: v } }); setSubmitted(null); }} />)}</div></details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={compare} onChange={e => { setCompare(e.target.checked); setSubmitted(null); }} />{textFor(isKo, '직전 동일 기간과 비교', 'Compare immediately preceding equal-length period')}</label>
      {!!errors.length && <p role="alert">{errors.join(' ')}</p>}
      <button className="rounded bg-primary-500 px-4 py-2" type="submit">{textFor(isKo, '복기 실행', 'Run review')}</button>
    </form>
    {!enabled && <p role="status">{textFor(isKo, '기간을 선택한 뒤 복기 실행을 누르세요.', 'Choose a period and run review.')}</p>}
    {enabled && <>
      {review.isFetching && <p role="status">{textFor(isKo, '복기 근거를 불러오는 중…', 'Loading review evidence…')}</p>}
      {review.isError && <p role="alert">{textFor(isKo, '복기', 'Review')}: {analyticsError(review.error)}</p>}
      {!review.isFetching && !review.isError && review.data && <><ReviewSections data={review.data} isKo={isKo} />
      <PatternFindings items={review.data.patterns.candidates} isKo={isKo} onExperiment={item => onExperiment(findingSeed(request!, item.metric, item.dimension, item.observed.identity))} />
      <DiagnosisCards items={review.data.strategy_execution.diagnoses} isKo={isKo} onExperiment={item => {
        const seed = findingSeed(request!, 'average_r');
        if (item.identity.strategy_version_id !== null) seed.query.filters = { ...seed.query.filters, strategy_version_ids: [item.identity.strategy_version_id] };
        onExperiment(seed);
      }} /></>}
    </>}
  </div>;
}
