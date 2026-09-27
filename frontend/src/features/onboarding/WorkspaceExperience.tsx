import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../store/useStore';
import { useLocation, useNavigate } from '../../router-context';
import { createWorkspaceTransition, currentWorkspace, prepareSample, setWorkspace } from './workspaceSession';

const button = 'rounded border border-dark-600 px-4 py-2 text-sm hover:border-primary-300 disabled:opacity-50';

export default function WorkspaceExperience({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const ko = useLanguage() === 'ko';
  const [state, setState] = useState(currentWorkspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loop, setLoop] = useState(false);
  const transition = useMemo(() => createWorkspaceTransition(client), [client]);
  const sample = state?.mode === 'sample';
  const enter = async () => {
    setBusy(true); setError('');
    try { await transition(prepareSample()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Please retry.'); setBusy(false); }
  };
  const exit = async (reset = false) => {
    if (!state?.return_url) return;
    setBusy(true); setError('');
    try { await transition(Promise.resolve(state.return_url + (reset ? '?sample=reset' : ''))); }
    catch (e) { setError(String(e)); setBusy(false); }
  };
  const acknowledge = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/acknowledge', { method: 'POST' });
      if (!response.ok) throw new Error('Could not save your choice. Please retry.');
      const result = await response.json();
      setWorkspace(result.data); setState(result.data); navigate('/journal');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const firstRun = state?.first_run;
  return <>
    {error && <p role="alert" className="mb-3 rounded border border-amber-400 p-3 text-sm">{error}</p>}
    {busy ? <div role="status" className="py-16 text-center">{ko ? '작업 공간을 준비하고 있습니다…' : 'Preparing your workspace…'}</div> : firstRun ?
      <section className="mx-auto max-w-2xl space-y-6 py-8 sm:py-16" aria-label={ko ? '시작하기' : 'Welcome'}>
        <p className="text-sm font-semibold text-primary-300">Trade Journal</p>
        <h1 className="text-3xl font-semibold leading-tight">{ko ? '얼마를 벌었는지에서, 어떻게 매매했는지로.' : 'Understand how you trade, not just how much you made.'}</h1>
        <p className="text-dark-300">{ko ? '기록한 습관과 결과를 비교하고, 계획과 실행의 차이를 복기하세요.' : 'Compare your habits with your results, then review how your execution matched your plan.'}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button className={`${button} bg-primary-600 text-white`} onClick={() => void enter()}>{ko ? '샘플 데이터로 둘러보기' : 'Explore with sample data'}</button>
          <button className={button} onClick={() => void acknowledge()}>{ko ? '내 거래 데이터 사용하기' : 'Use my own trading data'}</button>
        </div>
        <p className="text-sm text-dark-400">{ko ? '샘플은 가상의 거래 기록입니다. 거래소 연결이나 API 키 없이 바로 살펴볼 수 있습니다.' : 'The sample uses synthetic trades. No exchange connection or API key is needed.'}</p>
        <p className="text-sm text-dark-400">{ko ? '내 데이터: Journal에서 지원되는 Deepcoin 또는 Binance 연결을 설정할 수 있습니다.' : 'For your own data, set up a supported Deepcoin or Binance connection in Journal.'}</p>
        <button className="text-sm text-dark-300 underline" onClick={() => void acknowledge()}>{ko ? '나중에 하기' : 'Skip for now'}</button>
      </section> : <>
        {sample ? <section className="mb-5 space-y-3 rounded border border-primary-400/40 bg-primary-500/10 p-4" aria-label={ko ? '샘플 작업 공간' : 'Sample workspace'}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{ko ? '샘플 작업 공간' : 'Sample workspace'}</strong><p className="text-xs text-dark-300">{ko ? '2026년 1월 · 가상의 거래 기록 · 로컬 전용' : 'January 2026 · Synthetic trades · Fully local'}</p></div>
            <div className="flex flex-wrap gap-2"><button className={button} onClick={() => void exit()}>{ko ? '내 작업 공간으로 돌아가기' : 'Use my own data'}</button><button className={button} onClick={() => void exit(true)}>{ko ? '샘플 다시 시작' : 'Reset sample'}</button></div></div>
          <p className="text-sm text-dark-300">{ko ? '거래의 메모와 계획을 열어 본 뒤, 자신감별 결과를 비교하고 복기에서 근거를 확인하세요. 기록이 없는 항목도 예시에 포함돼 있습니다.' : 'Open a trade’s notes and plan, compare results by confidence, then inspect the evidence in Review. Some records are intentionally incomplete.'}</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => navigate('/journal?sampleTrade=1')}>{ko ? '1 · 예시 거래 열기' : '1 · Open a sample trade'}</button>
            <button className={button} onClick={() => navigate('/trade-analysis?sampleStep=guided')}>{ko ? '2 · 안내형 분석' : '2 · Guided analytics'}</button>
            <button className={button} onClick={() => navigate('/trade-analysis?sampleStep=review')}>{ko ? '3 · 복기' : '3 · Review'}</button>
            <button className={button} onClick={() => setLoop(!loop)} aria-expanded={loop}>{ko ? '4 · 다음 단계 이해하기' : '4 · See the product loop'}</button>
          </div>
          {loop && <p className="text-sm leading-6">{ko ? '기록 → 분석 → 복기 → 계획 → 실험 → 측정. 복기에서 발견한 차이를 근거와 함께 살펴보고, 필요하면 실험 초안으로 이어가세요. 결과의 차이가 원인을 증명하지는 않습니다.' : 'Journal → Analyze → Review → Plan → Experiment → Measure. Inspect a finding and its evidence, then optionally explore an experiment draft. A difference in results does not prove a cause.'}</p>}
        </section> : <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {state?.trade_count === 0 && <p className="text-sm text-dark-300">{location.pathname === '/journal'
            ? (ko ? '아직 거래가 없습니다. 샘플을 살펴보거나 거래소를 연결해 시작하세요.' : 'No trades yet. Explore the sample or connect an exchange to get started.')
            : (ko ? '분석과 복기는 비교할 거래 기록이 있어야 시작할 수 있습니다.' : 'Analytics and Review need trading history to compare.')}</p>}
          <button className={`${button} ml-auto`} onClick={() => void enter()}>{ko ? '샘플 둘러보기' : 'Explore sample workspace'}</button>
        </div>}
        {children}
      </>}
  </>;
}
