import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDiscoveryEvidence } from '../../api/strategyDiscovery';
import { useNavigate } from '../../router-context';
import type { DiscoveryMetric, PrimaryMetric, StrategyCandidate } from '../../types/strategyDiscovery';
import { displayAnalyticsValue } from '../analytics/analyticsDisplay';
import { discoveryQueryKeys } from './discoveryQueryKeys';
import { reasonLabel, utcDate, validationLabel } from './discoveryPresentation';

const metricLabels: Record<DiscoveryMetric, [string, string]> = {
  average_return_pct: ['평균 순수익률', 'Average net return'], average_r: ['평균 기록 R', 'Average recorded R'],
  win_rate_pct: ['승률', 'Win rate'], profit_factor: ['Profit Factor', 'Profit Factor'],
};
const value = (input: string | number | null) => input === null ? '—' : displayAnalyticsValue(input);
const unit = (metric: DiscoveryMetric) => metric === 'average_r' ? ' R' : metric.endsWith('_pct') ? '%' : '';

export default function CandidateDetail({ candidate, primary, isKo, onReview }: {
  candidate: StrategyCandidate; primary: PrimaryMetric; isKo: boolean; onReview: () => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const evidence = useQuery({ queryKey: discoveryQueryKeys.evidence(candidate.id, offset),
    queryFn: ({ signal }) => getDiscoveryEvidence(candidate.id, offset, signal), enabled: showEvidence,
    staleTime: Infinity, refetchOnWindowFocus: false, retry: false });
  return <section className="min-w-0 space-y-4" aria-label={isKo ? '전략 후보 상세' : 'Candidate detail'}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="break-words text-lg font-semibold text-dark-100">{candidate.name}</h3><p className="mt-1 text-sm text-dark-400">{validationLabel(candidate.validation_state, isKo)}</p></div>
      {candidate.adoption
        ? <button type="button" data-dialog-opener={`strategy-candidate-${candidate.id}`} onClick={() => navigate(`/playbook?strategy=${candidate.adoption!.strategy_id}`)} className="btn-secondary">{isKo ? 'Playbook 보기' : 'Open Playbook'}</button>
        : <button type="button" data-dialog-opener={`strategy-candidate-${candidate.id}`} onClick={onReview} className="btn-primary">{isKo ? '초안 검토' : 'Review draft'}</button>}
    </header>
    <p className="text-xs leading-5 text-dark-500">{isKo ? '발견 구간의 전체 대비 차이로 정렬했습니다. 검증 결과는 순위에 반영하지 않습니다. 전체 기준에는 후보 거래도 포함됩니다.' : 'Ranked by discovery uplift over all selected discovery trades, including the candidate. Holdout results never change the ranking.'}</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm"><caption className="sr-only">{isKo ? '발견 및 검증 구간 성과' : 'Discovery and holdout performance'}</caption>
        <thead className="border-y border-dark-700 text-xs text-dark-400"><tr><th scope="col" className="py-2 text-left">{isKo ? '지표' : 'Metric'}</th><th scope="col" className="px-3 py-2 text-right">{isKo ? '발견 구간' : 'Discovery'}</th><th scope="col" className="py-2 text-right">{isKo ? '검증 구간' : 'Holdout'}</th></tr></thead>
        <tbody>{(Object.keys(metricLabels) as DiscoveryMetric[]).map(metric => <tr key={metric} className="border-b border-dark-800">
          <th scope="row" className="py-3 text-left text-xs font-medium text-dark-300">{metricLabels[metric][isKo ? 0 : 1]}{primary === metric ? (isKo ? ' · 기준' : ' · Primary') : ''}</th>
          {([candidate.discovery, candidate.validation]).map((segment, index) => {
            const observed = segment.metrics[metric]; const baseline = segment.baseline[metric];
            return <td key={index} className="px-2 py-3 text-right align-top"><span className="whitespace-nowrap font-mono">{value(observed.value)}{observed.value !== null ? unit(metric) : ''}</span>
              <span className="mt-1 block whitespace-nowrap text-xs text-dark-500">n={observed.evaluable_sample}/{observed.total_sample} · {isKo ? '전체' : 'All'} {value(baseline.value)}{baseline.value !== null ? unit(metric) : ''}</span></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {candidate.adoption && <p role="status" className="text-sm text-dark-300">{candidate.adoption.rules_modified
      ? (isKo ? '수정한 규칙으로 등록했습니다. 이 화면의 검증 결과는 원래 후보에만 해당하며, 저장된 전략에는 재검증이 필요합니다.' : 'Registered with modified rules. These results describe the original candidate; the saved strategy needs separate evaluation.')
      : (isKo ? '원래 후보의 평가 규칙을 유지해 Playbook에 등록했습니다.' : 'Registered in Playbook with the original evaluated rules.')}</p>}
    <ul className="space-y-1 text-xs leading-5 text-dark-500">{candidate.reasons.map(reason => <li key={reason}>{reasonLabel(reason, isKo)}</li>)}</ul>
    <details className="border-t border-dark-700 pt-3"><summary className="cursor-pointer text-sm text-dark-300">{isKo ? '생성된 진입 규칙' : 'Generated entry rules'}</summary>
      <ul className="mt-2 space-y-2 text-sm">{candidate.conditions.map(condition => <li key={condition.field} className="break-words">{condition.field === 'symbol' ? (isKo ? '종목' : 'Symbol') : (isKo ? '방향' : 'Direction')} {condition.operator === 'in' ? (isKo ? '중 하나:' : 'in:') : '='} {Array.isArray(condition.value) ? condition.value.join(', ') : condition.value}</li>)}</ul>
    </details>
    <div className="border-t border-dark-700 pt-3">
      <button type="button" aria-expanded={showEvidence} onClick={() => setShowEvidence(!showEvidence)} className="btn-secondary">{isKo ? '근거 거래 보기' : 'View evidence trades'}</button>
      {showEvidence && <div className="mt-3 space-y-3">
        <p className="text-xs text-dark-500">{isKo ? '분석 당시 보존한 값입니다. 원본 거래를 수정해도 이 근거는 바뀌지 않습니다.' : 'Values frozen at analysis time. Editing source trades does not change this evidence.'}</p>
        {evidence.isPending && <p role="status">{isKo ? '근거를 불러오는 중…' : 'Loading evidence…'}</p>}
        {evidence.isError && <div role="alert"><p>{isKo ? '근거 거래를 불러오지 못했습니다.' : 'Could not load evidence trades.'}</p><button type="button" className="btn-secondary" onClick={() => void evidence.refetch()}>{isKo ? '다시 시도' : 'Retry'}</button></div>}
        {evidence.data && !evidence.isError && <>
          <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-xs"><caption className="sr-only">{isKo ? '보존된 근거 거래' : 'Frozen evidence trades'}</caption>
            <thead className="border-b border-dark-700 text-dark-400"><tr>{[isKo ? '종목 · 방향' : 'Symbol · side', isKo ? '종료 시각 · UTC' : 'Close · UTC', isKo ? '구간' : 'Segment', isKo ? '순수익률' : 'Net return', 'R'].map(label => <th key={label} scope="col" className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody>{evidence.data.items.map(trade => <tr key={trade.journal_id} className="border-b border-dark-800"><td className="break-words px-2 py-2">{trade.symbol ?? '—'} · {trade.direction ?? '—'}</td><td className="whitespace-nowrap px-2 py-2">{trade.datetime ? utcDate(trade.datetime) : '—'}</td><td className="px-2 py-2">{trade.segment === 'DISCOVERY' ? (isKo ? '발견' : 'Discovery') : (isKo ? '검증' : 'Holdout')}</td><td className="whitespace-nowrap px-2 py-2 text-right font-mono">{value(trade.average_return_pct)}{trade.average_return_pct !== null ? '%' : ''}</td><td className="whitespace-nowrap px-2 py-2 text-right font-mono">{value(trade.realized_r)}</td></tr>)}</tbody>
          </table></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={offset === 0 || evidence.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>{isKo ? '이전' : 'Previous'}</button><button type="button" className="btn-secondary" disabled={!evidence.data.has_more || evidence.isFetching} onClick={() => setOffset(offset + 50)}>{isKo ? '다음' : 'Next'}</button></div>
        </>}
      </div>}
    </div>
  </section>;
}
