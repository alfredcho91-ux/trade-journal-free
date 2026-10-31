import type { PrimaryMetric, StrategyCandidate } from '../../types/strategyDiscovery';
import { displayAnalyticsValue } from '../analytics/analyticsDisplay';
import { validationLabel } from './discoveryPresentation';

export default function CandidateList({ candidates, selected, primary, isKo, onSelect }: {
  candidates: StrategyCandidate[]; selected: number | null; primary: PrimaryMetric; isKo: boolean; onSelect: (id: number) => void;
}) {
  return <ol className="space-y-2" aria-label={isKo ? '전략 후보 목록' : 'Strategy candidates'}>{candidates.map(candidate => <li key={candidate.id}>
    <button type="button" aria-pressed={selected === candidate.id} onClick={() => onSelect(candidate.id)}
      className={`w-full min-w-0 rounded border px-3 py-3 text-left ${selected === candidate.id ? 'border-primary-400 bg-primary-500/10' : 'border-dark-700 hover:bg-dark-800'}`}>
      <span className="block break-words text-sm font-medium text-dark-100">{candidate.rank}. {candidate.name}</span>
      <span className="mt-1 block text-xs text-dark-400">{isKo ? '발견 표본' : 'Discovery sample'} {candidate.discovery.sample} · {isKo ? '전체 대비' : 'Uplift'} <span className="font-mono">{displayAnalyticsValue(candidate.discovery.primary_delta)}{primary === 'average_r' ? ' R' : ' pp'}</span></span>
      <span className={`mt-2 block text-xs ${candidate.validation_state === 'CONSISTENT' ? 'text-bull' : 'text-dark-400'}`}>{validationLabel(candidate.validation_state, isKo)}{candidate.adoption ? (isKo ? ' · 등록됨' : ' · Registered') : ''}</span>
    </button>
  </li>)}</ol>;
}
