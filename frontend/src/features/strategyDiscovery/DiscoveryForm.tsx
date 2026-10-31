import { useState, type FormEvent } from 'react';
import type { DiscoveryMetadata, DiscoveryRequest, PrimaryMetric } from '../../types/strategyDiscovery';
import { samplePeriod } from '../onboarding/workspaceSession';

export default function DiscoveryForm({ metadata, pending, disabled = false, isKo, onRun }: {
  metadata: DiscoveryMetadata; pending: boolean; disabled?: boolean; isKo: boolean; onRun: (request: DiscoveryRequest) => void;
}) {
  const [start, setStart] = useState(() => samplePeriod()?.start ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => samplePeriod()?.end ?? new Date().toISOString().slice(0, 10));
  const [symbols, setSymbols] = useState('');
  const [direction, setDirection] = useState('');
  const [metric, setMetric] = useState<PrimaryMetric>('average_return_pct');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startTime = Date.parse(`${start}T00:00:00.000Z`);
    const endTime = Date.parse(`${end}T23:59:59.999Z`);
    const selected = symbols.trim() ? symbols.split(',').map(value => value.trim()) : null;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 1 || startTime > endTime) {
      setError(isKo ? '시작일과 종료일을 확인하세요.' : 'Check the start and end dates.'); return;
    }
    if (selected && (selected.length > metadata.max_symbols || new Set(selected).size !== selected.length || selected.some(value => !value || value.length > 80))) {
      setError(isKo ? '중복 없이 유효한 종목을 입력하고 종목 수 제한을 확인하세요.' : 'Enter unique nonempty symbols within the symbol limit.'); return;
    }
    setError('');
    onRun({ start_time: startTime, end_time: endTime, symbols: selected,
      directions: direction ? [direction as 'Long' | 'Short'] : null, primary_metric: metric });
  };
  return <form onSubmit={submit} className="space-y-3 border-y border-dark-700 py-4" aria-label={isKo ? '전략 후보 분석 조건' : 'Discovery filters'}>
    <h2 className="text-sm font-medium text-dark-300">{isKo ? '새 분석 조건' : 'New analysis'}</h2>
    <fieldset disabled={pending || disabled} className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-5">
      <label className="text-xs text-dark-400">{isKo ? '시작일 · UTC' : 'From · UTC'}<input required type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 w-full" /></label>
      <label className="text-xs text-dark-400">{isKo ? '종료일 · UTC' : 'To · UTC'}<input required type="date" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 w-full" /></label>
      <label className="text-xs text-dark-400">{isKo ? '종목 · 쉼표로 구분' : 'Symbols · comma separated'}<input value={symbols} onChange={e => setSymbols(e.target.value)} placeholder={isKo ? '전체 종목' : 'All symbols'} className="mt-1 w-full" /></label>
      <label className="text-xs text-dark-400">{isKo ? '방향' : 'Direction'}<select value={direction} onChange={e => setDirection(e.target.value)} className="mt-1 w-full"><option value="">{isKo ? '전체' : 'All'}</option><option value="Long">Long</option><option value="Short">Short</option></select></label>
      <label className="text-xs text-dark-400">{isKo ? '발견 기준 지표' : 'Discovery metric'}<select value={metric} onChange={e => setMetric(e.target.value as PrimaryMetric)} className="mt-1 w-full">{metadata.primary_metrics.map(value => <option key={value} value={value}>{value === 'average_r' ? (isKo ? '평균 기록 R' : 'Average recorded R') : (isKo ? '평균 순수익률' : 'Average net return')}</option>)}</select></label>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 text-xs leading-5 text-dark-500">{isKo ? `앞 ${metadata.discovery_pct}%에서 발견하고 뒤 ${100 - metadata.discovery_pct}%에서 평가합니다. 구간별 평가 표본 ${metadata.minimum_sample_per_segment}건 이상, 가용성 ${metadata.minimum_coverage_pct}% 이상이 필요합니다.` : `Discover in the first ${metadata.discovery_pct}%; evaluate in the remaining ${100 - metadata.discovery_pct}%. Each segment needs ${metadata.minimum_sample_per_segment} evaluable trades and ${metadata.minimum_coverage_pct}% coverage.`}</p>
      <button type="submit" disabled={pending || disabled} className="btn-primary shrink-0">{pending ? (isKo ? '분석 중…' : 'Analyzing…') : (isKo ? '전략 후보 찾기' : 'Find strategy candidates')}</button>
    </div>
    {error && <p role="alert" className="text-sm text-bear">{error}</p>}
  </form>;
}
