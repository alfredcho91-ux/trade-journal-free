import { useMemo, useState } from 'react';
import { AlertOctagon, CandlestickChart } from 'lucide-react';

import type { JournalEntry, TradeQualityItem } from '../../types';
import TradeReportModal from '../journal/TradeReportModal';
import type { AnalyzedTrade } from './tradeAnalysis';
import {
  MAJOR_FAILURE_PRICE_PCT,
  MAJOR_FAILURE_RETURN_PCT,
  summarizeMajorFailures,
  type MajorFailureCase,
  type MajorFailureReasonId,
} from './majorFailureRules';

type Props = {
  trades: AnalyzedTrade[];
  qualityItems: TradeQualityItem[];
  allEntries: JournalEntry[];
  isLoading: boolean;
  isKo: boolean;
};

const REGIME_LABELS: Record<string, string> = {
  aligned_up: '주·일·4H 상승 정렬',
  aligned_down: '주·일·4H 하락 정렬',
  higher_up_4h_reentry: '상위 상승·4H 재전환',
  higher_down_4h_reentry: '상위 하락·4H 재전환',
  higher_up_4h_pullback: '상위 상승·4H 조정',
  higher_down_4h_pullback: '상위 하락·4H 반등',
  weekly_sideways_mid_up: '주봉 횡보·일/4H 상승',
  weekly_sideways_mid_down: '주봉 횡보·일/4H 하락',
  mixed: '혼합 추세',
  unavailable: '추세 확인 불가',
};

const REASON_LABELS: Record<MajorFailureReasonId, string> = {
  loss_rate_threshold: '투자금 손실률 30% 이상',
  price_loss_threshold: '방향 반영 가격 손실률 3% 이상',
  poor_entry: '진입 후 유리한 폭보다 역행폭이 큼',
  regime_conflict: 'Weekly·Daily·4H 추세 충돌',
  counter_trend: '상위 추세 역방향 진입',
  leverage_amplified: '레버리지가 가격 손실을 증폭',
  late_recovery: '청산 후 4H 10봉 내 가격 회복',
  risk_basis_missing: '저장된 R·손절 위험 기준 없음',
};

