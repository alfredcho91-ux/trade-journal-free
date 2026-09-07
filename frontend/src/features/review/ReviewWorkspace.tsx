import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDiagnoses, getPatterns, getReview } from '../../api/review';
import type { AnalyticsMetadata } from '../../types/analytics';
import type { ReviewRequest } from '../../types/review';
import { AnalyticsFilterInput } from '../analytics/AnalyticsFilters';
import { analyticsError, buildRequest, initialDraft } from '../analytics/analyticsBuilder';
import { DiagnosisCards, panel, PatternFindings, ReviewSections } from './ReviewEvidence';
import { findingSeed, type ExperimentSeed } from './reviewHandoff';

export default function ReviewWorkspace({ metadata, onExperiment }: { metadata: AnalyticsMetadata; onExperiment: (seed: ExperimentSeed) => void }) {
  const [draft, setDraft] = useState(() => ({ ...initialDraft(metadata), metric: 'trade_count', dimension: 'all' }));
  const [compare, setCompare] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const built = buildRequest(metadata, draft);
  const request: ReviewRequest | null = built.request ? { filters: built.request.filters, compare_previous: compare } : null;
  const fingerprint = JSON.stringify(request);
  const enabled = request !== null && submitted === fingerprint;
  const review = useQuery({ queryKey: ['review','trading',request], queryFn: ({ signal }) => getReview(request!, signal), enabled, retry: false });
  const patterns = useQuery({ queryKey: ['review','patterns',request], queryFn: ({ signal }) => getPatterns(request!, signal), enabled, retry: false });
  const diagnoses = useQuery({ queryKey: ['review','diagnoses',request], queryFn: ({ signal }) => getDiagnoses(request!, signal), enabled, retry: false });
  return <div className="space-y-4">
    <header><h2 className="text-xl font-semibold">Trading Review 2.0</h2><p className="text-sm text-dark-300">What happened, where results differed, and which evidence deserves attention. Historical observations only.</p></header>
    <form className={panel} onSubmit={event => { event.preventDefault(); setErrors(built.errors); if (request) { setSubmitted(fingerprint); if (enabled) { void review.refetch(); void patterns.refetch(); void diagnoses.refetch(); } } }}>
      <p className="text-xs">Close / exit time · UTC · Inclusive period boundaries</p>
      <div className="grid gap-4 md:grid-cols-2">{metadata.filters.filter(field => field.required).map(field => <AnalyticsFilterInput key={field.id} field={field} value={draft.filters[field.id] ?? ''} applicable onChange={v => { setDraft({ ...draft, filters: { ...draft.filters, [field.id]: v } }); setSubmitted(null); }} />)}</div>
      <details><summary>Recorded filters / exact StrategyVersion</summary><div className="mt-3 grid gap-4 md:grid-cols-2">{metadata.filters.filter(field => !field.required && field.id !== 'rule_statuses').map(field => <AnalyticsFilterInput key={field.id} field={field} value={draft.filters[field.id] ?? ''} applicable onChange={v => { setDraft({ ...draft, filters: { ...draft.filters, [field.id]: v } }); setSubmitted(null); }} />)}</div></details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={compare} onChange={e => { setCompare(e.target.checked); setSubmitted(null); }} />Compare immediately preceding equal-length period</label>
      {!!errors.length && <p role="alert">{errors.join(' ')}</p>}
      <button className="rounded bg-primary-500 px-4 py-2" type="submit">Run review</button>
    </form>
    {!enabled && <p role="status">Choose a period and run review.</p>}
    {enabled && <>
      {[review, patterns, diagnoses].some(query => query.isFetching) && <p role="status">Loading review evidence…</p>}
      {review.isError && <p role="alert">Review: {analyticsError(review.error)}</p>}
      {patterns.isError && <p role="alert">Patterns: {analyticsError(patterns.error)}</p>}
      {diagnoses.isError && <p role="alert">Diagnosis: {analyticsError(diagnoses.error)}</p>}
      {!review.isFetching && !review.isError && review.data && <ReviewSections data={review.data} />}
      {!patterns.isFetching && !patterns.isError && patterns.data && <PatternFindings items={patterns.data.candidates} onExperiment={item => onExperiment(findingSeed(request!, item.metric, item.dimension, item.observed.identity))} />}
      {!diagnoses.isFetching && !diagnoses.isError && diagnoses.data && <DiagnosisCards items={diagnoses.data.diagnoses} onExperiment={item => {
        const seed = findingSeed(request!, 'average_r');
        if (item.identity.strategy_version_id !== null) seed.query.filters = { ...seed.query.filters, strategy_version_ids: [item.identity.strategy_version_id] };
        onExperiment(seed);
      }} />}
    </>}
  </div>;
}
