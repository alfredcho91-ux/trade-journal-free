import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAnalyticsMetadata, queryAnalytics } from '../../api/analytics';
import type { AnalyticsMetadata } from '../../types/analytics';
import { analyticsError, analyticsQueryKeys, buildRequest, initialDraft, presets, type BuilderDraft } from './analyticsBuilder';
import { AnalyticsFilterInput, inputClass } from './AnalyticsFilters';
import AnalyticsResults from './AnalyticsResults';
import ReviewWorkspace from '../review/ReviewWorkspace';
import ExperimentsWorkspace from '../review/ExperimentsWorkspace';
import type { ExperimentSeed } from '../review/reviewHandoff';

const sections = ['Overview', 'Edge Explorer', 'Strategy', 'Psychology', 'Rules', 'Time', 'Review', 'Experiments'] as const;
type Section = typeof sections[number];
const storageKey = 'analytics-workspace-v1';
function readState(): { draft?: BuilderDraft; section?: Section } {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const d = parsed.draft;
    return { section: sections.includes(parsed.section) ? parsed.section : undefined,
      draft: d && typeof d.metric === 'string' && typeof d.dimension === 'string' && d.filters && typeof d.filters === 'object'
        && !Array.isArray(d.filters) && Object.values(d.filters).every(v => typeof v === 'string' || (Array.isArray(v) && v.every(i => typeof i === 'string'))) ? d : undefined };
  } catch { return {}; }
}
function Builder({ metadata, overview }: { metadata: AnalyticsMetadata; overview: ReactNode }) {
  const [draft, setDraft] = useState<BuilderDraft>(() => readState().draft ?? initialDraft(metadata));
  const [section, setSection] = useState<Section>(() => readState().section ?? 'Edge Explorer');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [experimentDirty, setExperimentDirty] = useState(false);
  const [experimentSeed, setExperimentSeed] = useState<ExperimentSeed | null>(null);
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, section })); } catch { /* Storage may be disabled. */ } }, [draft, section]);
  const built = buildRequest(metadata, draft);
  const fingerprint = built.request ? JSON.stringify(built.request) : null;
  const active = section !== 'Overview' && section !== 'Review' && section !== 'Experiments' && fingerprint !== null && submitted === fingerprint;
  const result = useQuery({ queryKey: analyticsQueryKeys.result(built.request),
    queryFn: ({ signal }) => queryAnalytics(built.request!, signal), enabled: active, retry: false });
  const metric = metadata.metrics.find(m => m.id === draft.metric);
  const dimension = metadata.dimensions.find(d => d.id === draft.dimension);
  const supported = metadata.dimensions.filter(d => metric?.supported_dimensions.includes(d.id));
  const category = section === 'Strategy' ? 'strategy' : section === 'Psychology' ? 'psychology' : section === 'Rules' ? 'rule' : section === 'Time' ? 'time' : null;
  const highlights = category ? metadata.dimensions.filter(d => d.category === category) : [];
  const update = (next: BuilderDraft) => { setDraft(next); setSubmitted(null); setShowErrors(false); };
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-1 border-b border-dark-700 pb-2" aria-label="Analytics sections">
      {sections.map(s => <button type="button" key={s} aria-pressed={section === s} onClick={() => { if (s === section || !experimentDirty || window.confirm('Discard unsaved experiment changes?')) setSection(s); }}
        className={`rounded px-4 py-2 text-sm ${section === s ? 'bg-primary-500/20 text-primary-200' : 'text-dark-300 hover:bg-dark-800'}`}>{s}</button>)}
    </div>
    {section === 'Overview' ? overview : section === 'Review' ? <ReviewWorkspace metadata={metadata} onExperiment={seed => { setExperimentSeed(seed); setSection('Experiments'); }} /> : section === 'Experiments' ? <ExperimentsWorkspace metadata={metadata} seed={experimentSeed} onDirtyChange={setExperimentDirty} /> : <>
      <p className="text-sm text-dark-300">Explore observed historical results by metric, group and recorded filters.</p>
      {!!highlights.length && <div className="flex flex-wrap gap-2" aria-label={`${section} dimensions`}>
        {highlights.map(d => <button type="button" key={d.id} disabled={!metric?.supported_dimensions.includes(d.id)}
          title={d.semantics} onClick={() => update({ ...draft, dimension: d.id })}
          className="rounded border border-dark-600 px-3 py-2 text-xs disabled:opacity-40">{d.label}</button>)}
        {section === 'Rules' && <span className="text-xs text-dark-400">Choose a compatible metric to enable rule groupings. NOT_EVALUABLE remains neutral.</span>}
      </div>}
      <form onSubmit={e => { e.preventDefault(); setShowErrors(true); if (fingerprint) { setSubmitted(fingerprint); if (active) void result.refetch(); } }} className="space-y-4 rounded border border-dark-700 bg-dark-900 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs text-dark-300">Metric<select className={`${inputClass} mt-1`} value={draft.metric} onChange={e => update({ ...draft, metric: e.target.value })}>
            <option value="">Select metric</option>{metadata.metrics.map(m => <option key={m.id} value={m.id}>{m.label} ({m.unit})</option>)}
          </select></label>
          <label className="text-xs text-dark-300">Dimension<select className={`${inputClass} mt-1`} value={supported.some(d => d.id === draft.dimension) ? draft.dimension : ''} onChange={e => update({ ...draft, dimension: e.target.value })}>
            <option value="">Select supported dimension</option>{supported.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select></label>
        </div>
        {dimension && <p className="text-xs text-dark-400">{dimension.semantics} {dimension.time_basis && `${dimension.time_basis} · ${dimension.timezone}`}</p>}
        <div className="grid gap-4 md:grid-cols-2">{metadata.filters.filter(f => f.required).map(f => <AnalyticsFilterInput key={f.id} field={f} value={draft.filters[f.id] ?? ''}
          applicable={!!metric && f.applicable_sample_units.includes(metric.sample_unit)} onChange={v => update({ ...draft, filters: { ...draft.filters, [f.id]: v } })} />)}</div>
        <details onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm text-dark-300">Filters ({Object.entries(draft.filters).filter(([k, v]) => metadata.filters.some(f => f.id === k && !f.required) && v.length > 0).length} active)</summary>
          {filtersOpen && <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{metadata.filters.filter(f => !f.required && (metric && f.applicable_sample_units.includes(metric.sample_unit) || (draft.filters[f.id]?.length ?? 0) > 0)).map(f => <AnalyticsFilterInput key={f.id} field={f} value={draft.filters[f.id] ?? (f.input_mode === 'list' && f.value_type === 'enum' ? [] : '')}
            applicable={!!metric && f.applicable_sample_units.includes(metric.sample_unit)} onChange={v => update({ ...draft, filters: { ...draft.filters, [f.id]: v } })} />)}</div>
          }
        </details>
        {showErrors && built.errors.length > 0 && <div role="alert" className="text-sm text-amber-300">{built.errors.map((err, i) => <p key={i}>{err}</p>)}</div>}
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className="rounded bg-primary-500 px-5 py-2 text-sm font-medium text-white">Run analysis</button>
          <span className="text-xs text-dark-400">{metadata.time_basis} · {metadata.timezone}</span></div>
      </form>
      <details className="text-sm text-dark-300"><summary className="cursor-pointer">Suggested analyses</summary><div className="mt-2 flex flex-wrap gap-2">{presets.filter(p => metadata.metrics.some(m => m.id === p.metric && m.supported_dimensions.includes(p.dimension)) && metadata.dimensions.some(d => d.id === p.dimension)).map(p =>
        <button key={p.label} type="button" className="rounded border border-dark-700 px-3 py-2 text-xs" onClick={() => update({ ...draft, metric: p.metric, dimension: p.dimension })}>{p.label}</button>)}</div></details>
      {!active && <p role="status" className="rounded border border-dark-700 p-5 text-sm text-dark-400">Configure an analysis and select Run analysis.</p>}
      {active && result.isFetching && <p role="status" className="rounded border border-dark-700 p-5 text-sm text-dark-300">Loading analysis…</p>}
      {active && result.isError && <p role="alert" className="rounded border border-bear/30 p-4 text-sm text-bear">{analyticsError(result.error)}</p>}
      {active && !result.isFetching && !result.isError && result.data && <AnalyticsResults data={result.data} />}
    </>}
  </div>;
}
export default function AnalyticsWorkspace({ overview }: { overview: ReactNode }) {
  const metadata = useQuery({ queryKey: analyticsQueryKeys.metadata, queryFn: ({ signal }) => getAnalyticsMetadata(signal), retry: false });
  return <div className="mx-auto max-w-[1680px] space-y-4 p-4 lg:p-6">
    <header><p className="text-xs uppercase tracking-widest text-primary-300">Trade Analysis</p><h1 className="mt-1 text-2xl font-semibold">Analytics Workspace</h1></header>
    {metadata.isPending && <p role="status">Loading analytics definitions…</p>}
    {metadata.isError && <div role="alert"><p>{analyticsError(metadata.error)}</p><button type="button" onClick={() => void metadata.refetch()} className="mt-2 rounded border border-dark-600 p-2">Retry metadata</button><details className="mt-4"><summary>Open existing Overview</summary>{overview}</details></div>}
    {metadata.data && <Builder key={metadata.data.registry_version} metadata={metadata.data} overview={overview} />}
  </div>;
}