function number(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, '0')}월 ${String(date.getDate()).padStart(2, '0')}일`;
}

function caseConclusion(item: MajorFailureCase): string {
  const excursion = item.trade.excursion;
  const parts = [];
  if (item.reasons.includes('poor_entry') && excursion) {
    parts.push(`MFE ${number(excursion.mfe_pct)}%보다 MAE ${number(excursion.mae_pct)}%가 큼`);
  }
  if (item.reasons.includes('regime_conflict')) parts.push('진입 당시 상위 프레임 충돌');
  if (item.reasons.includes('leverage_amplified')) {
    parts.push(`가격 ${signed(excursion?.realized_move_pct)}% 움직임이 ${signed(item.netReturnPct)}% 손실로 확대`);
  }
  if (item.reasons.includes('late_recovery')) parts.push(`4H 10봉 후 ${signed(item.tenBarReturnPct)}%까지 회복`);
  if (item.reasons.includes('risk_basis_missing')) parts.push('R 기준 미기록');
  return parts.slice(0, 3).join(' · ') || '저장된 데이터만으로 추가 원인 판정 불가';
}

export default function MajorFailureAnalysis({ trades, qualityItems, allEntries, isLoading, isKo }: Props) {
  const [selected, setSelected] = useState<MajorFailureCase | null>(null);
  const summary = useMemo(() => summarizeMajorFailures(trades, qualityItems), [qualityItems, trades]);
  const commonFindings = [
    summary.poorEntryCount > 0 ? `진입 불리 ${summary.poorEntryCount}/${summary.cases.length}건` : null,
    summary.conflictCount > 0 ? `추세 충돌 ${summary.conflictCount}/${summary.cases.length}건` : null,
    summary.leverageAmplifiedCount > 0 ? `레버리지 증폭 ${summary.leverageAmplifiedCount}/${summary.cases.length}건` : null,
    summary.lateRecoveryCount > 0 ? `청산 후 회복 ${summary.lateRecoveryCount}/${summary.cases.length}건` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <section className="border border-bear/45 bg-bear/5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bear/25 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><AlertOctagon className="h-4 w-4 text-bear" />{isKo ? '대실패 거래' : 'Major Failures'}</h2>
          <p className="mt-1 text-[11px] text-dark-400">{isKo ? `투자금 대비 ${Math.abs(MAJOR_FAILURE_RETURN_PCT)}% 이상 순손실 또는 방향 반영 가격 손실률 ${Math.abs(MAJOR_FAILURE_PRICE_PCT)}% 이상` : 'Loss of at least 30% on margin or a direction-adjusted price loss of at least 3%'}</p>
        </div>
        <span className="font-mono text-xs text-bear">{summary.cases.length}{isKo ? '건' : ''}</span>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-sm text-dark-400">{isKo ? '대실패 거래를 분석 중입니다.' : 'Analyzing major failures.'}</div>
      ) : summary.cases.length === 0 ? (
        <div className="px-4 py-5 text-sm text-dark-300">{isKo ? '선택 기간에는 대실패 기준에 해당하는 거래가 없습니다.' : 'No trade met the major-failure threshold.'}</div>
      ) : (
        <>
          <div className="grid border-b border-bear/20 sm:grid-cols-2 xl:grid-cols-4">
            <div className="border-b border-bear/15 px-4 py-3 sm:border-r xl:border-b-0"><div className="text-[11px] text-dark-500">{isKo ? '대실패 순손실' : 'Major loss'}</div><div className="mt-1 font-mono text-lg text-bear">{signed(summary.totalLossUsdt, 2)} USDT</div></div>
            <div className="border-b border-bear/15 px-4 py-3 xl:border-b-0 xl:border-r"><div className="text-[11px] text-dark-500">{isKo ? '전체 손실 중 비중' : 'Share of gross loss'}</div><div className="mt-1 font-mono text-lg text-white">{number(summary.grossLossSharePct)}%</div></div>
            <div className="border-b border-bear/15 px-4 py-3 sm:border-r sm:border-b-0"><div className="text-[11px] text-dark-500">{isKo ? '평균 투자금 손실률' : 'Average margin loss'}</div><div className="mt-1 font-mono text-lg text-bear">{signed(summary.averageNetReturnPct)}%</div></div>
            <div className="px-4 py-3"><div className="text-[11px] text-dark-500">{isKo ? '집중 구간' : 'Concentration'}</div><div className="mt-1 text-sm text-white">{summary.dominantDirection?.id || '-'} · {summary.dominantSymbol?.id || '-'}</div><div className="mt-1 text-[11px] text-dark-500">{summary.dominantRegime ? REGIME_LABELS[summary.dominantRegime.id] || summary.dominantRegime.id : '-'}</div></div>
          </div>

          <div className="border-b border-bear/20 px-4 py-3">
            <div className="text-[11px] text-dark-500">
              {isKo ? (summary.cases.length > 1 ? '반복된 원인' : '확인된 원인') : (summary.cases.length > 1 ? 'Repeated causes' : 'Observed causes')}
            </div>
            <div className="mt-1 text-sm text-dark-200">{commonFindings.length ? commonFindings.join(' · ') : (isKo ? '공통 원인을 확정할 표본이 부족합니다.' : 'Not enough samples for a common cause.')}</div>
          </div>

          <div>
            {summary.cases.slice(0, 2).map((item) => {
              const thresholdLabels = item.reasons
                .filter((reason) => reason === 'loss_rate_threshold' || reason === 'price_loss_threshold')
                .map((reason) => REASON_LABELS[reason]);
              const assessmentLabels = item.reasons
                .filter((reason) => reason !== 'loss_rate_threshold' && reason !== 'price_loss_threshold')
                .map((reason) => REASON_LABELS[reason]);

              return (
                <article key={item.trade.entry.id} className="grid gap-4 border-b border-dark-800 px-4 py-4 last:border-b-0 lg:grid-cols-[180px_170px_minmax(0,1fr)]">
                  <div>
                    <div className="text-[10px] text-dark-500">{isKo ? '거래 보고서' : 'Trade report'}</div>
                    <button type="button" onClick={() => setSelected(item)} className="group mt-1 text-left text-sm text-dark-200 hover:text-primary-200" title={isKo ? '거래 분석 보고서 열기' : 'Open trade report'}>
                      <span className="flex items-center gap-1.5">{formatDate(item.trade.entryDatetime || item.trade.entry.entry_datetime || item.trade.entry.datetime)}<CandlestickChart className="h-3.5 w-3.5 text-amber-300" /></span>
                      <span className="mt-1 block text-[11px] text-dark-500">{item.trade.entry.symbol} · {item.trade.entry.direction} · {number(item.trade.entry.leverage, 0)}x</span>
                    </button>
                  </div>

                  <div>
                    <div className="text-[10px] text-dark-500">{isKo ? '확정 손실' : 'Confirmed loss'}</div>
                    <div className="mt-1 font-mono text-base text-bear">{signed(item.netLossUsdt, 2)} USDT</div>
                    <div className="mt-1 font-mono text-xs text-bear">{signed(item.netReturnPct)}%</div>
                    <div className="mt-2 text-[10px] leading-4 text-bear/80">{thresholdLabels.join(' · ')}</div>
                  </div>

                  <div className="min-w-0 border-t border-dark-800 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <div className="text-[10px] text-dark-500">{isKo ? '핵심 판정' : 'Key assessment'}</div>
                    <div className="mt-1 text-sm leading-6 text-dark-200">{caseConclusion(item)}</div>
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-[11px] text-dark-500 hover:text-dark-300">{isKo ? '판정 근거 전체 보기' : 'Show all evidence'}</summary>
                      <div className="mt-1 text-[11px] leading-5 text-dark-500">{assessmentLabels.join(' · ') || (isKo ? '추가 판정 근거 없음' : 'No additional evidence')}</div>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <TradeReportModal
          entry={selected.trade.entry}
          allEntries={allEntries}
          excursion={selected.trade.excursion}
          qualityItem={selected.quality}
          isKo={isKo}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
