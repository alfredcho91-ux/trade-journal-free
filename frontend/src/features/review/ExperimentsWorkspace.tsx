import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createExperiment, getExperiment, listExperiments, measureExperiment, transitionExperiment, updateExperiment } from '../../api/review';
import type { AnalyticsMetadata } from '../../types/analytics';
import type { Experiment, ExperimentDefinition, Measurement } from '../../types/review';
import { AnalyticsFilterInput, inputClass } from '../analytics/AnalyticsFilters';
import { analyticsError, buildRequest, initialDraft, type BuilderDraft } from '../analytics/analyticsBuilder';
import { displayAnalyticsValue as value } from '../analytics/analyticsDisplay';
import { panel, Samples } from './ReviewEvidence';
import type { ExperimentSeed } from './reviewHandoff';

const button = 'rounded border border-dark-600 px-3 py-2 text-sm disabled:opacity-40';
const timestamp = (ms: number) => new Date(ms).toISOString().slice(0, 23);
function builderFrom(definition: ExperimentSeed): BuilderDraft {
  return { metric: definition.query.metric, dimension: definition.query.dimension,
    filters: Object.fromEntries(Object.entries(definition.query.filters).filter(([, v]) => v !== null).map(([key, v]) => [key,
      key === 'start_time' || key === 'end_time' ? timestamp(Number(v)) : Array.isArray(v) ? (v.every(item => typeof item === 'string') ? v as string[] : v.join(', ')) : String(v)])) };
}
export function MeasurementView({ data }: { data: Measurement }) {
  return <section className={panel} aria-label="Experiment measurement"><h3>Measure · {data.criterion_status === 'MET' ? 'Criterion met' : data.criterion_status === 'NOT_MET' ? 'Criterion not met' : 'Not evaluable'}</h3>
    <p className="text-sm">{data.query.metric} · {data.query.dimension}</p>
    <p className="text-xs">Current UTC: {timestamp(Number(data.query.filters.start_time))} → {timestamp(Number(data.query.filters.end_time))}</p>
    <p className="text-xs">Baseline UTC: {timestamp(Number(data.baseline_query.filters.start_time))} → {timestamp(Number(data.baseline_query.filters.end_time))}</p>
    <p>Current {value(data.current?.value ?? null)} · Baseline {value(data.baseline?.value ?? null)} · Observed delta {value(data.delta)}</p>
    <div>Current: <Samples group={data.current} /></div><div>Baseline: <Samples group={data.baseline} /></div>
    <p className="text-xs">{data.reasons.join(' · ')}</p><p className="text-xs">{data.evidence_semantics} · {data.evaluation_basis}</p>
    {data.warnings.map(note => <p className="text-xs text-dark-300" key={note}>{note}</p>)}
  </section>;
}
function Editor({ record, seed, metadata, onDirty, onMutationStart, onMutationPending, onSaved }: { record?: Experiment; seed?: ExperimentSeed | null; metadata: AnalyticsMetadata;
  onDirty: (dirty: boolean) => void; onMutationStart: (id?: number) => Promise<void>; onMutationPending: (value: boolean) => void; onSaved: (value: Experiment) => Promise<void> }) {
  const existing = record?.definition;
  const [name, setName] = useState(existing?.name ?? '');
  const [hypothesis, setHypothesis] = useState(existing?.hypothesis ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [builder, setBuilder] = useState(() => existing || seed ? builderFrom((existing ?? seed)!) : { ...initialDraft(metadata), metric: 'average_r', dimension: 'all' });
  const [groupKey, setGroupKey] = useState(existing?.group_key ?? seed?.group_key ?? '');
  const [baselineStart, setBaselineStart] = useState(() => existing || seed ? timestamp((existing ?? seed)!.baseline.start_time) : timestamp(Date.now() - 180 * 86400000));
  const [baselineEnd, setBaselineEnd] = useState(() => existing || seed ? timestamp((existing ?? seed)!.baseline.end_time) : timestamp(Date.parse(`${builder.filters.start_time}Z`) - 1));
  const [criterion, setCriterion] = useState<ExperimentDefinition['criterion']>(existing?.criterion ?? { basis: 'VALUE', operator: 'gte', target: '0' });
  const [minimum, setMinimum] = useState(String(existing?.minimum_sample ?? 5));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const live = useRef(true);
  const original = useRef(JSON.stringify({ name, hypothesis, notes, builder, groupKey, baselineStart, baselineEnd, criterion, minimum }));
  const editable = !record || record.status === 'DRAFT';
  const dirty = editable && original.current !== JSON.stringify({ name, hypothesis, notes, builder, groupKey, baselineStart, baselineEnd, criterion, minimum });
  // The parent owns the transition to a clean state.  An editor unmount can
  // happen for an unrelated network transition, so it is not proof that the
  // user's draft was safely discarded.
  useEffect(() => { onDirty(dirty || pending); }, [dirty, pending, onDirty]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!dirty && !pending) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: Event) => { if (pending || !window.confirm('Discard unsaved experiment changes?')) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); window.addEventListener('app-before-navigate', navigate);
    return () => { window.removeEventListener('beforeunload', leave); window.removeEventListener('app-before-navigate', navigate); };
  }, [dirty, pending]);
  const [measureRequested, setMeasureRequested] = useState(false);
  const measurement = useQuery({ queryKey: ['experiments','measure',record?.id,record?.revision], queryFn: ({ signal }) => measureExperiment(record!.id, signal), enabled: !!record && measureRequested, retry: false });
  const run = async (operation: () => Promise<Experiment>) => {
    setPending(true); onMutationPending(true); setError('');
    try { await onMutationStart(record?.id); const result = await operation(); if (live.current) await onSaved(result); }
    catch (error) { if (live.current) setError(analyticsError(error)); }
    finally { onMutationPending(false); if (live.current) setPending(false); }
  };
  const metric = metadata.metrics.find(item => item.id === builder.metric);
  return <div className="space-y-4"><form className={panel} onSubmit={event => {
    event.preventDefault();
    const built = buildRequest(metadata, builder);
    const start = Date.parse(`${baselineStart}Z`), end = Date.parse(`${baselineEnd}Z`);
    if (!built.request || !name.trim() || !hypothesis.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= Number(built.request.filters.start_time) || !Number.isInteger(Number(minimum)) || Number(minimum) < 5) {
      setError([...built.errors, 'Provide name, hypothesis, a non-overlapping earlier baseline, and minimum sample >=5.'].join(' ')); return;
    }
    const definition: ExperimentDefinition = { name, hypothesis, notes, query: built.request, baseline: { start_time: start, end_time: end },
      group_key: builder.dimension === 'all' ? null : groupKey || null, criterion, minimum_sample: Number(minimum) };
    void run(() => record ? updateExperiment(record.id, record.revision, definition) : createExperiment(definition));
  }}>
    <h2 className="text-lg">{record ? `${record.definition.name} · ${record.status}` : 'New experiment draft'}</h2>
    <p className="text-xs text-dark-300">User-owned hypothesis. Fixed UTC close/exit periods use the same filters and group. Starting locks the definition; completed measurements reconstruct current source data.</p>
    <fieldset disabled={!editable || pending} className="space-y-3">
      <label className="block text-sm">Name<input className={inputClass} value={name} maxLength={160} onChange={e => setName(e.target.value)} /></label>
      <label className="block text-sm">Hypothesis<textarea className={inputClass} value={hypothesis} maxLength={2000} onChange={e => setHypothesis(e.target.value)} /></label>
      <div className="grid gap-3 md:grid-cols-2"><label>Target metric<select className={inputClass} value={builder.metric} onChange={e => setBuilder({ ...builder, metric: e.target.value })}>{metadata.metrics.map(item => <option key={item.id} value={item.id}>{item.label} ({item.unit})</option>)}</select></label>
        <label>Measurement dimension<select className={inputClass} value={builder.dimension} onChange={e => { setBuilder({ ...builder, dimension: e.target.value }); setGroupKey(''); }}>{metadata.dimensions.filter(item => metric?.supported_dimensions.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
      {builder.dimension !== 'all' && <label className="block">Exact observed group key<input className={inputClass} value={groupKey} onChange={e => setGroupKey(e.target.value)} /><span className="text-xs">Use Create experiment from a finding to carry its official group identity.</span></label>}
      <h3>Experiment period and recorded filters</h3>
      <div className="grid gap-3 md:grid-cols-2">{metadata.filters.filter(field => field.required).map(field => <AnalyticsFilterInput key={field.id} field={field} value={builder.filters[field.id] ?? ''} applicable onChange={v => setBuilder({ ...builder, filters: { ...builder.filters, [field.id]: v } })} />)}</div>
      <details><summary>Measurement filters / exact StrategyVersion</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{metadata.filters.filter(field => !field.required).map(field => <AnalyticsFilterInput key={field.id} field={field} value={builder.filters[field.id] ?? ''} applicable={!!metric && field.applicable_sample_units.includes(metric.sample_unit)} onChange={v => setBuilder({ ...builder, filters: { ...builder.filters, [field.id]: v } })} />)}</div></details>
      <div className="grid gap-3 md:grid-cols-2"><label>Baseline start (UTC)<input className={inputClass} type="datetime-local" step="0.001" value={baselineStart} onChange={e => setBaselineStart(e.target.value)} /></label>
        <label>Baseline end (UTC)<input className={inputClass} type="datetime-local" step="0.001" value={baselineEnd} onChange={e => setBaselineEnd(e.target.value)} /></label></div>
      <div className="grid gap-3 md:grid-cols-3"><label>Criterion basis<select className={inputClass} value={criterion.basis} onChange={e => setCriterion({ ...criterion, basis: e.target.value as 'VALUE' | 'DELTA' })}><option value="VALUE">Current value</option><option value="DELTA">Current minus baseline</option></select></label>
        <label>Operator<select className={inputClass} value={criterion.operator} onChange={e => setCriterion({ ...criterion, operator: e.target.value as 'gte' | 'lte' })}><option value="gte">At least (≥)</option><option value="lte">At most (≤)</option></select></label>
        <label>Target<input className={inputClass} value={criterion.target} onChange={e => setCriterion({ ...criterion, target: e.target.value })} /></label></div>
      <label className="block">Minimum evaluable sample and trades<input className={inputClass} type="number" min={5} max={2000} value={minimum} onChange={e => setMinimum(e.target.value)} /></label>
      <label className="block">Notes<textarea className={inputClass} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      {editable && <button className={button} disabled={pending} type="submit">{pending ? 'Saving…' : record ? 'Save draft' : 'Create draft'}</button>}
    </fieldset>
    {dirty && <p role="status" className="text-amber-200">Unsaved experiment changes</p>}
    {error && <p role="alert">{error}</p>}
  </form>
    {record && <section className={panel}><p className="text-xs">Created {record.created_at} · Started {record.started_at ?? 'Not started'} · Completed {record.completed_at ?? '—'} · Cancelled {record.cancelled_at ?? '—'}</p>
      <div className="flex gap-2">{(record.status === 'DRAFT' ? ['ACTIVE','CANCELLED'] : record.status === 'ACTIVE' ? ['COMPLETED','CANCELLED'] : []).map(status => <button key={status} className={button} disabled={pending || dirty} type="button" onClick={() => { if (window.confirm(`${status === 'ACTIVE' ? 'Start and lock this definition' : status === 'COMPLETED' ? 'Complete this experiment' : 'Cancel this experiment'}?`)) void run(() => transitionExperiment(record.id, record.revision, status as Experiment['status'])); }}>{status === 'ACTIVE' ? 'Start experiment' : status === 'COMPLETED' ? 'Complete experiment' : 'Cancel experiment'}</button>)}
        <button type="button" className={button} disabled={pending || dirty} onClick={() => { setMeasureRequested(true); if (measureRequested) void measurement.refetch(); }}>Measure</button></div>
      {measurement.isFetching && <p role="status">Measuring…</p>}{measurement.isError && <p role="alert">{analyticsError(measurement.error)}</p>}
      {!measurement.isFetching && !measurement.isError && measurement.data && <MeasurementView data={measurement.data} />}
    </section>}
  </div>;
}
export default function ExperimentsWorkspace({ metadata, seed, onDirtyChange }: { metadata: AnalyticsMetadata; seed?: ExperimentSeed | null; onDirtyChange: (value: boolean) => void }) {
  const [selected, setSelected] = useState<number | 'new'>('new');
  const [newDraft, setNewDraft] = useState(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const selectedRef = useRef(selected);
  const authoritativeEpochRef = useRef(0);
  const client = useQueryClient();
  const detailKey = (id: number) => ['experiments', 'detail', id] as const;
  const list = useQuery({ queryKey: ['experiments','list',offset], queryFn: ({ signal }) => listExperiments(offset, signal), retry: false });
  const detail = useQuery({ queryKey: ['experiments','detail',selected], queryFn: ({ signal }) => getExperiment(selected as number, signal), enabled: typeof selected === 'number', retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  function select(id: number | 'new') {
    // `selected` is the identity that owns this mounted editor.  A matching
    // selection cannot load a different revision, so it must leave draft and
    // parent dirty state untouched.
    if (id === selected) return;
    if (!dirty || window.confirm('Discard unsaved experiment changes?')) {
      // Selection is an explicit discard/switch action.  Invalidate any
      // in-flight Reload before changing which editor owns the draft.
      authoritativeEpochRef.current += 1;
      if (typeof selected === 'number') void client.cancelQueries({ queryKey: detailKey(selected) });
      setDirty(false);
      setMutationPending(false);
      // The asynchronous Reload continuation can resume before this render's
      // effect. Publish the new identity synchronously so it cannot refetch
      // or apply state for the experiment that was just discarded.
      selectedRef.current = id;
      setSelected(id);
      if (id === 'new') setNewDraft(value => value + 1);
    }
  }
  async function reload() {
    if (typeof selected !== 'number' || (dirty && !window.confirm('Discard unsaved changes and reload?'))) return;
    const requested = selected;
    const epoch = ++authoritativeEpochRef.current;
    await client.cancelQueries({ queryKey: detailKey(requested) });
    if (epoch !== authoritativeEpochRef.current || selectedRef.current !== requested) return;
    try {
      const result = await detail.refetch();
      // A paused refetch can retain cached success data. It has not replaced
      // the draft from an authoritative response, so it must not clear dirty.
      if (epoch === authoritativeEpochRef.current && result.isSuccess && result.fetchStatus === 'idle' && result.data?.id === requested && selectedRef.current === requested) setEditorGeneration(value => value + 1);
    } catch { /* Query state renders the request error while preserving the draft. */ }
  }
  return <div className="space-y-4"><header><h2 className="text-xl font-semibold">Experiments · Hypothesis → Measurement → Evidence</h2><p className="text-sm text-dark-300">User-owned process experiments. A criterion result describes the sample; it does not establish causation.</p></header>
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]"><aside className={panel}><button className={button} type="button" onClick={() => select('new')}>New experiment</button>
      {list.isPending && <p>Loading experiments…</p>}{list.isError && <p role="alert">{analyticsError(list.error)}</p>}
      {list.data?.length === 0 && <p>No experiments saved.</p>}
      {list.data?.map(item => <button className={`block w-full text-left ${button}`} key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => select(item.id)}>{item.definition.name}<span className="block text-xs">{item.status} · #{item.id}</span></button>)}
      <div className="flex gap-2"><button className={button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button className={button} disabled={list.data?.length !== 50} onClick={() => setOffset(offset + 50)}>Next</button></div></aside>
      <div>{typeof selected === 'number' && detail.isFetching && <p role="status">Loading selected experiment…</p>}
        {detail.isError && typeof selected === 'number' && <p role="alert">{analyticsError(detail.error)}</p>}
        {typeof selected === 'number' && <button className={button} disabled={detail.isFetching || mutationPending} type="button" onClick={() => void reload()}>Reload saved experiment</button>}
        {(selected === 'new' || detail.data?.id === selected) && <Editor key={`${selected}/${selected === 'new' ? newDraft : `${detail.data?.revision}/${editorGeneration}`}`} metadata={metadata} seed={newDraft === 0 ? seed : null} record={selected === 'new' ? undefined : detail.data} onDirty={setDirty} onMutationStart={async id => {
          // A write is newer user intent than every already-started read.
          // Cancelling the Query prevents a late non-abortable response from
          // becoming the effective cache value after this mutation succeeds.
          authoritativeEpochRef.current += 1;
          if (id !== undefined) await client.cancelQueries({ queryKey: detailKey(id) });
        }} onMutationPending={setMutationPending} onSaved={async record => {
          authoritativeEpochRef.current += 1;
          await client.cancelQueries({ queryKey: detailKey(record.id) });
          client.setQueryData(detailKey(record.id), record); void client.invalidateQueries({ queryKey: ['experiments','list'] }); setSelected(record.id);
        }} />}
      </div></div>
  </div>;
}
