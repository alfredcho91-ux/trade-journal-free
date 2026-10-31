import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adoptDiscoveryCandidate, createDiscoveryRun, getDiscoveryCandidate, getDiscoveryMetadata, getDiscoveryRun, listDiscoveryRuns } from '../api/strategyDiscovery';
import { getRuleEngineMetadata } from '../api/ruleEngine';
import CandidateAdoptionDialog from '../features/strategyDiscovery/CandidateAdoptionDialog';
import CandidateDetail from '../features/strategyDiscovery/CandidateDetail';
import CandidateList from '../features/strategyDiscovery/CandidateList';
import DiscoveryForm from '../features/strategyDiscovery/DiscoveryForm';
import { discoveryQueryKeys as keys } from '../features/strategyDiscovery/discoveryQueryKeys';
import { reasonLabel, utcDate } from '../features/strategyDiscovery/discoveryPresentation';
import { strategyQueryKeys } from '../features/playbook/strategyQueryKeys';
import { useEditorAuthority, type EditorSubmissionAuthority } from '../hooks/useEditorAuthority';
import { useSearchParams } from '../router-context';
import { useLanguage } from '../store/useStore';
import type { StrategyCreateInput } from '../types';
import type { DiscoveryRequest, StrategyCandidate } from '../types/strategyDiscovery';

