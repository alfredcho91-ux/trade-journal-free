/* eslint-disable react-refresh/only-export-components */

import type {
  JournalBehaviorAnalysisData,
  JournalQualityAnalysisData,
  PlanLabData,
  TradeQualityItem,
} from '../../types';

type EvidenceDirection = 'All' | 'Long' | 'Short';

export type TradingReviewEvidence = {
  title: string;
  journalIds: number[];
  direction: EvidenceDirection;
  sourceLabel: string;
};

type ReviewStatus = 'loading' | 'available' | 'insufficient' | 'not_loaded' | 'unsupported_filter' | 'unavailable' | 'error';
type CachedQueryStatus = 'pending' | 'error' | 'success';

type BehaviorReviewCard = {
  status: ReviewStatus;
  label?: string;
  tradeCount?: number;
  impact?: number | null;
  impactUnit?: 'R' | 'USDT';
  conclusionEligible?: boolean;
  evidence?: TradingReviewEvidence;
  rows: Array<{
    id: string;
    label: string;
    value: number;
    tradeCount: number;
    conclusionEligible: boolean;
    evidence: TradingReviewEvidence;
  }>;
};

type StrengthReviewCard = {
  status: ReviewStatus;
  label?: string;
  averageR?: number | null;
  tradeCount?: number;
  sampleQuality?: string;
  evidence?: TradingReviewEvidence;
  rows: Array<{
    id: string;
    label: string;
    averageR: number;
    tradeCount: number;
    evidence: TradingReviewEvidence;
  }>;
};

