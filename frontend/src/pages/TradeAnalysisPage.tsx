import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, Loader2, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';

import { getJournal, getJournalBehaviorAnalysis, getJournalQualityAnalysis } from '../api/client';
import {
  ANALYSIS_TIMEFRAMES,
  buildAnalyzedTrades,
  conditionComparisons,
  filterTradesByReturnRange,
  filterTradesByCondition,
  indicatorAverages,
  indicatorComparisons,
  performanceSummary,
  type AnalysisTimeframe,
  type AnalyzedTrade,
  type ReturnRangeId,
} from '../features/tradeAnalysis/tradeAnalysis';
import {
  buildJournalPeriod,
  dateBoundaryTimestamp,
  isJournalEntryWithinPeriod,
  millisecondsUntilNextLocalDay,
  toDateInputValue,
  type JournalPeriod,
} from '../features/journal/journalPeriod';
import { netReturnPct } from '../features/journal/journalReturns';
import TradeQualityAnalysis from '../features/tradeAnalysis/TradeQualityAnalysis';
import CurrentMarketSimilarityPanel from '../features/tradeAnalysis/CurrentMarketSimilarityPanel';
import MajorFailureAnalysis from '../features/tradeAnalysis/MajorFailureAnalysis';
import MajorSuccessAnalysis from '../features/tradeAnalysis/MajorSuccessAnalysis';
import TradeExitReviewList from '../features/tradeAnalysis/TradeExitReviewList';
import TradeBehaviorAnalysis, { BehaviorLeakSummary } from '../features/tradeAnalysis/TradeBehaviorAnalysis';
import TradeReportModal from '../features/journal/TradeReportModal';
import { journalQueryKeys } from '../features/journal/journalQueryKeys';
import { useLanguage, useSelectedCoin } from '../store/useStore';
import type { JournalEntry, TradeQualityItem } from '../types';

type AnalysisMode = 'all' | 'wins' | 'losses' | 'compare';
type DirectionFilter = 'Long' | 'Short';
type AnalysisSection = 'overview' | 'entry';
type EvidenceKind = 'regime' | 'early_exit' | 'late_exit' | 'hold2' | 'condition' | 'poor_entry' | 'mae_greater';
type EvidenceRequest = { title: string; filterLabel: string; tradeIds: number[] };

