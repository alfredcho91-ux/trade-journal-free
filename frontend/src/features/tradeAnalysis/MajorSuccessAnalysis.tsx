import { useMemo, useState } from 'react';
import { CandlestickChart, Trophy } from 'lucide-react';

import type { JournalEntry, TradeQualityItem } from '../../types';
import TradeReportModal from '../journal/TradeReportModal';
import type { AnalyzedTrade } from './tradeAnalysis';
import {
  MAJOR_SUCCESS_PRICE_PCT,
  MAJOR_SUCCESS_RETURN_PCT,
  summarizeMajorSuccesses,
  type MajorSuccessCase,
  type MajorSuccessReasonId,
} from './majorSuccessRules';

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

const REASON_LABELS: Record<MajorSuccessReasonId, string> = {
  return_threshold: '투자금 순수익률 30% 이상',
  price_threshold: '방향 반영 가격 수익률 3% 이상',
  good_entry: '진입 품질 양호',
  trend_aligned: 'Weekly·Daily·4H 추세 정렬',
  with_trend: '상위 추세 순방향 거래',
  good_exit: '진입과 청산 모두 양호',
  early_exit: '좋은 진입이지만 추가 수익 여지 존재',
};

function number(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function formatDate(value: string | null | undefined, isKo: boolean): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  if (!isKo) {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, '0')}월 ${String(date.getDate()).padStart(2, '0')}일`;
}

function caseConclusion(item: MajorSuccessCase): string {
  const parts: string[] = [];
  if (item.reasons.includes('trend_aligned')) parts.push('세 시간대 추세 정렬');
  if (item.reasons.includes('with_trend')) parts.push('상위 추세 순방향');
  if (item.reasons.includes('good_exit')) parts.push(`수익 포착률 ${number(item.captureRatioPct)}%`);
  if (item.reasons.includes('early_exit')) parts.push(`대성공 후에도 추가 수익 여지`);
  if (item.trade.excursion) {
    parts.push(`MFE ${number(item.trade.excursion.mfe_pct)}% · MAE ${number(item.trade.excursion.mae_pct)}%`);
  }
  return parts.slice(0, 3).join(' · ') || '기준 수익률을 충족했으나 추가 품질 데이터는 부족함';
}

export default function MajorSuccessAnalysis({ trades, qualityItems, allEntries, isLoading, isKo }: Props) {
  const [selected, setSelected] = useState<MajorSuccessCase | null>(null);
  const summary = useMemo(() => summarizeMajorSuccesses(trades, qualityItems), [qualityItems, trades]);
  const commonFindings = [
    summary.goodEntryCount > 0 ? `진입 양호 ${summary.goodEntryCount}/${summary.cases.length}건` : null,
    summary.alignedTrendCount > 0 ? `추세 정렬 ${summary.alignedTrendCount}/${summary.cases.length}건` : null,
    summary.withTrendCount > 0 ? `추세 순방향 ${summary.withTrendCount}/${summary.cases.length}건` : null,
    summary.earlyExitCount > 0 ? `추가 수익 여지 ${summary.earlyExitCount}/${summary.cases.length}건` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <section className="border border-bull/45 bg-bull/5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bull/25 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Trophy className="h-4 w-4 text-bull" />{isKo ? '대성공 거래' : 'Major Successes'}</h2>
          <p className="mt-1 text-[11px] text-dark-400">{isKo ? `투자금 대비 ${MAJOR_SUCCESS_RETURN_PCT}% 이상 순수익 또는 방향 반영 가격 수익률 ${MAJOR_SUCCESS_PRICE_PCT}% 이상` : 'At least 30% net return on margin or 3% direction-adjusted price gain'}</p>
        </div>
        <span className="font-mono text-xs text-bull">{summary.cases.length}{isKo ? '건' : ''}</span>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-sm text-dark-400">{isKo ? '대성공 거래를 분석 중입니다.' : 'Analyzing major successes.'}</div>
      ) : summary.cases.length === 0 ? (
        <div className="px-4 py-5 text-sm text-dark-300">{isKo ? '선택 기간에는 대성공 기준에 해당하는 거래가 없습니다.' : 'No trade met the major-success threshold.'}</div>
      ) : (
        <>
          <div className="grid border-b border-bull/20 sm:grid-cols-2 xl:grid-cols-4">
            <div className="border-b border-bull/15 px-4 py-3 sm:border-r xl:border-b-0"><div className="text-[11px] text-dark-500">{isKo ? '대성공 순수익' : 'Major profit'}</div><div className="mt-1 font-mono text-lg text-bull">{signed(summary.totalProfitUsdt, 2)} USDT</div></div>
            <div className="border-b border-bull/15 px-4 py-3 xl:border-b-0 xl:border-r"><div className="text-[11px] text-dark-500">{isKo ? '전체 수익 중 비중' : 'Share of gross profit'}</div><div className="mt-1 font-mono text-lg text-white">{number(summary.grossProfitSharePct)}%</div></div>
            <div className="border-b border-bull/15 px-4 py-3 sm:border-r sm:border-b-0"><div className="text-[11px] text-dark-500">{isKo ? '평균 투자금 수익률' : 'Average margin return'}</div><div className="mt-1 font-mono text-lg text-bull">{signed(summary.averageNetReturnPct)}%</div><div className="mt-1 text-[11px] text-dark-500">{isKo ? `평균 가격 ${signed(summary.averagePriceReturnPct)}%` : `Price ${signed(summary.averagePriceReturnPct)}%`}</div></div>
            <div className="px-4 py-3"><div className="text-[11px] text-dark-500">{isKo ? '집중 구간' : 'Concentration'}</div><div className="mt-1 text-sm text-white">{summary.dominantDirection?.id || '-'} · {summary.dominantSymbol?.id || '-'}</div><div className="mt-1 text-[11px] text-dark-500">{summary.dominantRegime ? REGIME_LABELS[summary.dominantRegime.id] || summary.dominantRegime.id : '-'}</div></div>
          </div>

          <div className="border-b border-bull/20 px-4 py-3">
            <div className="text-[11px] text-dark-500">{isKo ? (summary.cases.length > 1 ? '반복된 성공 조건' : '확인된 성공 조건') : 'Repeated success conditions'}</div>
            <div className="mt-1 text-sm text-dark-200">{commonFindings.length ? commonFindings.join(' · ') : (isKo ? '공통 성공 조건을 확정할 품질 데이터가 부족합니다.' : 'Not enough quality data for a common condition.')}</div>
          </div>

          <div>
            {summary.cases.map((item) => {
              const thresholdLabels = item.reasons
                .filter((reason) => reason === 'return_threshold' || reason === 'price_threshold')
                .map((reason) => REASON_LABELS[reason]);
              const assessmentLabels = item.reasons
                .filter((reason) => reason !== 'return_threshold' && reason !== 'price_threshold')
                .map((reason) => REASON_LABELS[reason]);
              return (
                <article key={item.trade.entry.id} className="grid gap-4 border-b border-dark-800 px-4 py-4 last:border-b-0 lg:grid-cols-[180px_170px_minmax(0,1fr)]">
                  <div>
                    <div className="text-[10px] text-dark-500">{isKo ? '거래 보고서' : 'Trade report'}</div>
                    <button type="button" onClick={() => setSelected(item)} className="group mt-1 text-left text-sm text-dark-200 hover:text-primary-200" title={isKo ? '거래 분석 보고서 열기' : 'Open trade report'}>
                      <span className="flex items-center gap-1.5">{formatDate(item.trade.entryDatetime || item.trade.entry.entry_datetime || item.trade.entry.datetime, isKo)}<CandlestickChart className="h-3.5 w-3.5 text-amber-300" /></span>
                      <span className="mt-1 block text-[11px] text-dark-500">{item.trade.entry.symbol} · {item.trade.entry.direction} · {number(item.trade.entry.leverage, 0)}x</span>
                    </button>
                  </div>
                  <div>
                    <div className="text-[10px] text-dark-500">{isKo ? '확정 수익' : 'Confirmed profit'}</div>
                    <div className="mt-1 font-mono text-base text-bull">{signed(item.netProfitUsdt, 2)} USDT</div>
                    <div className="mt-1 font-mono text-xs text-bull">{isKo ? `투자금 ${signed(item.netReturnPct)}% · 가격 ${signed(item.priceReturnPct)}%` : `Margin ${signed(item.netReturnPct)}% · Price ${signed(item.priceReturnPct)}%`}</div>
                    <div className="mt-2 text-[10px] leading-4 text-bull/80">{thresholdLabels.join(' · ')}</div>
                  </div>
                  <div className="min-w-0 border-t border-dark-800 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                    <div className="text-[10px] text-dark-500">{isKo ? '핵심 판정' : 'Key assessment'}</div>
                    <div className="mt-1 text-sm leading-6 text-dark-200">{caseConclusion(item)}</div>
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-[11px] text-dark-500 hover:text-dark-300">{isKo ? '성공 조건 전체 보기' : 'Show all success evidence'}</summary>
                      <div className="mt-1 text-[11px] leading-5 text-dark-500">{assessmentLabels.join(' · ') || (isKo ? '추가 품질 데이터 없음' : 'No additional quality data')}</div>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <TradeReportModal entry={selected.trade.entry} allEntries={allEntries} excursion={selected.trade.excursion} qualityItem={selected.quality} isKo={isKo} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