function positiveId(value: string | null): number | null {
  return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
interface RunSubmission { request: DiscoveryRequest; key: string; authority: EditorSubmissionAuthority }
interface AdoptionSubmission { id: number; payload: StrategyCreateInput; key: string; authority: EditorSubmissionAuthority }

export default function StrategyDiscoveryPage() {
  const isKo = useLanguage() === 'ko';
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const runId = positiveId(params.get('run'));
  const selectionKey = params.toString();
  const [offset, setOffset] = useState(0);
  const [editorId, setEditorId] = useState<number | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const captureRunAuthority = useEditorAuthority('strategy-discovery-run', params.toString());
  const runAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const adoptionAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const runBusy = useRef(false);
  const adoptionBusy = useRef(false);
  useEffect(() => { setEditorId(null); setEditorDirty(false); }, [selectionKey]);

  const metadata = useQuery({ queryKey: keys.metadata, queryFn: ({ signal }) => getDiscoveryMetadata(signal), staleTime: Infinity, retry: false });
  const history = useQuery({ queryKey: keys.list(offset), queryFn: ({ signal }) => listDiscoveryRuns(offset, signal), retry: false });
  const run = useQuery({ queryKey: keys.run(runId), queryFn: ({ signal }) => getDiscoveryRun(runId!, signal),
    enabled: runId !== null, staleTime: Infinity, refetchOnWindowFocus: false, retry: false });
  const requestedCandidate = positiveId(params.get('candidate'));
  const candidateId = requestedCandidate ?? run.data?.candidates[0]?.id ?? null;
  const candidateBelongsToRun = run.data?.id === runId && run.data.candidates.some(item => item.id === candidateId);
  const candidate = useQuery({ queryKey: keys.candidate(candidateId), queryFn: ({ signal }) => getDiscoveryCandidate(candidateId!, signal),
    enabled: candidateId !== null && candidateBelongsToRun, staleTime: Infinity, refetchOnWindowFocus: false, retry: false });
  const selected = candidateBelongsToRun && candidate.data?.run_id === runId ? candidate.data : null;
  const ruleMetadata = useQuery({ queryKey: strategyQueryKeys.ruleMetadata(), queryFn: getRuleEngineMetadata,
    enabled: editorId !== null, staleTime: Infinity, retry: false });

  const analysis = useMutation({
    mutationFn: (submission: RunSubmission) => createDiscoveryRun(submission.request, submission.key), retry: false,
    onSuccess: (result, variables) => {
      client.setQueryData(keys.run(result.id), result);
      void client.invalidateQueries({ queryKey: keys.runs });
      if (runAttempt.current?.key === variables.key) runAttempt.current = null;
      if (variables.authority.isCurrent()) {
        setOffset(0);
        const next = new URLSearchParams({ run: String(result.id) });
        if (result.candidates[0]) next.set('candidate', String(result.candidates[0].id));
        setParams(next);
      }
    },
    onSettled: () => { runBusy.current = false; },
  });
  const adoption = useMutation({
    mutationFn: (submission: AdoptionSubmission) => adoptDiscoveryCandidate(submission.id, submission.payload, submission.key), retry: false,
    onSuccess: (result, variables) => {
      client.setQueryData<StrategyCandidate>(keys.candidate(variables.id), current => current ? { ...current, adoption: result } : current);
      void client.invalidateQueries({ queryKey: keys.candidate(variables.id) });
      void client.invalidateQueries({ queryKey: keys.runs });
      void client.invalidateQueries({ queryKey: strategyQueryKeys.lists() });
      if (adoptionAttempt.current?.key === variables.key) adoptionAttempt.current = null;
      if (variables.authority.isCurrent()) { setEditorDirty(false); setEditorId(null); }
    },
    onSettled: () => { adoptionBusy.current = false; },
  });
  const registrationPending = adoption.isPending && !!adoption.variables?.authority.isSameSession();
  useEffect(() => {
    if (!editorDirty && !registrationPending) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: Event) => {
      if (registrationPending || !window.confirm(isKo ? '저장하지 않은 전략 후보 변경을 버릴까요?' : 'Discard unsaved candidate changes?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('app-before-navigate', navigate);
    return () => { window.removeEventListener('beforeunload', leave); window.removeEventListener('app-before-navigate', navigate); };
  }, [editorDirty, registrationPending, isKo]);

  function start(request: DiscoveryRequest) {
    if (runBusy.current || editorId !== null) return;
    const fingerprint = JSON.stringify(request);
    if (runAttempt.current?.fingerprint !== fingerprint) runAttempt.current = { fingerprint, key: crypto.randomUUID() };
    runBusy.current = true;
    analysis.mutate({ request, key: runAttempt.current.key, authority: captureRunAuthority() });
  }
  function register(payload: StrategyCreateInput, authority: EditorSubmissionAuthority) {
    if (adoptionBusy.current || !selected || editorId !== selected.id || selected.adoption) return;
    const fingerprint = JSON.stringify({ id: selected.id, payload });
    if (adoptionAttempt.current?.fingerprint !== fingerprint) adoptionAttempt.current = { fingerprint, key: crypto.randomUUID() };
    adoptionBusy.current = true;
    adoption.mutate({ id: selected.id, payload, key: adoptionAttempt.current.key, authority });
  }
  function selectRun(id: number) {
    setParams(new URLSearchParams({ run: String(id) }));
  }

  return <div className="space-y-5">
    <header><h1 className="text-xl font-semibold text-dark-100">{isKo ? '전략 발견' : 'Strategy Discovery'}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-dark-400">{isKo ? '내 거래에서 반복된 종목·방향 조건을 찾고, 이후 구간에서 평가한 뒤 전략 초안으로 검토합니다. 기록된 거래의 과거 관찰이며 미래 성과를 보장하지 않습니다.' : 'Find recurring symbol and direction conditions, evaluate them in a later period, then review a strategy draft. These are historical observations of recorded trades, not guarantees of future performance.'}</p>
    </header>
    {metadata.isPending && <p role="status">{isKo ? '분석 설정을 불러오는 중…' : 'Loading discovery settings…'}</p>}
    {metadata.isError && <div role="alert"><p>{isKo ? '분석 설정을 불러오지 못했습니다.' : 'Could not load discovery settings.'}</p><button className="btn-secondary mt-2" type="button" onClick={() => void metadata.refetch()}>{isKo ? '다시 시도' : 'Retry'}</button></div>}
    {metadata.data && <DiscoveryForm metadata={metadata.data} pending={analysis.isPending} disabled={editorId !== null} isKo={isKo} onRun={start} />}
    {analysis.isPending && <p role="status" className="text-sm text-dark-400">{isKo ? '분석을 실행하고 있습니다. 페이지를 이동해도 서버에서 완료된 결과는 실행 이력에 남을 수 있습니다.' : 'Analysis is running. Navigating away may still leave a completed result in run history.'}</p>}
    {analysis.isError && analysis.variables?.authority.isCurrent() && <p role="alert" className="text-sm text-bear">{isKo ? '분석 요청을 완료하지 못했습니다. 같은 조건으로 다시 실행하면 중복 저장을 방지합니다.' : 'The analysis request did not complete. Retry the same conditions to avoid duplicate storage.'} {message(analysis.error)}</p>}
    <details className="border-b border-dark-700 pb-3" open={!runId}>
      <summary className="cursor-pointer text-sm font-medium text-dark-300">{isKo ? '분석 실행 이력' : 'Analysis history'}</summary>
      <div className="mt-3 space-y-3">
        {history.isPending && <p role="status">{isKo ? '이력을 불러오는 중…' : 'Loading history…'}</p>}
        {history.isError && <div role="alert"><p>{isKo ? '분석 이력을 불러오지 못했습니다.' : 'Could not load analysis history.'}</p><button className="btn-secondary" type="button" onClick={() => void history.refetch()}>{isKo ? '다시 시도' : 'Retry'}</button></div>}
        {history.data && !history.data.items.length && <p className="text-sm text-dark-500">{isKo ? '아직 실행한 분석이 없습니다. 위에서 기간을 선택하고 후보를 찾아보세요.' : 'No analyses yet. Choose a period above to find candidates.'}</p>}
        {history.data?.items.map(item => <button type="button" key={item.id} onClick={() => selectRun(item.id)} aria-pressed={runId === item.id} className="block w-full rounded border border-dark-700 px-3 py-2 text-left text-xs leading-5 text-dark-300 hover:bg-dark-800">{utcDate(item.created_at)} · {isKo ? '후보' : 'Candidates'} {item.summary.candidate_count} · {utcDate(item.request.start_time).slice(0, 10)} – {utcDate(item.request.end_time).slice(0, 10)}</button>)}
        {history.data && <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={offset === 0 || history.isFetching} onClick={() => setOffset(Math.max(0, offset - 20))}>{isKo ? '이전' : 'Previous'}</button><button type="button" className="btn-secondary" disabled={!history.data.has_more || history.isFetching} onClick={() => setOffset(offset + 20)}>{isKo ? '다음' : 'Next'}</button></div>}
      </div>
    </details>
    {runId !== null && run.isPending && <p role="status">{isKo ? '분석 결과를 불러오는 중…' : 'Loading analysis…'}</p>}
    {run.isError && <div role="alert"><p>{isKo ? '분석 결과를 불러오지 못했습니다.' : 'Could not load analysis.'} {message(run.error)}</p><button className="btn-secondary mt-2" type="button" onClick={() => void run.refetch()}>{isKo ? '다시 시도' : 'Retry'}</button></div>}
    {run.data?.id === runId && <>
      <section className="space-y-3" aria-label={isKo ? '분석 실행 요약' : 'Run summary'}>
        <h2 className="text-base font-semibold">{isKo ? '분석 결과' : 'Discovery results'}</h2>
        <p className="text-xs text-dark-400">{utcDate(run.data.request.start_time)} – {utcDate(run.data.request.end_time)}</p>
        <p className="text-xs text-dark-400">{isKo ? '발견 기준' : 'Discovery metric'}: {run.data.request.primary_metric === 'average_r' ? (isKo ? '평균 기록 R' : 'Average recorded R') : (isKo ? '평균 순수익률' : 'Average net return')}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-dark-300"><span>{isKo ? '선택 거래' : 'Selected'} <strong className="font-mono">{run.data.summary.selected_trades}</strong></span><span>{isKo ? '발견' : 'Discovery'} <strong className="font-mono">{run.data.summary.discovery_trades}</strong></span><span>{isKo ? '검증' : 'Holdout'} <strong className="font-mono">{run.data.summary.validation_trades}</strong></span><span>{isKo ? '탐색 조건' : 'Searched conditions'} <strong className="font-mono">{run.data.summary.searched_conditions}</strong></span></div>
        <p className="text-xs text-dark-500">{isKo ? '구간 분리' : 'Split'} {utcDate(run.data.summary.split_time)} · {isKo ? '종료가 분리 시각 전인 거래로 발견하고, 분리 시각 이후 진입한 거래로 검증합니다.' : 'Discovery trades close before the split; holdout trades enter at or after it.'}</p>
        {run.data.summary.shortlisted_candidates > run.data.summary.candidate_count && <p className="text-xs text-dark-500">{isKo ? `조건을 충족한 ${run.data.summary.shortlisted_candidates}개 중 발견 순위 상위 ${run.data.summary.candidate_count}개를 표시합니다.` : `Showing the first ${run.data.summary.candidate_count} discovery-ranked candidates out of ${run.data.summary.shortlisted_candidates} eligible candidates.`}</p>}
        {Object.entries(run.data.summary.excluded).map(([reason, count]) => <p key={reason} className="text-xs text-dark-500">{reasonLabel(reason, isKo)}: {count}</p>)}
        <details><summary className="cursor-pointer text-xs text-dark-500">{isKo ? '분석 출처' : 'Analysis provenance'}</summary><p className="mt-2 break-all text-xs text-dark-500">Engine {run.data.engine_version} · Policy {run.data.policy_version} · {run.data.input_fingerprint}</p></details>
      </section>
      {!run.data.candidates.length && <p role="status" className="border-y border-dark-700 py-5 text-sm text-dark-400">{run.data.summary.state === 'INSUFFICIENT_EVIDENCE'
        ? (isKo ? '평가 가능한 발견 표본 또는 데이터 가용성이 부족합니다. 기간과 기준 지표를 확인하세요.' : 'Insufficient discovery sample or data coverage. Check the period and primary metric.')
        : (isKo ? '발견 구간에서 양수 성과와 전체 대비 차이를 충족한 후보가 없습니다. 조건을 억지로 생성하지 않았습니다.' : 'No discovery candidate had both positive performance and uplift over the baseline.')}</p>}
      {!!run.data.candidates.length && <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)]">
        <CandidateList candidates={run.data.candidates} selected={candidateId} primary={run.data.request.primary_metric} isKo={isKo} onSelect={id => setParams(new URLSearchParams({ run: String(runId), candidate: String(id) }))} />
        <div className="min-w-0">{!candidateBelongsToRun && <p role="alert">{isKo ? '이 분석에 속하지 않는 후보입니다. 목록에서 다시 선택하세요.' : 'This candidate does not belong to this run. Select one from the list.'}</p>}
          {candidateBelongsToRun && candidate.isPending && <p role="status">{isKo ? '후보를 불러오는 중…' : 'Loading candidate…'}</p>}
          {candidate.isError && <div role="alert"><p>{isKo ? '후보를 불러오지 못했습니다.' : 'Could not load candidate.'}</p><button type="button" className="btn-secondary" onClick={() => void candidate.refetch()}>{isKo ? '다시 시도' : 'Retry'}</button></div>}
          {selected && <CandidateDetail key={selected.id} candidate={selected} primary={run.data.request.primary_metric} isKo={isKo} onReview={() => { adoption.reset(); setEditorDirty(false); setEditorId(selected.id); }} />}
        </div>
      </div>}
    </>}
    {editorId !== null && selected?.id === editorId && <CandidateAdoptionDialog candidate={selected} metadata={ruleMetadata.data} metadataLoading={ruleMetadata.isPending}
      metadataError={ruleMetadata.error ? message(ruleMetadata.error) : null} isKo={isKo} pending={registrationPending}
      error={adoption.isError && adoption.variables?.authority.isSameSession() ? message(adoption.error) : null}
      onDirtyChange={setEditorDirty} onClose={() => { if (!registrationPending) { setEditorDirty(false); setEditorId(null); } }} onSubmit={register} />}
  </div>;
}