const DEFAULT_ANALYSIS_DAYS = 90;

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}
function plain(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function overviewRegimeLabel(id: string, isKo: boolean): string {
  const labels: Record<string, string> = {
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
  return isKo ? labels[id] || id : id.replace(/_/g, ' ');
}

function OverviewSummary({
  data,
  direction,
  isKo,
  isLoading,
  isError,
  onRetry,
}: {
  data?: import('../types').JournalQualityAnalysisData;
  direction: DirectionFilter;
  isKo: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading && !data) {
    return <section className="flex min-h-40 items-center justify-center border border-dark-700 bg-dark-900/20 text-xs text-dark-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '한눈에 보기 계산 중' : 'Preparing overview'}</section>;
  }
  if (!data) {
    return <section className="flex flex-wrap items-center justify-between gap-3 border border-bear/30 bg-bear/5 p-4 text-xs text-bear"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{isKo ? '매매 분석 데이터를 불러오지 못했습니다.' : 'Trade analysis data is unavailable.'}</span><button type="button" onClick={onRetry} className="border border-bear/40 px-2.5 py-1.5 hover:bg-bear/10">{isKo ? '다시 불러오기' : 'Retry'}</button></section>;
  }

  const analysis = data.direction_breakdown[direction];
  const { summary } = analysis;
  const issueText = summary.issue_balance === 'entry'
    ? (isKo ? '청산보다 진입 문제가 더 많이 발견됨' : 'Entry issues were more common than exit issues')
    : summary.issue_balance === 'exit'
      ? (isKo ? '진입보다 청산 문제가 더 많이 발견됨' : 'Exit issues were more common than entry issues')
      : summary.issue_balance === 'balanced'
        ? (isKo ? '진입과 청산 문제 비중이 비슷함' : 'Entry and exit issues were balanced')
        : (isKo ? '판정 표본 부족' : 'Insufficient classification sample');
  const poorEntryCount = summary.quality_counts.poor_entry || 0;
  const earlyExitCount = summary.quality_counts.good_entry_early_exit || 0;
  const lateExitCount = summary.quality_counts.good_entry_late_exit || 0;
  const regimeLine = (regime: typeof summary.best_regime) => regime
    ? `${signed(regime.average_pnl)} USDT · ${isKo ? '승률' : 'win'} ${plain(regime.win_rate_pct)}% · n=${regime.trade_count}`
    : (isKo ? '최소 표본 미달' : 'Below sample threshold');

  return (
    <section className="space-y-4">
      <div className="border-l-4 border-amber-300 bg-amber-300/10 px-4 py-4 shadow-[0_0_28px_rgba(251,191,36,0.08)]">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-amber-300">{isKo ? '가장 먼저 고칠 점' : 'First thing to fix'}</div>
        <div className="mt-1 text-lg font-semibold text-white">{issueText}</div>
        <div className="mt-1 text-xs text-dark-400">{isKo ? `판단하기 어려운 거래 ${summary.quality_counts.unavailable || 0}건 · 진입 ${poorEntryCount}건 · 조기/지연 청산 ${earlyExitCount}/${lateExitCount}건` : `${summary.quality_counts.unavailable || 0} unclassified · poor entry ${poorEntryCount} · early/late exits ${earlyExitCount}/${lateExitCount}`}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: 'PnL', value: `${signed(summary.total_pnl)} USDT`, tone: (summary.total_pnl || 0) >= 0 ? 'text-bull' : 'text-bear' },
          { label: isKo ? '승률' : 'Win Rate', value: `${plain(summary.win_rate_pct)}%`, tone: 'text-white' },
          { label: 'Profit Factor', value: plain(summary.profit_factor, 2), tone: 'text-white' },
          { label: isKo ? '평균 R' : 'Average R', value: signed(summary.average_r), tone: (summary.average_r || 0) >= 0 ? 'text-bull' : 'text-bear' },
        ].map((item) => (
          <div key={item.label} className="border border-dark-700 bg-dark-950/70 p-3">
            <div className="text-[11px] text-dark-500">{item.label}</div>
            <div className={`mt-1 font-mono text-lg font-bold ${item.tone}`}>{item.value}</div>
            <div className="mt-1 text-[10px] text-dark-600">{direction.toUpperCase()} · n={summary.trade_count}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="border border-bear/30 bg-bear/5 p-4">
          <div className="text-[11px] font-medium text-bear">{isKo ? '가장 큰 문제' : 'Biggest problem'}</div>
          <div className="mt-2 text-base font-semibold text-white">{issueText}</div>
          <div className="mt-2 space-y-1 text-xs text-dark-400"><div>{isKo ? '전체 PF' : 'Overall PF'} <span className="float-right font-mono text-dark-200">{plain(summary.profit_factor, 2)}</span></div><div>{isKo ? '진입 불리 판정' : 'Poor entry'} <span className="float-right font-mono text-bear">{poorEntryCount}건</span></div></div>
        </div>
        <div className="border border-bull/30 bg-bull/5 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-bull"><TrendingUp className="h-3.5 w-3.5" />{isKo ? '가장 잘한 시장 상황' : 'Best market situation'}</div>
          <div className="mt-2 text-base font-semibold text-white">{summary.best_regime ? overviewRegimeLabel(summary.best_regime.id, isKo) : '-'}</div>
          <div className="mt-2 text-xs text-dark-400">{regimeLine(summary.best_regime)}</div>
        </div>
        <div className="border border-primary-400/30 bg-primary-500/5 p-4">
          <div className="text-[11px] font-medium text-primary-200">{isKo ? '청산 타이밍' : 'Exit timing'}</div>
          <div className="mt-2 text-base font-semibold text-white">{isKo ? `너무 일찍 ${plain(summary.early_exit_ratio_pct)}%` : `Early ${plain(summary.early_exit_ratio_pct)}%`}</div>
          <div className="mt-1 text-xs text-dark-400">{isKo ? `너무 늦게 ${plain(summary.late_exit_ratio_pct)}% · 수익 구간 포착 ${plain(summary.average_capture_ratio_pct)}%` : `Late ${plain(summary.late_exit_ratio_pct)} · capture ${plain(summary.average_capture_ratio_pct)}%`}</div>
          <div className="mt-2 text-[11px] text-amber-300">{earlyExitCount > lateExitCount ? (isKo ? '조기 청산을 먼저 점검하세요.' : 'Review early exits first.') : (isKo ? '지연 청산을 먼저 점검하세요.' : 'Review late exits first.')}</div>
        </div>
      </div>

      <div className="border border-dark-700 bg-dark-900/25 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-bear"><TrendingDown className="h-3.5 w-3.5" />{isKo ? '가장 손실이 큰 시장 상황' : 'Worst market situation'}</div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><span className="text-base font-semibold text-white">{summary.worst_regime ? overviewRegimeLabel(summary.worst_regime.id, isKo) : '-'}</span><span className="font-mono text-sm text-bear">{regimeLine(summary.worst_regime)}</span></div>
      </div>
      {isError && <div className="text-[11px] text-amber-300">{isKo ? '최신 갱신에 실패해 이전 분석 결과를 표시할 수 있습니다.' : 'The latest refresh failed; the previous analysis may be shown.'}</div>}
    </section>
  );
}

function qualityLabel(item: TradeQualityItem | undefined, isKo: boolean): string {
  if (!item) return '-';
  const labels: Record<string, string> = {
    good_entry_good_exit: '진입·청산 양호',
    good_entry_early_exit: '진입 양호·조기 청산',
    good_entry_late_exit: '진입 양호·늦은 청산',
    poor_entry: '진입 불리',
    unavailable: '판정 불가',
  };
  return isKo ? labels[item.quality_class] || item.quality_class : item.quality_class.replace(/_/g, ' ');
}

function TradeEvidenceList({
  request,
  trades,
  qualityItems,
  entries,
  isKo,
  onClose,
}: {
  request: EvidenceRequest;
  trades: AnalyzedTrade[];
  qualityItems: TradeQualityItem[];
  entries: JournalEntry[];
  isKo: boolean;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const qualityById = useMemo(() => new Map(qualityItems.map((item) => [item.journal_id, item])), [qualityItems]);
  const rows = useMemo(() => trades
    .filter((trade) => trade.entry.id != null && request.tradeIds.includes(trade.entry.id))
    .sort((left, right) => new Date(right.entry.datetime || right.entry.entry_datetime || 0).getTime() - new Date(left.entry.datetime || left.entry.entry_datetime || 0).getTime()), [request.tradeIds, trades]);
  const selectedTrade = selectedId == null ? undefined : rows.find((trade) => trade.entry.id === selectedId);
  const selectedQuality = selectedId == null ? undefined : qualityById.get(selectedId);

  return (
    <section className="border border-primary-400/30 bg-primary-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{request.title}</h3>
          <div className="mt-0.5 text-[11px] text-dark-400">{request.filterLabel}</div>
          <div className="mt-1 text-[11px] text-dark-500">{isKo ? '거래를 누르면 해당 1건의 차트 복기를 엽니다.' : 'Select a trade to open its single-trade review.'}</div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-dark-400 hover:text-white">{isKo ? '닫기' : 'Close'}</button>
      </div>
      <div className="mt-3 hidden max-h-96 overflow-auto md:block">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '날짜' : 'Date'}</th><th className="py-2 text-left">{isKo ? '거래' : 'Trade'}</th><th className="py-2 text-right">{isKo ? '수익률' : 'Return'}</th><th className="py-2 text-right">PnL</th><th className="py-2 text-right">{isKo ? '최대 이익' : 'MFE'}</th><th className="py-2 text-right">{isKo ? '최대 불리' : 'MAE'}</th><th className="py-2 text-right">{isKo ? '판정' : 'Judgment'}</th></tr></thead>
          <tbody>{rows.map((trade) => {
            const entry = trade.entry;
            const quality = entry.id == null ? undefined : qualityById.get(entry.id);
            return <tr key={entry.id} className="border-b border-dark-800 hover:bg-dark-900/50">
              <td className="py-2 text-dark-300">{entry.datetime || entry.entry_datetime ? toDateInputValue(new Date(entry.datetime || entry.entry_datetime || '')) : '-'}</td>
              <td className="py-2 text-dark-200">{entry.symbol || '-'} · {entry.direction || '-'}</td>
              <td className={`py-2 text-right font-mono ${(netReturnPct(entry) || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(netReturnPct(entry))}%</td>
              <td className={`py-2 text-right font-mono ${(entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(entry.realized_pnl)} USDT</td>
              <td className="py-2 text-right font-mono text-bull">{plain(trade.excursion?.mfe_pct)}%</td>
              <td className="py-2 text-right font-mono text-bear">{plain(trade.excursion?.mae_pct)}%</td>
              <td className="py-2 text-right"><button type="button" onClick={() => setSelectedId(entry.id as number)} className="text-primary-200 hover:text-white">{qualityLabel(quality, isKo)} · {isKo ? '보기 →' : 'Open →'}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto md:hidden">
        {rows.map((trade) => {
          const entry = trade.entry;
          const quality = entry.id == null ? undefined : qualityById.get(entry.id);
          return <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id as number)} className="w-full border border-dark-700 bg-dark-950/60 p-3 text-left hover:border-primary-400/50">
            <div className="flex items-start justify-between gap-2"><span className="text-xs text-dark-200">{entry.symbol || '-'} · {entry.direction || '-'}</span><span className={`font-mono text-xs ${(entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(entry.realized_pnl)} USDT</span></div>
            <div className="mt-1 text-[11px] text-dark-500">{entry.datetime || entry.entry_datetime ? toDateInputValue(new Date(entry.datetime || entry.entry_datetime || '')) : '-'} · {qualityLabel(quality, isKo)}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]"><span className="text-dark-400">{isKo ? '수익률' : 'Return'} <b className="ml-1 font-mono text-dark-200">{signed(netReturnPct(entry))}%</b></span><span className="text-dark-400">MFE <b className="ml-1 font-mono text-bull">{plain(trade.excursion?.mfe_pct)}%</b></span><span className="text-dark-400">MAE <b className="ml-1 font-mono text-bear">{plain(trade.excursion?.mae_pct)}%</b></span></div>
          </button>;
        })}
      </div>
      {rows.length === 0 && <div className="py-6 text-center text-xs text-dark-500">{isKo ? '표시할 거래가 없습니다.' : 'No matching trades.'}</div>}
      {selectedTrade && <TradeReportModal entry={selectedTrade.entry} allEntries={entries} excursion={selectedTrade.excursion} qualityItem={selectedQuality} isKo={isKo} onClose={() => setSelectedId(null)} />}
    </section>
  );
}

function TradeQuality({
  trades,
  qualityItems,
  isKo,
  isLoading,
  onSelectEvidence,
}: {
  trades: AnalyzedTrade[];
  qualityItems: TradeQualityItem[];
  isKo: boolean;
  isLoading: boolean;
  onSelectEvidence?: (kind: EvidenceKind, value: string, journalIds: number[]) => void;
}) {
  const withExcursion = trades.filter((trade) => trade.excursion);
  const qualityById = new Map(qualityItems.map((item) => [item.journal_id, item]));
  const classified = withExcursion.flatMap((trade) => {
    const quality = trade.entry.id == null ? null : qualityById.get(trade.entry.id) || null;
    return quality ? [{ trade, quality }] : [];
  });
  const exitMisses = classified.filter(({ quality }) => (
    quality.quality_class === 'good_entry_early_exit'
    || quality.quality_class === 'good_entry_late_exit'
  ));
  const poorEntries = classified.filter(({ quality }) => quality.quality_class === 'poor_entry');
  const poorEntryIds = poorEntries.map(({ trade }) => trade.entry.id).filter((id): id is number => id != null);
  const maeGreaterIds = withExcursion
    .filter((trade) => (trade.excursion?.mae_pct || 0) > (trade.excursion?.mfe_pct || 0))
    .map((trade) => trade.entry.id)
    .filter((id): id is number => id != null);
  const rows = [...exitMisses, ...poorEntries]
    .sort((a, b) => {
      const aTime = a.trade.entry.datetime ? new Date(a.trade.entry.datetime).getTime() : 0;
      const bTime = b.trade.entry.datetime ? new Date(b.trade.entry.datetime).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.trade.entry.id || 0) - (a.trade.entry.id || 0);
    })
    .slice(0, 10);
  const qualitySummary = performanceSummary(trades);

  return (
    <section className="border border-dark-700 bg-dark-900/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">진입 후 가격 흐름</h2>
          <div className="mt-0.5 text-[11px] text-dark-500">
            {isKo ? '15분봉 · 15분 미만 거래는 완성된 1분봉으로 보완' : '15m candles · completed 1m candles for trades shorter than 15 minutes'}
          </div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-dark-400" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-y border-dark-800 py-2 text-xs text-dark-400">
        <span>{isKo ? '계산 가능' : 'Available'} <strong className="font-mono text-dark-200">{withExcursion.length}/{trades.length}</strong></span>
        <span>{isKo ? '진입 후 최대 유리폭' : 'Maximum favorable move'} <strong className="font-mono text-bull">+{plain(qualitySummary.averageMfePct)}%</strong></span>
        <span>{isKo ? '진입 후 최대 불리폭' : 'Maximum adverse move'} <strong className="font-mono text-bear">-{plain(qualitySummary.averageMaePct)}%</strong></span>
        <span>{isKo ? '종료 아쉬움' : 'Exit Miss'} <strong className="font-mono text-amber-300">{exitMisses.length}</strong></span>
        <span>{isKo ? '진입 불리' : 'Poor Entry'} <strong className="font-mono text-bear">{poorEntries.length}</strong></span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSelectEvidence?.('poor_entry', 'poor_entry', poorEntryIds)} className="border border-bear/30 px-2.5 py-1.5 text-[11px] text-bear hover:border-bear/70">{isKo ? `진입 불리 거래 보기 (${poorEntryIds.length})` : `View poor entries (${poorEntryIds.length})`}</button>
        <button type="button" onClick={() => onSelectEvidence?.('mae_greater', 'mae_greater', maeGreaterIds)} className="border border-amber-300/30 px-2.5 py-1.5 text-[11px] text-amber-200 hover:border-amber-200/70">{isKo ? `불리한 움직임이 더 컸던 거래 보기 (${maeGreaterIds.length})` : `View MAE > MFE (${maeGreaterIds.length})`}</button>
      </div>
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-dark-500">
              <tr className="border-b border-dark-700">
                <th className="py-2 text-left">{isKo ? '거래' : 'Trade'}</th>
                <th className="py-2 text-left">{isKo ? '분류' : 'Class'}</th>
                <th className="py-2 text-right">{isKo ? '최대 유리폭' : 'Max favorable'}</th>
                <th className="py-2 text-right">{isKo ? '최대 불리폭' : 'Max adverse'}</th>
                <th className="py-2 text-right">{isKo ? '실제 가격 움직임' : 'Realized Move'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trade, quality }) => (
                <tr key={trade.entry.id} className="border-b border-dark-800">
                  <td className="py-2 text-dark-200">
                    {trade.entry.symbol} · {trade.entry.direction} · {trade.entry.datetime ? toDateInputValue(new Date(trade.entry.datetime)) : '-'}
                  </td>
                  <td className={`py-2 ${quality.quality_class === 'poor_entry' ? 'text-bear' : 'text-amber-300'}`}>
                    {quality.quality_class === 'poor_entry'
                      ? isKo ? '진입 불리' : 'Poor Entry'
                      : quality.quality_class === 'good_entry_early_exit'
                        ? isKo ? '진입 양호·너무 빠른 종료' : 'Good Entry · Early Exit'
                        : isKo ? '진입 양호·너무 늦은 종료' : 'Good Entry · Late Exit'}
                  </td>
                  <td className="py-2 text-right font-mono text-bull">{plain(trade.excursion?.mfe_pct)}%</td>
                  <td className="py-2 text-right font-mono text-bear">{plain(trade.excursion?.mae_pct)}%</td>
                  <td className="py-2 text-right font-mono">{signed(trade.excursion?.realized_move_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function TradeAnalysisPage() {
  const isKo = useLanguage() === 'ko';
  const selectedCoin = useSelectedCoin();
  const [period, setPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_ANALYSIS_DAYS));
  const [draftPeriod, setDraftPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_ANALYSIS_DAYS));
  const [usesRollingPeriod, setUsesRollingPeriod] = useState(true);
  const [mode, setMode] = useState<AnalysisMode>('compare');
  const [direction, setDirection] = useState<DirectionFilter>('Long');
  const [activeSection, setActiveSection] = useState<AnalysisSection>('overview');
  const [evidenceRequest, setEvidenceRequest] = useState<EvidenceRequest | null>(null);
  const [returnRange, setReturnRange] = useState<ReturnRangeId>('all');
  const [timeframe, setTimeframe] = useState<AnalysisTimeframe>('4h');
  const [minimumAbsNetReturnPct, setMinimumAbsNetReturnPct] = useState(0);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [selectedBehaviorTradeId, setSelectedBehaviorTradeId] = useState<number | null>(null);

  const lastDailyRefreshDateRef = useRef(toDateInputValue(new Date()));
  const { data: entries = [], isLoading: isJournalLoading, isError: isJournalError, refetch: refetchJournal } = useQuery({
    queryKey: journalQueryKeys.entries,
    queryFn: getJournal,
  });
  const startTime = dateBoundaryTimestamp(period.start);
  const endTime = dateBoundaryTimestamp(period.end, true);
  const qualityQuery = useQuery({
    queryKey: journalQueryKeys.qualityAnalysis(startTime, endTime, minimumAbsNetReturnPct),
    queryFn: () => getJournalQualityAnalysis({
      start_time: startTime as number,
      end_time: endTime as number,
      min_abs_net_return_pct: minimumAbsNetReturnPct,
    }),
    enabled: startTime != null && endTime != null && startTime <= endTime,
    staleTime: 30 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_500 * 2 ** attempt, 6_000),
    refetchOnWindowFocus: true,
  });
  const behaviorQuery = useQuery({
    queryKey: journalQueryKeys.behaviorAnalysis(startTime, endTime, minimumAbsNetReturnPct),
    queryFn: () => getJournalBehaviorAnalysis({
      start_time: startTime as number,
      end_time: endTime as number,
      min_abs_net_return_pct: minimumAbsNetReturnPct,
    }),
    enabled: startTime != null && endTime != null && startTime <= endTime,
    staleTime: 30 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_500 * 2 ** attempt, 6_000),
    refetchOnWindowFocus: true,
  });
  const { refetch: refetchQualityAnalysis } = qualityQuery;
  const { refetch: refetchBehaviorAnalysis } = behaviorQuery;
  const refreshDaily = useCallback(() => {
    lastDailyRefreshDateRef.current = toDateInputValue(new Date());
    void refetchJournal();
    if (usesRollingPeriod) {
      const next = buildJournalPeriod(DEFAULT_ANALYSIS_DAYS);
      setDraftPeriod(next);
      setPeriod(next);
    } else {
      void refetchQualityAnalysis();
      void refetchBehaviorAnalysis();
    }
  }, [refetchBehaviorAnalysis, refetchJournal, refetchQualityAnalysis, usesRollingPeriod]);

  useEffect(() => {
    let timeoutId: number;

    const scheduleNextRefresh = () => {
      timeoutId = window.setTimeout(() => {
        refreshDaily();
        scheduleNextRefresh();
      }, millisecondsUntilNextLocalDay());
    };
    const refreshOnVisible = () => {
      const today = toDateInputValue(new Date());
      if (document.visibilityState === 'visible' && today !== lastDailyRefreshDateRef.current) {
        refreshDaily();
      }
    };

    scheduleNextRefresh();
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [refreshDaily]);

  const periodEntries = useMemo(
    () => entries.filter((entry) => isJournalEntryWithinPeriod(entry, period)),
    [entries, period],
  );
  const analysisEntries = useMemo(() => periodEntries.filter((entry) => {
    if (minimumAbsNetReturnPct <= 0) return true;
    const returnPct = netReturnPct(entry);
    return returnPct != null && Math.abs(returnPct) > minimumAbsNetReturnPct;
  }), [minimumAbsNetReturnPct, periodEntries]);
  const allTrades = useMemo(() => {
    const periodIds = new Set(analysisEntries.map((entry) => entry.id));
    const excursions = qualityQuery.data?.items
      .map((item) => item.excursion)
      .filter((item): item is NonNullable<typeof item> => item != null) || [];
    return buildAnalyzedTrades(entries, excursions)
      .filter((trade) => periodIds.has(trade.entry.id));
  }, [analysisEntries, entries, qualityQuery.data?.items]);
  const directionTrades = allTrades.filter((trade) => trade.entry.direction === direction);
  const rangeTrades = filterTradesByReturnRange(directionTrades, returnRange);
  const selectedTrades = mode === 'wins'
    ? rangeTrades.filter((trade) => (trade.entry.realized_pnl || 0) > 0)
    : mode === 'losses'
      ? rangeTrades.filter((trade) => (trade.entry.realized_pnl || 0) < 0)
      : rangeTrades;
  const comparisons = indicatorComparisons(rangeTrades, timeframe);
  const averages = indicatorAverages(selectedTrades, timeframe);
  const conditions = conditionComparisons(rangeTrades, timeframe);
  const winnerConditions = conditions.filter((item) => item.difference > 0).slice(0, 5);
  const loserConditions = conditions.filter((item) => item.difference < 0).slice(0, 5);
  const snapshotCoverage = selectedTrades.filter((trade) => trade.entrySnapshot?.timeframes?.[timeframe]?.status === 'complete').length;
  const selectedBehaviorEntry = selectedBehaviorTradeId == null
    ? undefined
    : entries.find((entry) => entry.id === selectedBehaviorTradeId);
  const openEvidence = useCallback((kind: EvidenceKind, value: string, tradeIds: number[]) => {
    const labels: Record<EvidenceKind, string> = {
      regime: overviewRegimeLabel(value, isKo),
      early_exit: isKo ? '조기 청산' : 'Early exit',
      late_exit: isKo ? '늦은 청산' : 'Late exit',
      hold2: isKo ? '+2개 4H 보유가 더 나았던 거래' : 'Better after +2 4H holding',
      condition: value,
      poor_entry: isKo ? '진입 불리' : 'Poor entry',
      mae_greater: isKo ? '불리한 움직임이 더 컸던 거래' : 'MAE greater than MFE',
    };
    const label = labels[kind];
    setEvidenceRequest({
      title: isKo ? `${label} 근거 거래` : `${label} supporting trades`,
      filterLabel: `${label} · ${direction.toUpperCase()} · ${period.start} ~ ${period.end} · ${tradeIds.length}${isKo ? '건' : ' trades'}`,
      tradeIds: [...new Set(tradeIds)],
    });
  }, [direction, isKo, period.end, period.start]);

  const applyRollingPeriod = () => {
    const next = buildJournalPeriod(DEFAULT_ANALYSIS_DAYS);
    setUsesRollingPeriod(true);
    setDraftPeriod(next);
    setPeriod(next);
    setPeriodError(null);
  };
  const applyCustom = () => {
    const start = dateBoundaryTimestamp(draftPeriod.start);
    const end = dateBoundaryTimestamp(draftPeriod.end, true);
    const todayEnd = dateBoundaryTimestamp(toDateInputValue(new Date()), true);
    if (start == null || end == null || start > end || (todayEnd != null && end > todayEnd)) {
      setPeriodError(isKo ? '유효한 과거 기간을 선택하세요.' : 'Choose a valid historical period.');
      return;
    }
    setPeriod(draftPeriod);
    setUsesRollingPeriod(false);
    setPeriodError(null);
  };

  const modes: Array<{ id: AnalysisMode; label: string }> = [
    { id: 'all', label: isKo ? '전체' : 'All' },
    { id: 'wins', label: isKo ? '승리 거래' : 'Wins' },
    { id: 'losses', label: isKo ? '패배 거래' : 'Losses' },
    { id: 'compare', label: isKo ? '승 vs 패' : 'Wins vs Losses' },
  ];
  const directions: Array<{ id: DirectionFilter; label: string }> = [
    { id: 'Long', label: 'LONG' },
    { id: 'Short', label: 'SHORT' },
  ];
  const returnRanges: Array<{ id: ReturnRangeId; label: string }> = [
    { id: 'all', label: isKo ? '전체' : 'All' },
    { id: 'lt1', label: '< 1%' },
    { id: '1to5', label: '1 ~ 5%' },
    { id: '5to10', label: '5 ~ 10%' },
    { id: 'gte10', label: '10% +' },
  ];
  const sections: Array<{ id: AnalysisSection; label: string; description: string }> = [
    { id: 'overview', label: isKo ? '한눈에 보기' : 'Overview', description: isKo ? '핵심 결론과 극단 거래' : 'Key findings and outliers' },
    { id: 'entry', label: isKo ? '상세 거래 분석' : 'Detailed Analysis', description: isKo ? '시장 상황·진입·청산 근거' : 'Regime, entry and exit evidence' },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            {isKo ? `매매 분석 · ${activeSection === 'overview' ? '한눈에 보기' : '상세 거래 분석'}` : `Trade Analysis · ${activeSection === 'overview' ? 'Overview' : 'Detailed Analysis'}`}
          </h1>
          <div className="mt-1 text-xs text-dark-500">{direction.toUpperCase()} · {period.start} ~ {period.end} · {isKo ? '시장 데이터: Binance USDT-M Futures' : 'Market data: Binance USDT-M Futures'}</div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={applyRollingPeriod} className="border border-dark-700 bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:text-white">
            {DEFAULT_ANALYSIS_DAYS}{isKo ? '일' : 'D'}
          </button>
          <input type="date" max={toDateInputValue(new Date())} value={draftPeriod.start} onChange={(event) => setDraftPeriod((current) => ({ ...current, start: event.target.value }))} className="border border-dark-700 bg-dark-800 px-2 py-2 text-xs" aria-label={isKo ? '분석 시작일' : 'Analysis start date'} />
          <input type="date" max={toDateInputValue(new Date())} value={draftPeriod.end} onChange={(event) => setDraftPeriod((current) => ({ ...current, end: event.target.value }))} className="border border-dark-700 bg-dark-800 px-2 py-2 text-xs" aria-label={isKo ? '분석 종료일' : 'Analysis end date'} />
          <label className="flex h-9 items-center gap-1 border border-dark-700 bg-dark-800 px-2 text-xs text-dark-300">
            <span>{isKo ? '최소 순수익률' : 'Min. net return'}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={minimumAbsNetReturnPct}
              onChange={(event) => setMinimumAbsNetReturnPct(Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
              className="w-12 bg-transparent text-right font-mono text-dark-100 outline-none"
              aria-label={isKo ? '분석에서 제외할 최소 절대 순수익률' : 'Minimum absolute net return to include in analysis'}
            />
            <span>%</span>
          </label>
          <button type="button" onClick={applyCustom} className="btn-primary px-3 py-2 text-xs">{isKo ? '적용' : 'Apply'}</button>
        </div>
      </header>
      {periodError && <div className="text-xs text-bear">{periodError}</div>}
      {minimumAbsNetReturnPct > 0 && (
        <div className="text-xs text-dark-400">
          {isKo ? `투입금 대비 순수익률 절대값이 ${minimumAbsNetReturnPct}% 이하인 종료 거래는 분석에서 제외합니다.` : `Closed trades at or below ${minimumAbsNetReturnPct}% absolute net return on invested margin are excluded.`}
          {qualityQuery.data?.return_filter && ` ${isKo ? `분석 ${qualityQuery.data.return_filter.included_count}/${qualityQuery.data.return_filter.candidate_count}건` : `${qualityQuery.data.return_filter.included_count}/${qualityQuery.data.return_filter.candidate_count} trades included`}`}
        </div>
      )}
      {isJournalError && (
        <div className="flex items-center gap-3 border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-xs text-amber-200">
          <span>{isKo ? '거래 기록을 불러오지 못했습니다. 분석 결과가 불완전할 수 있습니다.' : 'Trade history could not be loaded; analysis may be incomplete.'}</span>
          <button type="button" onClick={() => void refetchJournal()} className="border border-amber-300/40 px-2 py-1">{isKo ? '재시도' : 'Retry'}</button>
        </div>
      )}

      <nav className="grid grid-cols-2 border border-dark-700 bg-dark-900/35 p-1" aria-label={isKo ? '매매 분석 섹션' : 'Trade analysis sections'}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => { setActiveSection(section.id); setEvidenceRequest(null); }}
            className={`min-h-10 px-3 text-xs font-medium transition-colors ${activeSection === section.id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}
          >
            <span className="block">{section.label}</span>
            <span className="mt-0.5 block text-[10px] font-normal opacity-70">{section.description}</span>
          </button>
        ))}
      </nav>

      <section className="flex flex-wrap items-center justify-between gap-3 border-y border-dark-700 py-2">
        <div><div className="text-xs font-medium text-dark-200">{isKo ? '분석 방향' : 'Analysis Direction'}</div><div className="mt-0.5 text-[10px] text-dark-500">{isKo ? '아래 진입·청산 품질 통계에 적용' : 'Applied to entry and exit quality statistics'}</div></div>
        <div className="grid w-full max-w-64 grid-cols-2 border border-dark-700 bg-dark-900/35 p-1" aria-label={isKo ? '거래 방향' : 'Trade direction'}>
          {directions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDirection(item.id)}
              className={`min-h-9 px-2 text-xs font-medium transition-colors ${direction === item.id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {activeSection === 'overview' && <OverviewSummary
        data={qualityQuery.data}
        isLoading={qualityQuery.isLoading || qualityQuery.isFetching}
        isError={qualityQuery.isError}
        isKo={isKo}
        direction={direction}
        onRetry={() => void qualityQuery.refetch()}
      />}

      {activeSection === 'overview' && <BehaviorLeakSummary
        data={behaviorQuery.data}
        isLoading={behaviorQuery.isLoading}
        isError={behaviorQuery.isError}
        isKo={isKo}
        onRetry={() => void behaviorQuery.refetch()}
        onSelectTrade={setSelectedBehaviorTradeId}
      />}

      {activeSection === 'overview' && <MajorSuccessAnalysis
        trades={allTrades}
        qualityItems={qualityQuery.data?.items || []}
        allEntries={entries}
        isLoading={isJournalLoading || qualityQuery.isLoading}
        isKo={isKo}
      />}

      {activeSection === 'overview' && <MajorFailureAnalysis
        trades={allTrades}
        qualityItems={qualityQuery.data?.items || []}
        allEntries={entries}
        isLoading={isJournalLoading || qualityQuery.isLoading}
        isKo={isKo}
      />}

      {activeSection === 'overview' && <button
        type="button"
        onClick={() => setActiveSection('entry')}
        className="flex w-full items-center justify-between border border-primary-400/30 bg-primary-500/5 px-4 py-3 text-left text-sm text-primary-100 hover:border-primary-300/60 hover:bg-primary-500/10"
      >
        <span>{isKo ? '왜 이런 결론이 나왔는지 상세히 보기' : 'See why these conclusions were reached'}</span>
        <ArrowRight className="h-4 w-4" />
      </button>}

      {activeSection === 'entry' && <>
        <CurrentMarketSimilarityPanel
          coin={selectedCoin}
          allEntries={entries}
          trades={allTrades}
          qualityItems={qualityQuery.data?.items || []}
          isHistoryLoading={isJournalLoading || qualityQuery.isLoading}
          isKo={isKo}
        />
        <TradeQualityAnalysis
          data={qualityQuery.data}
          isLoading={qualityQuery.isLoading || qualityQuery.isFetching}
          isError={qualityQuery.isError}
          isKo={isKo}
          direction={direction}
          onRetry={() => void qualityQuery.refetch()}
          showOverview={false}
          onSelectEvidence={openEvidence}
        />
        <TradeExitReviewList
          entries={entries}
          qualityItems={qualityQuery.data?.items || []}
          direction={direction}
          isKo={isKo}
        />
        {evidenceRequest && <TradeEvidenceList
          request={evidenceRequest}
          trades={allTrades}
          qualityItems={qualityQuery.data?.items || []}
          entries={entries}
          isKo={isKo}
          onClose={() => setEvidenceRequest(null)}
        />}
        <TradeBehaviorAnalysis
          data={behaviorQuery.data}
          isLoading={behaviorQuery.isLoading}
          isError={behaviorQuery.isError}
          startTime={startTime as number}
          endTime={endTime as number}
          minimumAbsNetReturnPct={minimumAbsNetReturnPct}
          isKo={isKo}
          onRetry={() => void behaviorQuery.refetch()}
          onSelectTrade={setSelectedBehaviorTradeId}
        />
      </>}

      {activeSection === 'entry' && <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between border border-dark-700 bg-dark-900/30 px-4 py-3 hover:bg-dark-900/50">
          <span className="flex items-center gap-2 text-sm font-medium text-dark-200"><SlidersHorizontal className="h-4 w-4 text-primary-300" />{isKo ? '승패·보조지표 상세' : 'Win/Loss and Indicator Details'}</span>
          <span className="flex items-center gap-2 text-[11px] text-dark-500">{direction.toUpperCase()} · {rangeTrades.length}{isKo ? '건' : ' trades'} · {timeframe.toUpperCase()}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-4 border border-dark-700 bg-dark-900/35 p-1">
        {modes.map((item) => (
          <button key={item.id} type="button" onClick={() => setMode(item.id)} className={`min-h-9 px-2 text-xs font-medium transition-colors ${mode === item.id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}>
            {item.label}
          </button>
        ))}
          </div>

          <div className="border border-dark-700 bg-dark-900/20 p-3">
        <div className="mb-2 text-[11px] text-dark-500">
          {isKo ? '분석 대상 수익률 구간 · 투자금 대비 순수익률 절대값' : 'Analysis return range · absolute return on invested margin'}
        </div>
        <div className="grid grid-cols-5 border border-dark-700 bg-dark-900/35 p-1">
          {returnRanges.map((item) => (
            <button key={item.id} type="button" onClick={() => setReturnRange(item.id)} className={`min-h-8 px-1 text-xs font-medium transition-colors ${returnRange === item.id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}>
              {item.label}
            </button>
          ))}
        </div>
          </div>

          {isJournalLoading ? (
        <div className="flex h-48 items-center justify-center text-dark-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '거래 데이터 로딩 중' : 'Loading trades'}</div>
          ) : (
        <>
          {mode === 'compare' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="border border-bull/30 bg-bull/5 p-4">
                <h2 className="text-sm font-semibold text-bull">{isKo ? '승리 거래에서 자주 나타난 조건' : 'Conditions More Common in Wins'}</h2>
                <div className="mt-3 space-y-2">{winnerConditions.map((item) => {
                  const matching = filterTradesByCondition(rangeTrades, timeframe, item.id);
                  return <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"><span className="text-dark-200">{timeframe.toUpperCase()} · {item.label}</span><span className="flex items-center gap-2 font-mono text-bull">{item.winFrequency.toFixed(0)}% / {item.lossFrequency.toFixed(0)}% <span className="text-dark-500">({signed(item.difference, 0)}%p · n={item.winCount}/{item.lossCount})</span><button type="button" onClick={() => openEvidence('condition', item.label, matching.map((trade) => trade.entry.id).filter((id): id is number => id != null))} className="font-sans text-[10px] text-primary-200 hover:text-white">{isKo ? `거래 보기 ${matching.length} →` : `View ${matching.length} →`}</button></span></div>;
                })}</div>
              </section>
              <section className="border border-bear/30 bg-bear/5 p-4">
                <h2 className="text-sm font-semibold text-bear">{isKo ? '패배 거래에서 자주 나타난 조건' : 'Conditions More Common in Losses'}</h2>
                <div className="mt-3 space-y-2">{loserConditions.map((item) => {
                  const matching = filterTradesByCondition(rangeTrades, timeframe, item.id);
                  return <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"><span className="text-dark-200">{timeframe.toUpperCase()} · {item.label}</span><span className="flex items-center gap-2 font-mono text-bear">{item.winFrequency.toFixed(0)}% / {item.lossFrequency.toFixed(0)}% <span className="text-dark-500">({signed(item.difference, 0)}%p · n={item.winCount}/{item.lossCount})</span><button type="button" onClick={() => openEvidence('condition', item.label, matching.map((trade) => trade.entry.id).filter((id): id is number => id != null))} className="font-sans text-[10px] text-primary-200 hover:text-white">{isKo ? `거래 보기 ${matching.length} →` : `View ${matching.length} →`}</button></span></div>;
                })}</div>
              </section>
            </div>
          )}

          <section className="border border-dark-700 bg-dark-900/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">{isKo ? '진입 당시 보조지표' : 'Entry Indicators'}</h2>
                <div className="mt-0.5 text-[11px] text-dark-500">{isKo ? `체결 직전 완료봉 · 데이터 ${snapshotCoverage}/${selectedTrades.length}건` : `Last completed candle before fill · ${snapshotCoverage}/${selectedTrades.length} available`}</div>
              </div>
              <div className="grid grid-cols-4 border border-dark-700 bg-dark-900/40 p-1">
                {ANALYSIS_TIMEFRAMES.map((item) => (
                  <button key={item} type="button" onClick={() => setTimeframe(item)} className={`px-3 py-1.5 text-xs ${timeframe === item ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400'}`}>{item.toUpperCase()}</button>
                ))}
              </div>
            </div>

            {mode === 'compare' ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '지표' : 'Indicator'}</th><th className="py-2 text-right">{isKo ? '승리 평균' : 'Win Avg'}</th><th className="py-2 text-right">{isKo ? '패배 평균' : 'Loss Avg'}</th><th className="py-2 text-right">{isKo ? '차이' : 'Difference'}</th><th className="py-2 text-right">{isKo ? '표본' : 'Samples'}</th></tr></thead>
                  <tbody>{comparisons.map((row) => <tr key={row.id} className="border-b border-dark-800"><td className="py-2 text-dark-200">{row.label}{row.id.includes('distance') && ' (%)'}</td><td className="py-2 text-right font-mono text-bull">{plain(row.winAverage, 3)}</td><td className="py-2 text-right font-mono text-bear">{plain(row.lossAverage, 3)}</td><td className="py-2 text-right font-mono">{signed(row.difference, 3)}</td><td className="py-2 text-right font-mono text-dark-500">{row.winCount} / {row.lossCount}</td></tr>)}</tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 grid gap-x-6 md:grid-cols-2">
                {averages.map((row) => <div key={row.id} className="flex items-center justify-between border-b border-dark-800 py-2 text-xs"><span className="text-dark-300">{row.label}{row.id.includes('distance') && ' (%)'}</span><span className="font-mono text-white">{plain(row.average, 3)} <span className="text-dark-600">({row.count})</span></span></div>)}
              </div>
            )}
          </section>

          <TradeQuality
            trades={selectedTrades}
            qualityItems={qualityQuery.data?.items || []}
            isKo={isKo}
            isLoading={qualityQuery.isFetching}
            onSelectEvidence={openEvidence}
          />
          {(qualityQuery.isError || (qualityQuery.data?.warnings.length || 0) > 1) && <div className="text-xs text-amber-300">{isKo ? '일부 거래의 시장 데이터를 불러오지 못했습니다.' : 'Market data was unavailable for some trades.'}</div>}
        </>
          )}
        </div>
      </details>}
      {selectedBehaviorEntry && <TradeReportModal
        entry={selectedBehaviorEntry}
        allEntries={entries}
        qualityItem={qualityQuery.data?.items.find((item) => item.journal_id === selectedBehaviorEntry.id)}
        isKo={isKo}
        onClose={() => setSelectedBehaviorTradeId(null)}
        onBehaviorUpdated={() => {
          void refetchJournal();
          void refetchQualityAnalysis();
          void refetchBehaviorAnalysis();
        }}
      />}
    </div>
  );
}