type PlanReviewCard = {
  status: ReviewStatus;
  planExpectancyR?: number | null;
  actualExpectancyR?: number | null;
  executionDeltaR?: number | null;
  planRecorded?: number;
  closedTrades?: number;
  officialR?: number;
  diagnosis?: string;
  primaryIssue?: {
    label: string;
    tradeCount: number;
    evidence: TradingReviewEvidence;
  };
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function signed(value: number | null | undefined, digits = 2): string {
  if (!finite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function regimeLabel(id: string, isKo: boolean): string {
  const ko: Record<string, string> = {
    aligned_up: '주·일·4H 강한 상승 정렬',
    aligned_down: '주·일·4H 강한 하락 정렬',
    higher_up_4h_reentry: '상위 상승 추세로 4H 재전환',
    higher_down_4h_reentry: '상위 하락 추세로 4H 재전환',
    higher_up_4h_pullback: '상위 상승 추세 내 4H 조정',
    higher_down_4h_pullback: '상위 하락 추세 내 4H 반등',
    weekly_sideways_mid_up: '주봉 횡보·일/4H 상승',
    weekly_sideways_mid_down: '주봉 횡보·일/4H 하락',
    mixed: '혼합 추세',
    unavailable: '추세 확인 불가',
  };
  return isKo ? ko[id] || id : id.replace(/_/g, ' ');
}

function planDiagnosis(diagnosis: string | undefined, isKo: boolean): string | undefined {
  if (!diagnosis) return undefined;
  const labels: Record<string, string> = {
    INSUFFICIENT_PLANS: isKo ? '동일 표본으로 비교할 계획 거래가 더 필요합니다.' : 'More comparable plan trades are needed.',
    PLAN_OUTPERFORMED_ACTUAL: isKo ? '입력한 계획 결과가 실제 실행보다 높게 관찰됐습니다.' : 'Entered plans outperformed actual execution.',
    DISCRETION_OUTPERFORMED_PLAN: isKo ? '실제 재량 실행 결과가 입력 계획보다 높게 관찰됐습니다.' : 'Actual discretionary execution outperformed entered plans.',
    NO_CLEAR_GAP: isKo ? '현재 표본에서는 계획과 실제 실행의 뚜렷한 차이가 확인되지 않았습니다.' : 'No clear plan-versus-actual gap was observed.',
  };
  if (diagnosis.startsWith('BEHAVIOR_GAP:')) return isKo ? '가장 큰 실행 차이는 Plan Lab에서 확인할 수 있습니다.' : 'The largest execution gap is available in Plan Lab.';
  return labels[diagnosis] || diagnosis;
}

export function buildBehaviorReviewCard(
  data: JournalBehaviorAnalysisData | undefined,
  isKo: boolean,
): BehaviorReviewCard {
  if (!data) return { status: 'unavailable', rows: [] };
  const metric = 'USDT' as const;
  const rows = data.biggest_leaks.slice(0, 4).map((row) => ({
    id: row.id,
    label: row.label,
    value: row.loss_impact_pnl,
    tradeCount: row.trade_count,
    conclusionEligible: row.conclusion_eligible,
    evidence: {
      title: isKo ? `${row.label} 근거 거래` : `${row.label} supporting trades`,
      journalIds: row.evidence_journal_ids,
      direction: 'All' as const,
      sourceLabel: isKo ? '행동 분석은 LONG·SHORT 전체 표본을 사용합니다.' : 'Behavior analysis uses the combined LONG and SHORT sample.',
    },
  }));
  const primary = rows[0];
  if (!primary) return { status: 'insufficient', rows: [] };
  return {
    status: primary.conclusionEligible ? 'available' : 'insufficient',
    label: primary.label,
    tradeCount: primary.tradeCount,
    impact: primary.value,
    impactUnit: metric,
    conclusionEligible: primary.conclusionEligible,
    evidence: primary.evidence,
    rows,
  };
}

export function buildStrengthReviewCard(
  data: JournalQualityAnalysisData | undefined,
  direction: 'Long' | 'Short',
  isKo: boolean,
  isLoading = false,
  isError = false,
): StrengthReviewCard {
  if (isLoading) return { status: 'loading', rows: [] };
  if (isError) return { status: 'error', rows: [] };
  const slice = data?.direction_breakdown[direction];
  if (!slice) return { status: 'insufficient', rows: [] };
  const evidenceFor = (id: string): TradingReviewEvidence => ({
    title: isKo ? `${regimeLabel(id, isKo)} 근거 거래` : `${regimeLabel(id, isKo)} supporting trades`,
    journalIds: data.items
      .filter((item: TradeQualityItem) => item.direction === direction && item.market_regime?.id === id && finite(item.r_multiple))
      .map((item: TradeQualityItem) => item.journal_id),
    direction,
    sourceLabel: isKo ? `${direction.toUpperCase()} 품질 분석 표본` : `${direction.toUpperCase()} quality-analysis sample`,
  });
  const rows = slice.regimes
    .filter((row) => finite(row.average_r) && row.r_sample_count >= 10)
    .sort((left, right) => (right.average_r || 0) - (left.average_r || 0))
    .slice(0, 4)
    .map((row) => ({
      id: row.id,
      label: regimeLabel(row.id, isKo),
      averageR: row.average_r as number,
      tradeCount: row.r_sample_count,
      evidence: evidenceFor(row.id),
    }));
  const best = rows[0];
  if (!best) return { status: 'insufficient', rows: [] };
  const evidence = evidenceFor(best.id);
  const sampleQuality = best.tradeCount >= 30 ? 'high' : best.tradeCount >= 10 ? 'medium' : 'low';
  return {
    status: sampleQuality === 'low' ? 'insufficient' : 'available',
    label: best.label,
    averageR: best.averageR,
    tradeCount: best.tradeCount,
    sampleQuality,
    evidence,
    rows,
  };
}

export function buildPlanReviewCard(
  data: PlanLabData | undefined,
  direction: 'Long' | 'Short',
  isKo: boolean,
  minimumAbsNetReturnPct = 0,
  queryStatus?: CachedQueryStatus,
): PlanReviewCard {
  if (minimumAbsNetReturnPct > 0) return { status: 'unsupported_filter' };
  if (queryStatus === 'error') return { status: 'error' };
  if (queryStatus === 'pending' && !data) return { status: 'loading' };
  if (!data) return { status: 'not_loaded' };
  const { summary, coverage } = data;
  const diagnosisGapId = data.diagnosis.startsWith('BEHAVIOR_GAP:')
    ? data.diagnosis.slice('BEHAVIOR_GAP:'.length)
    : undefined;
  const primary = data.largest_execution_gap
    || (diagnosisGapId ? data.primary_attribution.find((row) => row.id === diagnosisGapId) : undefined);
  const primaryIssue = primary ? {
    label: primary.id,
    tradeCount: primary.trade_count,
    evidence: {
      title: isKo ? `${primary.id} 근거 거래` : `${primary.id} supporting trades`,
      journalIds: primary.journal_ids,
      direction,
      sourceLabel: isKo ? `${direction.toUpperCase()} Plan Lab 공식 비교 표본` : `${direction.toUpperCase()} Plan Lab official comparison sample`,
    },
  } : undefined;
  const hasOfficialComparison = summary.official_r_count > 0
    && (finite(summary.plan_expectancy_r) || finite(summary.actual_expectancy_r));
  return {
    status: hasOfficialComparison ? 'available' : 'insufficient',
    planExpectancyR: summary.plan_expectancy_r,
    actualExpectancyR: summary.actual_expectancy_r,
    executionDeltaR: summary.execution_delta_r,
    planRecorded: coverage.plan_recorded,
    closedTrades: coverage.closed_trades,
    officialR: coverage.official_r,
    diagnosis: planDiagnosis(data.diagnosis, isKo),
    primaryIssue,
  };
}

export function buildPlanCoverageRows(data: PlanLabData | undefined, isKo: boolean) {
  if (!data) return [];
  const { coverage } = data;
  return [
    { id: 'recorded', label: isKo ? 'Plan 입력' : 'Plans', value: coverage.plan_recorded },
    { id: 'official', label: isKo ? '공식 USDT R' : 'Official USDT R', value: coverage.official_r },
    { id: 'price', label: isKo ? '가격 R만 가능' : 'Price R only', value: coverage.price_r_only },
    { id: 'unavailable', label: isKo ? 'R 계산 불가' : 'R unavailable', value: coverage.r_unavailable },
    { id: 'ambiguous', label: isKo ? '동일 봉 충돌' : 'Ambiguous', value: coverage.ambiguous },
    { id: 'not_evaluable', label: isKo ? '경계·경로 불확실' : 'Not evaluable', value: coverage.not_evaluable },
  ];
}

function StatusBadge({ status, isKo }: { status: ReviewStatus; isKo: boolean }) {
  const label = status === 'available'
    ? (isKo ? '분석 가능' : 'Available')
    : status === 'loading'
      ? (isKo ? '불러오는 중' : 'Loading')
      : status === 'error'
        ? (isKo ? '불러오기 실패' : 'Unavailable')
        : status === 'unsupported_filter'
          ? (isKo ? '필터 미지원' : 'Filter unsupported')
          : status === 'not_loaded'
            ? (isKo ? '불러오지 않음' : 'Not loaded')
            : status === 'insufficient'
              ? (isKo ? '표본 부족' : 'Low sample')
              : (isKo ? '별도 분석 필요' : 'Open Plan Lab');
  const tone = status === 'available' ? 'border-bull/40 text-bull' : status === 'error' ? 'border-bear/40 text-bear' : 'border-amber-300/40 text-amber-200';
  return <span className={`border px-2 py-1 text-[10px] ${tone}`}>{label}</span>;
}

function EvidenceButton({ evidence, isKo, onOpenEvidence }: { evidence?: TradingReviewEvidence; isKo: boolean; onOpenEvidence: (evidence: TradingReviewEvidence) => void }) {
  if (!evidence || evidence.journalIds.length === 0) return null;
  return <button type="button" onClick={() => onOpenEvidence(evidence)} className="border border-primary-400/40 px-2.5 py-1.5 text-[11px] text-primary-100 hover:border-primary-300 hover:bg-primary-500/10">{isKo ? `근거 거래 ${evidence.journalIds.length}건 보기` : `View ${evidence.journalIds.length} supporting trades`}</button>;
}

function ImpactBars({ rows, unit, isKo, onOpenEvidence }: { rows: BehaviorReviewCard['rows']; unit: 'R' | 'USDT'; isKo: boolean; onOpenEvidence: (evidence: TradingReviewEvidence) => void }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return <div className="mt-4 space-y-2.5">
    {rows.map((row) => <button key={row.id} type="button" onClick={() => onOpenEvidence(row.evidence)} className="grid w-full grid-cols-[minmax(96px,1fr)_minmax(80px,2fr)_72px] items-center gap-2 text-left text-[11px] group">
      <span className="truncate text-dark-300 group-hover:text-primary-100">{row.label}</span>
      <span className="h-2 overflow-hidden bg-dark-800"><span className="block h-full bg-bear/75" style={{ width: `${Math.max(4, Math.abs(row.value) / max * 100)}%` }} /></span>
      <span className="text-right font-mono text-bear">-{Math.abs(row.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{unit === 'R' ? 'R' : ' USDT'}</span>
    </button>)}
    <p className="text-[10px] text-dark-500">{isKo ? '동일 기준의 누적 영향만 비교합니다. 막대를 누르면 근거 거래를 엽니다.' : 'Only the same cumulative impact metric is compared. Select a bar to inspect its evidence.'}</p>
  </div>;
}

function StrengthBars({ rows, isKo, onOpenEvidence }: { rows: StrengthReviewCard['rows']; isKo: boolean; onOpenEvidence: (evidence: TradingReviewEvidence) => void }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.averageR)), 1);
  return <div className="mt-4 space-y-2.5">
    {rows.map((row) => <button key={row.id} type="button" onClick={() => onOpenEvidence(row.evidence)} className="grid w-full grid-cols-[minmax(96px,1fr)_minmax(80px,2fr)_58px] items-center gap-2 text-left text-[11px] group">
      <span className="truncate text-dark-300 group-hover:text-primary-100">{row.label}</span>
      <span className="relative h-2 overflow-hidden bg-dark-800"><span className={`absolute top-0 h-full ${row.averageR >= 0 ? 'left-0 bg-bull/80' : 'right-0 bg-bear/75'}`} style={{ width: `${Math.max(4, Math.abs(row.averageR) / max * 100)}%` }} /></span>
      <span className={`text-right font-mono ${row.averageR >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(row.averageR)}R</span>
    </button>)}
    <p className="text-[10px] text-dark-500">{isKo ? '시장 상황별 공식 평균 R입니다. 막대를 누르면 근거 거래를 엽니다.' : 'Official average R by market context. Select a bar to inspect its evidence.'}</p>
  </div>;
}

export default function TradingReview({
  behavior,
  behaviorLoading,
  behaviorError,
  quality,
  qualityLoading,
  qualityError,
  direction,
  cachedPlanLab,
  cachedPlanLabStatus,
  minimumAbsNetReturnPct,
  isKo,
  onOpenEvidence,
  onOpenPlanLab,
}: {
  behavior?: JournalBehaviorAnalysisData;
  behaviorLoading: boolean;
  behaviorError: boolean;
  quality?: JournalQualityAnalysisData;
  qualityLoading: boolean;
  qualityError: boolean;
  direction: 'Long' | 'Short';
  cachedPlanLab?: PlanLabData;
  cachedPlanLabStatus?: CachedQueryStatus;
  minimumAbsNetReturnPct: number;
  isKo: boolean;
  onOpenEvidence: (evidence: TradingReviewEvidence) => void;
  onOpenPlanLab: () => void;
}) {
  const behaviorCard = behaviorLoading ? { status: 'loading' as const, rows: [] } : behaviorError ? { status: 'error' as const, rows: [] } : buildBehaviorReviewCard(behavior, isKo);
  const strengthCard = buildStrengthReviewCard(quality, direction, isKo, qualityLoading, qualityError);
  const planCard = buildPlanReviewCard(cachedPlanLab, direction, isKo, minimumAbsNetReturnPct, cachedPlanLabStatus);
  const planCoverage = buildPlanCoverageRows(cachedPlanLab, isKo);

  return <section className="border border-primary-400/35 bg-dark-900/30 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 pb-4">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary-200">Trading Review</div>
        <h2 className="mt-1 text-lg font-semibold text-white">{isKo ? '먼저 볼 핵심 결론' : 'Executive summary'}</h2>
        <p className="mt-1 text-xs text-dark-500">{isKo ? '기존 행동·품질·계획 분석의 공식 결과를 다시 계산하지 않고 요약합니다.' : 'Summarizes existing behavior, quality, and plan analysis without recalculation.'}</p>
      </div>
      <span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-400">{direction.toUpperCase()} · {isKo ? '현재 분석 범위' : 'current analysis scope'}</span>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      <article className="border border-bear/30 bg-bear/5 p-4">
        <div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-medium text-bear">{isKo ? '가장 큰 행동 누수' : 'Largest behavior leak'}</div><p className="mt-1 text-[10px] text-dark-500">{isKo ? '행동 분석 공식 집계 · LONG/SHORT 전체 표본' : 'Official behavior aggregation · combined LONG/SHORT sample'}</p></div><StatusBadge status={behaviorCard.status} isKo={isKo} /></div>
        {behaviorCard.status === 'available' || behaviorCard.status === 'insufficient' ? <><div className="mt-4 text-base font-semibold text-white">{behaviorCard.label}</div><div className="mt-1 text-xs text-dark-400">{behaviorCard.tradeCount}{isKo ? '건' : ' trades'} · {isKo ? '누적 실행 영향' : 'Cumulative execution impact'} <span className="font-mono text-bear">-{Math.abs(behaviorCard.impact || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}{behaviorCard.impactUnit === 'R' ? 'R' : ' USDT'}</span></div><EvidenceButton evidence={behaviorCard.evidence} isKo={isKo} onOpenEvidence={onOpenEvidence} /><ImpactBars rows={behaviorCard.rows} unit={behaviorCard.impactUnit || 'USDT'} isKo={isKo} onOpenEvidence={onOpenEvidence} /></> : <div className="mt-5 text-xs text-dark-500">{behaviorCard.status === 'loading' ? (isKo ? '행동 분석을 불러오는 중입니다.' : 'Loading behavior analysis.') : (isKo ? '행동 데이터가 충분하지 않거나 불러오지 못했습니다.' : 'Behavior data is unavailable or insufficient.')}</div>}
      </article>

      <article className="border border-bull/30 bg-bull/5 p-4">
        <div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-medium text-bull">{isKo ? '반복 강점' : 'Repeatable strength'}</div><p className="mt-1 text-[10px] text-dark-500">{isKo ? `${direction.toUpperCase()} 품질 분석의 시장 상황별 평균 R` : `Market-context average R from ${direction.toUpperCase()} quality analysis`}</p></div><StatusBadge status={strengthCard.status} isKo={isKo} /></div>
        {strengthCard.label ? <><div className="mt-4 text-base font-semibold text-white">{strengthCard.label}</div><div className="mt-1 text-xs text-dark-400">{strengthCard.tradeCount}{isKo ? '건' : ' trades'} · {isKo ? '평균 R' : 'Average R'} <span className={`font-mono ${(strengthCard.averageR || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(strengthCard.averageR)}R</span></div><EvidenceButton evidence={strengthCard.evidence} isKo={isKo} onOpenEvidence={onOpenEvidence} /><StrengthBars rows={strengthCard.rows} isKo={isKo} onOpenEvidence={onOpenEvidence} /></> : <div className="mt-5 text-xs text-dark-500">{strengthCard.status === 'loading' ? (isKo ? '품질 분석을 불러오는 중입니다.' : 'Loading quality analysis.') : strengthCard.status === 'error' ? (isKo ? '품질 분석을 불러오지 못했습니다.' : 'Could not load quality analysis.') : (isKo ? '현재 방향·기간에서 비교 가능한 시장 상황 표본이 더 필요합니다.' : 'More comparable market-context trades are needed for this direction and period.')}</div>}
      </article>

      <article className="border border-primary-400/30 bg-primary-500/5 p-4">
        <div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-medium text-primary-200">{isKo ? 'Plan 실행 요약' : 'Plan execution summary'}</div><p className="mt-1 text-[10px] text-dark-500">{isKo ? '이미 불러온 Plan Lab 공식 결과만 표시' : 'Uses an already-loaded official Plan Lab result only'}</p></div><StatusBadge status={planCard.status} isKo={isKo} /></div>
        {planCard.status === 'available' ? <><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div><div className="text-dark-500">Plan Exp</div><div className="mt-1 font-mono text-primary-100">{signed(planCard.planExpectancyR)}R</div></div><div><div className="text-dark-500">Actual Exp</div><div className="mt-1 font-mono text-white">{signed(planCard.actualExpectancyR)}R</div></div><div><div className="text-dark-500">Δ</div><div className={`mt-1 font-mono ${(planCard.executionDeltaR || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(planCard.executionDeltaR)}R</div></div><div><div className="text-dark-500">{isKo ? '공식 비교' : 'Official n'}</div><div className="mt-1 font-mono text-white">{planCard.officialR}</div></div></div>{planCard.primaryIssue && <div className="mt-4 border-t border-dark-700 pt-3 text-xs text-dark-400"><div>{isKo ? '가장 큰 실행 차이' : 'Largest execution gap'}</div><div className="mt-1 text-dark-100">{planCard.primaryIssue.label} · {planCard.primaryIssue.tradeCount}{isKo ? '건' : ' trades'}</div><div className="mt-2"><EvidenceButton evidence={planCard.primaryIssue.evidence} isKo={isKo} onOpenEvidence={onOpenEvidence} /></div></div>}<button type="button" onClick={onOpenPlanLab} className="mt-4 text-xs text-primary-200 hover:text-white">{isKo ? 'Plan Lab에서 자세히 보기 →' : 'Open Plan Lab →'}</button></> : <><div className="mt-5 text-xs text-dark-500">{planCard.status === 'unsupported_filter' ? (isKo ? `현재 Plan Lab은 최소 순수익률 ${minimumAbsNetReturnPct}% 필터를 지원하지 않습니다. 기간·방향 기준 분석은 Plan Lab에서 확인할 수 있습니다.` : `Plan Lab does not support the ${minimumAbsNetReturnPct}% minimum-return filter. Open Plan Lab for the period and direction scope.`) : planCard.status === 'error' ? (isKo ? '이 기간·방향의 Plan Lab 분석을 불러오지 못했습니다.' : 'Could not load the matching Plan Lab analysis.') : planCard.status === 'loading' ? (isKo ? 'Plan Lab 분석을 불러오는 중입니다.' : 'Loading Plan Lab analysis.') : planCard.status === 'insufficient' ? (planCard.diagnosis || (isKo ? '공식 R 비교가 가능한 계획 거래가 더 필요합니다.' : 'More plan trades with official R are needed.')) : (isKo ? '현재 기간·방향의 Plan Lab 결과를 아직 불러오지 않았습니다.' : 'The matching Plan Lab result has not been loaded yet.')}</div>{cachedPlanLab && planCard.status === 'insufficient' && <div className="mt-3 text-[11px] text-dark-400">{isKo ? `계획 입력 ${planCard.planRecorded || 0}/${planCard.closedTrades || 0} · 공식 비교 ${planCard.officialR || 0}` : `Plans ${planCard.planRecorded || 0}/${planCard.closedTrades || 0} · official n=${planCard.officialR || 0}`}</div>}<button type="button" onClick={onOpenPlanLab} className="mt-4 text-xs text-primary-200 hover:text-white">{isKo ? 'Plan Lab에서 확인 →' : 'Open Plan Lab →'}</button></>}
        {planCoverage.length > 0 && <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-dark-700 pt-3 text-[10px] sm:grid-cols-3">{planCoverage.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 text-dark-500"><span>{item.label}</span><strong className="font-mono text-dark-200">{item.value}</strong></div>)}</div>}
      </article>
    </div>
  </section>;
}
