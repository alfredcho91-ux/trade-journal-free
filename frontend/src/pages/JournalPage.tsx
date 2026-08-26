// Trading Journal Page
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CandlestickChart, RefreshCw, Trash2 } from 'lucide-react';

import {
  deleteJournalEntry,
  getJournal,
  getJournalPerformance,
  getJournalQualityAnalysis,
  getPlanLab,
  syncExchange,
} from '../api/client';
import { useNavigate } from '../router-context';
import { useLanguage, useTradingStyle } from '../store/useStore';
import type { ExchangeId, JournalEntry, JournalPerformanceData, TradeQualityItem } from '../types';
import ExchangeConnectionModal from '../features/journal/ExchangeConnectionModal';
import JournalSyncPanel from '../features/journal/JournalSyncPanel';
import { isClosedPosition } from '../features/journal/journalEntries';
import {
  buildJournalPeriod,
  dateBoundaryTimestamp,
  isJournalEntryWithinPeriod,
  lookbackDaysFromStart,
  toDateInputValue,
  type JournalPeriod,
} from '../features/journal/journalPeriod';
import {
  netReturnPct,
} from '../features/journal/journalReturns';
import { journalDerivedQueryPrefixes, journalQueryKeys } from '../features/journal/journalQueryKeys';
import { useExchangeConnection } from '../features/journal/useExchangeConnection';
import TradeReportModal from '../features/journal/TradeReportModal';
import { tradeOutcomeAssessment } from '../features/journal/tradeOutcomeAssessment';
import { summarizeTradeStyle } from '../features/journal/tradeStyleSummary';
import { buildAnalyzedTrades } from '../features/tradeAnalysis/tradeAnalysis';
import DailyPnlCalendar from '../features/journal/DailyPnlCalendar';
import TradingStyleSelect from '../features/preferences/TradingStyleSelect';
import {
  TRADING_STYLE_CONFIGS,
  tradingStyleLabel,
  type JournalMetricId,
} from '../features/preferences/tradingStyle';

const VISIBLE_TRADE_INCREMENT = 12;

function formatSignedNumber(value: number | null | undefined, maximumFractionDigits = 4): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits })}`;
}

function formatHoldingMinutes(minutes: number | null, isKo: boolean): string {
  if (minutes == null || !Number.isFinite(minutes)) return '-';
  const totalMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (hours === 0) return isKo ? `${remainingMinutes}분` : `${remainingMinutes}m`;
  return isKo ? `${hours}시간 ${remainingMinutes}분` : `${hours}h ${remainingMinutes}m`;
}

function AnalysisMetric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'primary';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-bull'
      : tone === 'negative'
      ? 'text-bear'
      : tone === 'primary'
      ? 'text-primary-300'
      : 'text-white';

  return (
    <div className="border border-dark-700 bg-dark-900/45 p-3">
      <div className="text-[11px] text-dark-500">{label}</div>
      <div className={`mt-1 text-lg font-bold font-mono ${toneClass}`}>{value}</div>
      {detail != null && <div className="mt-1 text-[11px] text-dark-500">{detail}</div>}
    </div>
  );
}

function PlanLabSummary({ data, isKo, onOpen }: {
  data?: import('../types').PlanLabData;
  isKo: boolean;
  onOpen: () => void;
}) {
  const summary = data?.summary;
  return <section className="flex items-center justify-between gap-4 border border-dark-700 bg-dark-900/30 px-4 py-3">
    <div className="min-w-0">
      <div className="text-xs font-semibold text-dark-100">{isKo ? '계획 분석' : 'Plan Lab'}</div>
      {summary?.plan_recorded_count ? <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-dark-400">
        <span>{isKo ? '계획 입력' : 'Plan coverage'} <strong className="font-mono text-dark-100">{summary.plan_recorded_count}/{data?.coverage.closed_trades || 0}</strong></span>
        <span>Plan Exp <strong className="font-mono text-dark-100">{formatSignedNumber(summary.plan_expectancy_r, 2)}R</strong></span>
        <span>Actual <strong className="font-mono text-dark-100">{formatSignedNumber(summary.actual_expectancy_r, 2)}R</strong></span>
        <span>Δ <strong className={`font-mono ${(summary.execution_delta_r || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{formatSignedNumber(summary.execution_delta_r, 2)}R</strong></span>
      </div> : <div className="mt-1 text-[11px] text-dark-500">{isKo ? '사전 계획을 기록하면 계획 품질과 실행 이행도를 분석할 수 있습니다.' : 'Record pre-trade plans to analyze plan quality and execution adherence.'}</div>}
    </div>
    <button type="button" onClick={onOpen} className="shrink-0 text-xs text-primary-200 hover:text-white">{isKo ? 'Plan Lab에서 자세히 보기 →' : 'Open Plan Lab →'}</button>
  </section>;
}

function CumulativePnlChart({ trades, isKo }: { trades: JournalEntry[]; isKo: boolean }) {
  const ordered = [...trades].sort((a, b) => {
    const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
    const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
    return aTime - bTime;
  });

  let cumulative = 0;
  const values = [0];
  for (const trade of ordered) {
    cumulative += trade.realized_pnl || 0;
    values.push(cumulative);
  }

  const width = 900;
  const height = 190;
  const padX = 12;
  const padY = 14;
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const rawRange = maxValue - minValue;
  const range = rawRange === 0 ? 1 : rawRange;
  const xStep = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;
  const yFor = (value: number) => padY + ((maxValue - value) / range) * (height - padY * 2);
  const points = values.map((value, index) => `${padX + index * xStep},${yFor(value)}`).join(' ');
  const zeroY = yFor(0);
  const finalPnl = values[values.length - 1] || 0;

  return (
    <div className="border border-dark-700 bg-dark-900/35 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{isKo ? '누적 실현 PnL' : 'Cumulative Realized PnL'}</div>
          <div className="text-[11px] text-dark-500">
            {isKo ? '선택 기간의 종료 포지션을 종료시간 순으로 누적' : 'Closed positions accumulated by close time'}
          </div>
        </div>
        <div className={`font-mono text-lg font-bold ${finalPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
          {formatSignedNumber(finalPnl, 2)} USDT
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="flex h-44 items-center justify-center text-sm text-dark-500">
          {isKo ? '선택 기간에 분석할 종료 거래가 없습니다.' : 'No closed trades in the selected period.'}
        </div>
      ) : (
        <>
          <div className="relative h-48 w-full overflow-hidden">
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
              <line
                x1={padX}
                x2={width - padX}
                y1={zeroY}
                y2={zeroY}
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="5 5"
                className="text-dark-600"
              />
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
                className={finalPnl >= 0 ? 'text-bull' : 'text-bear'}
              />
            </svg>
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-dark-500">
            <span>{ordered[0]?.datetime ? new Date(ordered[0].datetime as string).toLocaleDateString() : '-'}</span>
            <span>
              {ordered[ordered.length - 1]?.datetime
                ? new Date(ordered[ordered.length - 1].datetime as string).toLocaleDateString()
                : '-'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function PeriodAnalysis({
  allEntries,
  closedEntries,
  qualityItems,
  isKo,
  instType,
  canSync,
  isSyncing,
  syncMessage,
  syncError,
  period,
  onSyncDays,
  onPeriodApply,
  performance,
}: {
  allEntries: JournalEntry[];
  closedEntries: JournalEntry[];
  qualityItems: TradeQualityItem[];
  isKo: boolean;
  instType: 'SWAP' | 'SPOT';
  canSync: boolean;
  isSyncing: boolean;
  syncMessage: string | null;
  syncError: unknown;
  period: JournalPeriod;
  onSyncDays: (days: number) => void;
  onPeriodApply: (period: JournalPeriod) => void;
  performance?: JournalPerformanceData;
}) {
  const selectedTradingStyle = useTradingStyle();
  const selectedStyleConfig = TRADING_STYLE_CONFIGS[selectedTradingStyle];
  const [initialPeriod] = useState(() => buildJournalPeriod());
  const [analysisStart, setAnalysisStart] = useState(initialPeriod.start);
  const [analysisEnd, setAnalysisEnd] = useState(initialPeriod.end);
  const [activePreset, setActivePreset] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [customError, setCustomError] = useState<string | null>(null);

  const applyPreset = (days: 7 | 30 | 90) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setAnalysisStart(toDateInputValue(start));
    setAnalysisEnd(toDateInputValue(end));
    setActivePreset(String(days) as '7' | '30' | '90');
    setCustomError(null);
    onPeriodApply({ start: toDateInputValue(start), end: toDateInputValue(end) });
    if (canSync) {
      onSyncDays(days);
    }
  };

  const applyCustomPeriod = () => {
    const startTs = dateBoundaryTimestamp(analysisStart);
    const endTs = dateBoundaryTimestamp(analysisEnd, true);
    const todayEndTs = dateBoundaryTimestamp(toDateInputValue(new Date()), true);
    if (startTs == null || endTs == null) {
      setCustomError(isKo ? '시작일과 종료일을 선택하세요.' : 'Choose both start and end dates.');
      return;
    }
    if (startTs > endTs) {
      setCustomError(isKo ? '시작일이 종료일보다 늦습니다.' : 'The start date is after the end date.');
      return;
    }
    if (todayEndTs != null && endTs > todayEndTs) {
      setCustomError(isKo ? '종료일은 오늘 이후로 설정할 수 없습니다.' : 'The end date cannot be after today.');
      return;
    }

    const lookbackDays = lookbackDaysFromStart(analysisStart);
    if (lookbackDays == null || lookbackDays < 1) {
      setCustomError(isKo ? '미래 날짜는 동기화할 수 없습니다.' : 'Future dates cannot be synchronized.');
      return;
    }
    setActivePreset('custom');
    onPeriodApply({ start: analysisStart, end: analysisEnd });
    if (lookbackDays > 90) {
      setCustomError(
        isKo
          ? '90일을 초과한 구간은 기존에 저장된 데이터만 분석합니다. 거래소 자동 동기화는 최근 90일까지 지원합니다.'
          : 'Periods beyond 90 days use already-saved data only; automatic exchange sync supports the most recent 90 days.',
      );
      return;
    }

    setCustomError(null);
    if (canSync) {
      onSyncDays(lookbackDays);
    }
  };

  const periodClosedEntries = closedEntries
    .filter((entry) => isJournalEntryWithinPeriod(entry, period))
    .sort((a, b) => {
      const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
      const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
      return aTime - bTime;
    });

  const analysisTrades = periodClosedEntries.filter(
    (entry) => typeof entry.realized_pnl === 'number' && Number.isFinite(entry.realized_pnl),
  );
  const periodNetReturn = performance?.net_return_pct ?? null;
  const netPnl = performance?.net_pnl ?? 0;
  const winRate = performance?.win_rate_pct ?? 0;
  const profitFactor = performance?.profit_factor ?? null;
  const averageWin = performance?.average_win ?? null;
  const averageLoss = performance?.average_loss ?? null;
  const expectancy = performance?.expectancy ?? null;
  const periodFeeImpact = performance?.fee_impact ?? 0;
  const periodFundingImpact = performance?.funding_impact ?? 0;
  const periodNetCostImpact = periodFeeImpact + periodFundingImpact;
  const longStats = performance?.directions.find((row) => row.id === 'Long');
  const shortStats = performance?.directions.find((row) => row.id === 'Short');
  const symbolRows = performance?.symbols || [];

  const inputStartTs = dateBoundaryTimestamp(analysisStart);
  const inputEndTs = dateBoundaryTimestamp(analysisEnd, true);
  const periodInvalid = inputStartTs != null && inputEndTs != null && inputStartTs > inputEndTs;
  const syncErrorText = syncError instanceof Error ? syncError.message : null;
  const periodAnalyzedTrades = useMemo(() => {
    const periodIds = new Set(periodClosedEntries.flatMap((entry) => entry.id == null ? [] : [entry.id]));
    return buildAnalyzedTrades(allEntries).filter((trade) => trade.entry.id != null && periodIds.has(trade.entry.id));
  }, [allEntries, periodClosedEntries]);
  const averageHoldingMinutes = useMemo(() => {
    const values = periodAnalyzedTrades.flatMap((trade) => (
      trade.holdingMinutes != null && Number.isFinite(trade.holdingMinutes) ? [trade.holdingMinutes] : []
    ));
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  }, [periodAnalyzedTrades]);
  const tradeStyle = useMemo(
    () => summarizeTradeStyle(periodAnalyzedTrades, qualityItems, isKo),
    [isKo, periodAnalyzedTrades, qualityItems],
  );
  const selectedStyleLabel = tradingStyleLabel(selectedTradingStyle, isKo);
  const metricCards: Record<JournalMetricId, React.ReactNode> = {
    netReturn: (
      <AnalysisMetric
        label={isKo ? '기간 순수익률' : 'Net Return'}
        value={periodNetReturn == null ? '-' : `${formatSignedNumber(periodNetReturn, 2)}%`}
        tone={(periodNetReturn || 0) >= 0 ? 'positive' : 'negative'}
        detail={`${performance?.return_sample_count || 0}${isKo ? '회 · 수수료·펀딩 반영' : ' trades · after fees/funding'}`}
      />
    ),
    netPnl: (
      <AnalysisMetric
        label={isKo ? '기간 순수익금' : 'Net Profit'}
        value={`${formatSignedNumber(netPnl, 2)} USDT`}
        tone={netPnl >= 0 ? 'positive' : 'negative'}
        detail={`${performance?.evaluated_trade_count || 0}${isKo ? '회 종료 거래 합계' : ' closed trades'}`}
      />
    ),
    winRate: (
      <AnalysisMetric
        label={isKo ? '승률' : 'Win Rate'}
        value={`${winRate.toFixed(1)}%`}
        tone="primary"
        detail={`${performance?.wins || 0}W · ${performance?.losses || 0}L · ${performance?.breakevens || 0}BE`}
      />
    ),
    profitFactor: (
      <AnalysisMetric
        label="Profit Factor"
        value={performance?.profit_factor_infinite ? '∞' : profitFactor == null ? '-' : profitFactor.toFixed(2)}
        detail={isKo ? '총이익 ÷ 총손실' : 'Gross profit / gross loss'}
      />
    ),
    averageWin: <AnalysisMetric label={isKo ? '평균 수익' : 'Avg Win'} value={`${formatSignedNumber(averageWin, 2)} USDT`} tone="positive" />,
    averageLoss: <AnalysisMetric label={isKo ? '평균 손실' : 'Avg Loss'} value={`${formatSignedNumber(averageLoss, 2)} USDT`} tone="negative" />,
    expectancy: (
      <AnalysisMetric
        label={isKo ? '거래당 기대값' : 'Expectancy / Trade'}
        value={`${formatSignedNumber(expectancy, 2)} USDT`}
        tone={(expectancy ?? 0) >= 0 ? 'positive' : 'negative'}
      />
    ),
    costImpact: (
      <AnalysisMetric
        label={isKo ? '비용 순효과' : 'Net Cost Impact'}
        value={`${formatSignedNumber(periodNetCostImpact, 2)} USDT`}
        tone={periodNetCostImpact >= 0 ? 'positive' : 'negative'}
        detail={`${isKo ? '수수료' : 'Fee'} ${formatSignedNumber(periodFeeImpact, 2)} · ${isKo ? '펀딩' : 'Funding'} ${formatSignedNumber(periodFundingImpact, 2)}`}
      />
    ),
    holdingTime: (
      <AnalysisMetric
        label={isKo ? '평균 보유 시간' : 'Average Holding Time'}
        value={formatHoldingMinutes(averageHoldingMinutes, isKo)}
        detail={isKo ? '선택 기간의 종료 거래 기준' : 'Based on closed trades in selected period'}
      />
    ),
  };

  return (
    <section className="card p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{isKo ? '기간 성과 분석' : 'Period Performance Analysis'}</h2>
          <p className="mt-1 text-xs text-dark-400">
            {isKo
              ? '기간을 선택하면 선택한 거래소 데이터를 동기화한 뒤 종료 포지션을 분석합니다.'
              : 'Choosing a period syncs the selected exchange and analyzes closed positions.'}
          </p>
          <div className="mt-1 text-[11px] text-dark-500">
            {period.start || '-'} ~ {period.end || '-'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TradingStyleSelect isKo={isKo} />
          {[7, 30, 90].map((days) => {
            const isActive = activePreset === String(days);
            return (
              <button
                key={days}
                type="button"
                onClick={() => applyPreset(days as 7 | 30 | 90)}
                disabled={isSyncing}
                className={`rounded-md border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? 'border-primary-500/60 bg-primary-500/15 text-primary-200'
                    : 'border-dark-700 bg-dark-800/50 text-dark-300 hover:border-dark-600 hover:text-white'
                }`}
              >
                {days}{isKo ? '일' : 'D'}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setActivePreset('custom');
              setCustomError(null);
            }}
            className={`rounded-md border px-3 py-2 text-xs transition-colors ${
              activePreset === 'custom'
                ? 'border-primary-500/60 bg-primary-500/15 text-primary-200'
                : 'border-dark-700 bg-dark-800/50 text-dark-300 hover:border-dark-600 hover:text-white'
            }`}
          >
            {isKo ? '직접 설정' : 'Custom'}
          </button>
        </div>
      </div>

      {activePreset === 'custom' && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border border-dark-700 bg-dark-900/35 p-3">
          <div>
            <div className="mb-1 text-[10px] text-dark-500">{isKo ? '시작일' : 'From'}</div>
            <input
              type="date"
              value={analysisStart}
              max={toDateInputValue(new Date())}
              onChange={(event) => setAnalysisStart(event.target.value)}
              className="bg-dark-700 border border-dark-600 rounded-md px-2.5 py-2 text-xs"
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] text-dark-500">{isKo ? '종료일' : 'To'}</div>
            <input
              type="date"
              value={analysisEnd}
              max={toDateInputValue(new Date())}
              onChange={(event) => setAnalysisEnd(event.target.value)}
              className="bg-dark-700 border border-dark-600 rounded-md px-2.5 py-2 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={applyCustomPeriod}
            disabled={isSyncing}
            className="btn-primary flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing
              ? isKo
                ? '동기화 중'
                : 'Syncing'
              : canSync
              ? isKo
                ? '적용·동기화'
                : 'Apply & Sync'
              : isKo
              ? '적용'
              : 'Apply'}
          </button>
          <span className="text-[10px] text-dark-500">
            {canSync
              ? isKo
                ? '90일 이내는 자동 동기화 · 초과 구간은 저장된 데이터만 분석'
                : 'Up to 90 days auto-syncs; longer periods use saved data only.'
              : isKo
              ? 'API 미연결 상태에서는 저장된 데이터만 분석'
              : 'Without API connection, analysis uses saved data only.'}
          </span>
        </div>
      )}

      {instType === 'SPOT' && (
        <div className="mt-3 border border-primary-500/20 bg-primary-500/5 p-2 text-[11px] text-primary-200">
          {isKo
            ? '현물은 매수·매도 체결을 기준으로 완료 거래를 재구성합니다.'
            : 'Spot trades are reconstructed from matched buy and sell fills.'}
        </div>
      )}

      {(customError || syncErrorText || syncMessage) && (
        <div
          className={`mt-3 text-xs ${customError || syncErrorText ? 'text-bear' : 'text-dark-300'}`}
        >
          {customError || syncErrorText || syncMessage}
        </div>
      )}

      {periodInvalid ? (
        <div className="mt-4 border border-bear/30 bg-bear/10 p-3 text-sm text-bear">
          {isKo ? '시작일이 종료일보다 늦습니다.' : 'The start date is after the end date.'}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-9">
            {selectedStyleConfig.journalMetricOrder.map((metricId) => (
              <div key={metricId} className="contents">{metricCards[metricId]}</div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 border-primary-400/60 bg-dark-900/25 px-3 py-2.5 text-sm leading-6 text-dark-200">
            <span className="font-bold text-primary-200">{isKo ? '매매 스타일' : 'Trading style'}</span>
            <span className="font-semibold text-dark-100">{selectedStyleLabel}</span>
            <span className="text-dark-600">·</span>
            <span className="text-xs font-medium text-dark-300 sm:text-sm">
              {tradeStyle.insufficientData
                ? (isKo ? '실제 거래 분석에 더 많은 거래가 필요합니다' : 'More completed trades are needed for observed-trade analysis.')
                : `${isKo ? '실제 거래' : 'Observed trades'}: ${tradeStyle.traits.join(' · ')}`}
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">LONG</div>
              <div className={`mt-2 font-mono text-xl font-bold ${(longStats?.net_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatSignedNumber(longStats?.net_pnl, 2)} USDT
              </div>
              <div className="mt-1 text-xs text-dark-500">
                {longStats?.trade_count || 0}{isKo ? '회' : ' trades'} · {isKo ? '승률' : 'win'} {(longStats?.win_rate_pct || 0).toFixed(1)}%
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">SHORT</div>
              <div className={`mt-2 font-mono text-xl font-bold ${(shortStats?.net_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatSignedNumber(shortStats?.net_pnl, 2)} USDT
              </div>
              <div className="mt-1 text-xs text-dark-500">
                {shortStats?.trade_count || 0}{isKo ? '회' : ' trades'} · {isKo ? '승률' : 'win'} {(shortStats?.win_rate_pct || 0).toFixed(1)}%
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">{isKo ? '최고 / 최악 거래' : 'Best / Worst Trade'}</div>
              <div className="mt-2 text-xs text-dark-400">
                <div className="flex justify-between gap-2">
                  <span>{performance?.best_trade?.symbol || '-'}</span>
                  <span className="font-mono text-bull">{performance?.best_trade ? `${formatSignedNumber(performance.best_trade.realized_pnl, 2)}` : '-'}</span>
                </div>
                <div className="mt-1 flex justify-between gap-2">
                  <span>{performance?.worst_trade?.symbol || '-'}</span>
                  <span className="font-mono text-bear">{performance?.worst_trade ? `${formatSignedNumber(performance.worst_trade.realized_pnl, 2)}` : '-'}</span>
                </div>
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">{isKo ? '연속 기록' : 'Streaks'}</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-dark-500">{isKo ? '최대 연승' : 'Max wins'}</div>
                  <div className="font-mono text-xl font-bold text-bull">{performance?.max_win_streak || 0}</div>
                </div>
                <div>
                  <div className="text-[10px] text-dark-500">{isKo ? '최대 연패' : 'Max losses'}</div>
                  <div className="font-mono text-xl font-bold text-bear">{performance?.max_loss_streak || 0}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.7fr,1fr]">
            <CumulativePnlChart trades={analysisTrades} isKo={isKo} />
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">{isKo ? '코인별 성과' : 'Performance by Symbol'}</div>
                  <div className="text-[11px] text-dark-500">{isKo ? '순손익 기준 정렬' : 'Sorted by net PnL'}</div>
                </div>
                <div className="text-[11px] text-dark-500">{symbolRows.length}{isKo ? '종목' : ' symbols'}</div>
              </div>
              {symbolRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-dark-500">-</div>
              ) : (
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-dark-500">
                      <tr className="border-b border-dark-700">
                        <th className="py-1.5 text-left">{isKo ? '심볼' : 'Symbol'}</th>
                        <th className="py-1.5 text-right">{isKo ? '거래' : 'Trades'}</th>
                        <th className="py-1.5 text-right">{isKo ? '승률' : 'Win'}</th>
                        <th className="py-1.5 text-right">PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {symbolRows.map((row) => (
                        <tr key={row.id} className="border-b border-dark-800">
                          <td className="py-2 text-dark-200">{row.id}</td>
                          <td className="py-2 text-right font-mono text-dark-300">{row.trade_count}</td>
                          <td className="py-2 text-right font-mono text-dark-300">{(row.win_rate_pct || 0).toFixed(0)}%</td>
                          <td className={`py-2 text-right font-mono ${row.net_pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                            {formatSignedNumber(row.net_pnl, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <DailyPnlCalendar trades={closedEntries} period={period} isKo={isKo} />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dark-500">
            <span>
              {isKo
                ? `분석 대상 ${performance?.closed_trade_count || 0}건 · PnL 계산 가능 ${performance?.evaluated_trade_count || 0}건`
                : `${performance?.closed_trade_count || 0} closed · ${performance?.evaluated_trade_count || 0} with PnL`}
              {(performance?.missing_pnl_count || 0) > 0 ? ` · ${isKo ? 'PnL 누락' : 'missing PnL'} ${performance?.missing_pnl_count}` : ''}
            </span>
            <span>
              {isKo
                ? '순수익률 = 순실현손익 ÷ 실제 투입 증거금, 투자금 가중 합산'
                : 'Net return = net realized PnL / invested margin, margin-weighted'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export default function JournalPage() {
  const language = useLanguage();
  const isKo = language === 'ko';
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('deepcoin');
  const [exchangeInstType, setExchangeInstType] = useState<'SWAP' | 'SPOT'>('SWAP');
  const [exchangeSymbols, setExchangeSymbols] = useState('BTC/USDT, ETH/USDT, SOL/USDT');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [snapshotEntry, setSnapshotEntry] = useState<JournalEntry | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<JournalPeriod>(() => buildJournalPeriod());
  const [visibleTradeCount, setVisibleTradeCount] = useState(VISIBLE_TRADE_INCREMENT);
  const [connectionOpen, setConnectionOpen] = useState(false);

  const { data: entries, isLoading, isError: entriesError, refetch: refetchEntries } = useQuery({
    queryKey: journalQueryKeys.entries,
    queryFn: getJournal,
  });
  const historyStartTime = dateBoundaryTimestamp(historyPeriod.start);
  const historyEndTime = dateBoundaryTimestamp(historyPeriod.end, true);
  const qualityQuery = useQuery({
    queryKey: journalQueryKeys.qualityAnalysis(historyStartTime, historyEndTime),
    queryFn: () => getJournalQualityAnalysis({
      start_time: historyStartTime as number,
      end_time: historyEndTime as number,
    }),
    enabled: historyStartTime != null && historyEndTime != null && historyStartTime <= historyEndTime,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const performanceQuery = useQuery({
    queryKey: journalQueryKeys.performance(historyStartTime, historyEndTime),
    queryFn: () => getJournalPerformance({
      start_time: historyStartTime as number,
      end_time: historyEndTime as number,
    }),
    enabled: historyStartTime != null && historyEndTime != null && historyStartTime <= historyEndTime,
    staleTime: 5 * 60_000,
  });
  const planLabQuery = useQuery({
    queryKey: journalQueryKeys.planLab(historyStartTime, historyEndTime),
    queryFn: () => getPlanLab({
      start_time: historyStartTime as number,
      end_time: historyEndTime as number,
    }),
    enabled: historyStartTime != null && historyEndTime != null && historyStartTime <= historyEndTime,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const qualityByJournalId = useMemo(
    () => new Map((qualityQuery.data?.items || []).map((item) => [item.journal_id, item])),
    [qualityQuery.data?.items],
  );
  const excursionByJournalId = useMemo(
    () => new Map((qualityQuery.data?.items || []).flatMap((item) => (
      item.excursion ? [[item.journal_id, item.excursion] as const] : []
    ))),
    [qualityQuery.data?.items],
  );

  const deleteMutation = useMutation({
    mutationFn: deleteJournalEntry,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: journalQueryKeys.entries });
      await Promise.all(journalDerivedQueryPrefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });

  const exchangeSyncMutation = useMutation({
    mutationFn: syncExchange,
    onSuccess: async (result) => {
      setSyncMessage(isKo ? '거래 동기화 완료 · 분석 결과를 갱신하고 있습니다.' : 'Trade sync complete · Refreshing analysis results.');

      await queryClient.invalidateQueries({ queryKey: journalQueryKeys.entries, refetchType: 'none' });
      await Promise.all(journalDerivedQueryPrefixes.map((queryKey) => (
        queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
      )));

      try {
        const latestEntries = await queryClient.fetchQuery({
          queryKey: journalQueryKeys.entries,
          queryFn: getJournal,
          staleTime: 0,
        });
        const [qualityResult, performanceResult] = await Promise.all([
          qualityQuery.refetch(),
          performanceQuery.refetch(),
        ]);
        const periodClosedCount = latestEntries.filter((entry) => (
          isClosedPosition(entry) && isJournalEntryWithinPeriod(entry, historyPeriod)
        )).length;
        const analyzedCount = qualityResult.data?.items.length || 0;
        const performanceClosedCount = performanceResult.data?.closed_trade_count || periodClosedCount;
        const firstWarning = result.warnings[0];

        if (periodClosedCount === 0) {
          setSyncMessage(isKo
            ? `체결 ${result.imported}건을 저장했지만 선택 기간에 분석할 종료 포지션을 받지 못했습니다. 체결 기록만으로는 거래 분석을 만들지 않습니다.${firstWarning ? ` · 거래소 응답: ${firstWarning}` : ''}`
            : `Saved ${result.imported} fills, but no closed positions were available in the selected period. Fill records alone are not used to create trade analysis.${firstWarning ? ` · Exchange response: ${firstWarning}` : ''}`);
          return;
        }

        if (qualityResult.isError) {
          setSyncMessage(isKo
            ? `종료 거래 ${performanceClosedCount}건은 동기화됐지만 상세 분석 갱신에 실패했습니다. 잠시 후 다시 동기화해 주세요.${firstWarning ? ` · 거래소 응답: ${firstWarning}` : ''}`
            : `${performanceClosedCount} closed trades were synced, but detailed analysis refresh failed. Please retry shortly.${firstWarning ? ` · Exchange response: ${firstWarning}` : ''}`);
          return;
        }

        setSyncMessage(isKo
          ? `동기화·자동 분석 완료: 종료 거래 ${performanceClosedCount}건 중 ${analyzedCount}건 분석 · 새 체결 ${result.imported}건, 새 종료 포지션 ${result.positions_imported}건${firstWarning ? ` · 거래소 응답: ${firstWarning}` : ''}`
          : `Sync and automatic analysis complete: analyzed ${analyzedCount} of ${performanceClosedCount} closed trades · ${result.imported} new fills, ${result.positions_imported} new closed positions${firstWarning ? ` · Exchange response: ${firstWarning}` : ''}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setSyncMessage(isKo
          ? `거래 동기화는 완료됐지만 분석 결과를 다시 불러오지 못했습니다: ${detail}`
          : `Trade sync completed, but analysis results could not be refreshed: ${detail}`);
      }
    },
  });

  const startExchangeSync = (days: number, message?: string) => {
    setSyncMessage(message || null);
    exchangeSyncMutation.mutate({
      exchange: selectedExchange,
      inst_type: exchangeInstType,
      lookback_days: days,
      symbols: exchangeSymbols.split(',').map((value) => value.trim()).filter(Boolean),
    });
  };

  const {
    exchangeStatuses,
    selectedExchangeStatus,
    connect,
    disconnect,
    connectionError,
    isConnecting,
    isDisconnecting,
  } = useExchangeConnection({
    selectedExchange,
    isKo,
    onMessage: setSyncMessage,
    onConnectionChanged: (isInitialConnection) => {
      setConnectionOpen(false);
      if (!isInitialConnection) return;

      const configuredDays = lookbackDaysFromStart(historyPeriod.start);
      const lookbackDays = Math.min(90, Math.max(1, configuredDays || 30));
      startExchangeSync(
        lookbackDays,
        isKo
          ? `연결 완료: 최근 ${lookbackDays}일 거래를 한 번 자동 동기화합니다.`
          : `Connection complete: automatically syncing the most recent ${lookbackDays} days once.`,
      );
    },
  });

  const allEntries = entries || [];
  const closedEntries = allEntries.filter(isClosedPosition);
  const periodClosedEntries = closedEntries.filter((entry) => isJournalEntryWithinPeriod(entry, historyPeriod));
  const stats = performanceQuery.data;

  const visibleEntries = [...periodClosedEntries]
    .sort((a, b) => {
      const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
      const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.id || 0) - (a.id || 0);
    });
  const displayedEntries = visibleEntries.slice(0, visibleTradeCount);

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            📒 {isKo ? '매매 일지' : 'Trading Journal'}
          </h1>
          <p className="text-dark-400 mt-1">
            {isKo ? '거래 기록 및 복기 관리' : 'Track and review your trades'}
          </p>
        </div>
      </div>

      <JournalSyncPanel
        statuses={exchangeStatuses || []}
        selectedExchange={selectedExchange}
        instType={exchangeInstType}
        symbols={exchangeSymbols}
        isKo={isKo}
        onConnect={() => setConnectionOpen(true)}
        onExchangeChange={(value) => { setSelectedExchange(value); setSyncMessage(null); }}
        onInstTypeChange={setExchangeInstType}
        onSymbolsChange={setExchangeSymbols}
      />

      <PeriodAnalysis
        allEntries={allEntries}
        closedEntries={closedEntries}
        qualityItems={qualityQuery.data?.items || []}
        isKo={isKo}
        instType={exchangeInstType}
        canSync={Boolean(selectedExchangeStatus?.configured)}
        isSyncing={exchangeSyncMutation.isPending}
        syncMessage={syncMessage}
        syncError={exchangeSyncMutation.error}
        period={historyPeriod}
        onSyncDays={(days) => startExchangeSync(days)}
        onPeriodApply={(nextPeriod) => {
          setHistoryPeriod(nextPeriod);
          setVisibleTradeCount(VISIBLE_TRADE_INCREMENT);
        }}
        performance={performanceQuery.data}
      />

      <PlanLabSummary data={planLabQuery.data} isKo={isKo} onOpen={() => navigate('/plan-lab')} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-white">{stats?.closed_trade_count || 0}</div>
          <div className="text-sm text-dark-400">{isKo ? '종료 거래' : 'Closed Trades'}</div>
          <div className="mt-1 text-[11px] text-dark-500">{isKo ? '연결 거래소 기준' : 'Connected exchanges'}</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-primary-400">{(stats?.win_rate_pct || 0).toFixed(2)}%</div>
          <div className="text-sm text-dark-400">{isKo ? '승률' : 'Win Rate'}</div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold ${(stats?.net_return_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
            {stats?.net_return_pct == null ? '-' : `${formatSignedNumber(stats.net_return_pct, 2)}%`}
          </div>
          <div className="text-sm text-dark-400">{isKo ? '투입 증거금 대비 수익률' : 'Return on deployed margin'}</div>
          <div className="mt-1 text-[11px] text-dark-500">
            {isKo ? '수수료·펀딩 반영' : 'After fees and funding'}
          </div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold ${(stats?.net_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
            {formatSignedNumber(stats?.net_pnl, 2)} USDT
          </div>
          <div className="text-sm text-dark-400">{isKo ? '순수익금' : 'Net Profit'}</div>
          <div className="mt-1 text-[11px] text-dark-500">
            {isKo ? '수수료·펀딩 반영' : 'After fees and funding'}
          </div>
        </div>
      </div>


      <div className="card p-6">
        <div className="mb-4">
          <div>
            <h3 className="text-lg font-semibold">{isKo ? '거래 기록' : 'Trade History'}</h3>
            <p className="mt-1 text-xs text-dark-500">
              {isKo
                ? `${historyPeriod.start} ~ ${historyPeriod.end} · 최신 ${Math.min(visibleTradeCount, visibleEntries.length)}/${visibleEntries.length}건`
                : `${historyPeriod.start} ~ ${historyPeriod.end} · Latest ${Math.min(visibleTradeCount, visibleEntries.length)}/${visibleEntries.length} closed trades`}
            </p>
          </div>
        </div>

        {entriesError ? (
          <div className="flex items-center justify-center gap-3 py-8 text-sm text-amber-300">
            <span>{isKo ? '거래 기록을 불러오지 못했습니다.' : 'Trade history could not be loaded.'}</span>
            <button type="button" onClick={() => void refetchEntries()} className="inline-flex items-center gap-1 border border-amber-300/40 px-2 py-1 text-xs"><RefreshCw className="h-3 w-3" />{isKo ? '재시도' : 'Retry'}</button>
          </div>
        ) : isLoading ? (
          <div className="text-center py-8 text-dark-400">{isKo ? '로딩 중...' : 'Loading...'}</div>
        ) : visibleEntries.length === 0 ? (
          <div className="text-center py-8 text-dark-400">
            {isKo ? '현재 필터에 표시할 거래가 없습니다.' : 'No trades match the current filter.'}
          </div>
        ) : (
          <>
          <div className="space-y-3 md:hidden">
            {displayedEntries.map((entry) => {
              const closed = isClosedPosition(entry);
              const excursion = entry.id == null ? null : excursionByJournalId.get(entry.id) || null;
              const quality = entry.id == null ? null : qualityByJournalId.get(entry.id) || null;
              const assessment = excursion
                ? tradeOutcomeAssessment(excursion, quality?.quality_class, isKo)
                : null;
              const displayNetReturnPct = netReturnPct(entry);
              const closeDate = entry.datetime ? new Date(entry.datetime) : null;
              const hasValidCloseDate = closeDate != null && Number.isFinite(closeDate.getTime());

              return (
                <article key={entry.id} className="border border-dark-700 bg-dark-900/35 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{entry.symbol || '-'}</div>
                      <div className="mt-0.5 text-[11px] text-dark-500">
                        {hasValidCloseDate ? `${toDateInputValue(closeDate)} ${closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '-'}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold ${entry.direction === 'Long' ? 'text-bull' : 'text-bear'}`}>{entry.direction || '-'}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-y border-dark-700 py-3 text-xs">
                    <div><span className="block text-[10px] text-dark-500">{isKo ? '진입 / 청산' : 'Entry / Exit'}</span><span className="mt-1 block font-mono text-dark-200">{entry.entry_price?.toLocaleString() || '-'} / {entry.exit_price?.toLocaleString() || '-'}</span></div>
                    <div className="text-right"><span className="block text-[10px] text-dark-500">{isKo ? '순수익금' : 'Net Profit'}</span><span className={`mt-1 block font-mono font-semibold ${(entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{entry.realized_pnl == null ? '-' : `${formatSignedNumber(entry.realized_pnl, 4)} USDT`}</span></div>
                    <div><span className="block text-[10px] text-dark-500">{isKo ? '투입금 대비 수익률' : 'Margin Return'}</span><span className={`mt-1 block font-mono ${(displayNetReturnPct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{displayNetReturnPct == null ? '-' : `${formatSignedNumber(displayNetReturnPct, 3)}%`}</span></div>
                    <div className="text-right"><span className="block text-[10px] text-dark-500">{isKo ? '손익 결과' : 'PnL Result'}</span><span className="mt-1 block text-dark-300">{entry.outcome || '-'}</span></div>
                  </div>
                  <div className="mt-3 text-xs">
                    {assessment ? <><div className={`font-semibold ${assessment.tone === 'negative' ? 'text-bear' : assessment.tone === 'warning' ? 'text-amber-300' : 'text-primary-300'}`}>{assessment.label}</div><div className="mt-1 line-clamp-2 leading-4 text-dark-400">{assessment.explanation}</div></> : <span className="text-dark-500">{qualityQuery.isLoading ? (isKo ? '판정 계산 중' : 'Calculating assessment') : (isKo ? '판정 데이터 없음' : 'Assessment unavailable')}</span>}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-dark-800 pt-3">
                    {closed && entry.datetime && entry.exit_price != null ? <button type="button" onClick={() => setSnapshotEntry(entry)} className="inline-flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-100"><CandlestickChart className="h-4 w-4" />{isKo ? '거래 리포트' : 'Trade report'}</button> : <span />}
                    <button type="button" aria-label={isKo ? '거래 삭제' : 'Delete trade'} onClick={() => entry.id && deleteMutation.mutate(entry.id)} className="text-dark-500 hover:text-red-400" disabled={deleteMutation.isPending}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-2 px-3">{isKo ? '날짜' : 'Date'}</th>
                  <th className="text-left py-2 px-3">{isKo ? '심볼' : 'Symbol'}</th>
                  <th className="text-left py-2 px-3">{isKo ? '결과 판정' : 'Outcome Assessment'}</th>
                  <th className="text-center py-2 px-3">{isKo ? '방향' : 'Dir'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '진입' : 'Entry'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '청산' : 'Exit'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '투입금 대비 수익률' : 'Margin Return'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '순수익금' : 'Net Profit'}</th>
                  <th className="text-center py-2 px-3">{isKo ? '손익 결과' : 'PnL Result'}</th>
                  <th className="text-center py-2 px-1">
                    <span className="sr-only">{isKo ? '거래 리포트' : 'Trade report'}</span>
                  </th>
                  <th className="text-center py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {displayedEntries.map((entry) => {
                  const closed = isClosedPosition(entry);
                  const excursion = entry.id == null ? null : excursionByJournalId.get(entry.id) || null;
                  const quality = entry.id == null ? null : qualityByJournalId.get(entry.id) || null;
                  const assessment = excursion
                    ? tradeOutcomeAssessment(excursion, quality?.quality_class, isKo)
                    : null;
                  const displayNetReturnPct = netReturnPct(entry);
                  const closeDate = entry.datetime ? new Date(entry.datetime) : null;
                  const hasValidCloseDate = closeDate != null && Number.isFinite(closeDate.getTime());

                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-dark-800 align-top transition-colors hover:bg-dark-800/50 ${
                        closed ? 'bg-primary-500/[0.035]' : ''
                      }`}
                    >
                      <td className="py-2 px-3 text-xs font-mono whitespace-nowrap">
                        <div>{hasValidCloseDate ? toDateInputValue(closeDate) : '-'}</div>
                        <div className="mt-0.5 text-[10px] text-dark-500">
                          {hasValidCloseDate
                            ? closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-medium">{entry.symbol || '-'}</div>
                        <div className="flex items-center gap-1.5 text-xs text-dark-400">
                          <span>{entry.timeframe || '-'}</span>
                          {!closed && entry.exchange && (
                            <span className="border border-primary-500/30 bg-primary-500/10 px-1 text-[10px] text-primary-300">
                              {entry.exchange}
                            </span>
                          )}
                          {closed && (
                            <span className="border border-bull/30 bg-bull/10 px-1 text-[10px] text-bull">
                              {entry.exchange || (isKo ? '거래소' : 'Exchange')} {isKo ? '종료' : 'Closed'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="min-w-[320px] py-2 px-3">
                        {assessment ? (
                          <div>
                            <div className={`text-xs font-semibold ${assessment.tone === 'negative' ? 'text-bear' : assessment.tone === 'warning' ? 'text-amber-300' : 'text-primary-300'}`}>
                              {assessment.label}
                            </div>
                            <div className="mt-1 text-[11px] leading-4 text-dark-400">{assessment.explanation}</div>
                          </div>
                        ) : qualityQuery.isLoading ? (
                          <span className="text-xs text-dark-500">{isKo ? '판정 계산 중' : 'Calculating assessment'}</span>
                        ) : (
                          <span className="text-xs text-dark-500">{isKo ? '판정 데이터 없음' : 'Assessment unavailable'}</span>
                        )}
                      </td>
                      <td
                        className={`py-2 px-3 text-center ${
                          entry.direction === 'Long' ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        {entry.direction || '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {entry.entry_price?.toLocaleString() || '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {entry.exit_price?.toLocaleString() || '-'}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono ${
                          (displayNetReturnPct || 0) >= 0 ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        <div className={closed ? 'text-base font-bold' : ''}>
                          {displayNetReturnPct == null ? '-' : `${formatSignedNumber(displayNetReturnPct, 3)}%`}
                        </div>
                        {closed && (entry.fee != null || entry.funding_fee != null) && (
                          <div className="mt-1 space-y-0.5 text-[10px] font-sans text-dark-500">
                            {entry.fee != null && (
                              <div>
                                {isKo ? '수수료' : 'Fee'}: {formatSignedNumber(-Math.abs(entry.fee))} {entry.fee_currency || 'USDT'}
                              </div>
                            )}
                            {entry.funding_fee != null && (
                              <div>{isKo ? '펀딩' : 'Funding'}: {formatSignedNumber(entry.funding_fee)} USDT</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-bold ${
                          (entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        {entry.realized_pnl == null
                          ? '-'
                          : `${formatSignedNumber(entry.realized_pnl, 4)} USDT`}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            entry.outcome === 'Win'
                              ? 'bg-bull/20 text-bull'
                              : entry.outcome === 'Loss'
                              ? 'bg-bear/20 text-bear'
                              : 'bg-dark-600 text-dark-300'
                          }`}
                        >
                          {entry.outcome || '-'}
                        </span>
                      </td>
                      <td className="py-2 px-1 text-center">
                        <div className="flex min-w-14 items-center justify-center gap-2">
                          {closed && entry.datetime && entry.exit_price != null && (
                            <button
                              type="button"
                              onClick={() => setSnapshotEntry(entry)}
                              className="text-amber-300 transition-colors hover:text-amber-100"
                              title={isKo ? '거래 리포트 및 차트' : 'Trade report and chart'}
                            >
                              <CandlestickChart className="h-4 w-4" />
                            </button>
                          )}
                          {!closed && entry.indicator_snapshot && (
                          <button
                            type="button"
                            onClick={() => setSnapshotEntry(entry)}
                            className="text-primary-400 transition-colors hover:text-primary-200"
                            title={isKo ? '거래 리포트 보기' : 'View trade report'}
                          >
                            <BarChart3 className="h-4 w-4" />
                          </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => entry.id && deleteMutation.mutate(entry.id)}
                          className="text-dark-500 hover:text-red-400 transition-colors"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {displayedEntries.length < visibleEntries.length && (
            <button type="button" onClick={() => setVisibleTradeCount((count) => count + VISIBLE_TRADE_INCREMENT)} className="mt-4 w-full border border-dark-700 py-2.5 text-xs text-dark-300 hover:border-primary-400/50 hover:text-white">
              {isKo ? `더 보기 (${visibleEntries.length - displayedEntries.length}건 남음)` : `Show more (${visibleEntries.length - displayedEntries.length} remaining)`}
            </button>
          )}
          </>
        )}
      </div>

      {snapshotEntry && (
        <TradeReportModal
          entry={snapshotEntry}
          allEntries={entries || []}
          excursion={snapshotEntry.id == null ? null : excursionByJournalId.get(snapshotEntry.id) || null}
          excursionLoading={qualityQuery.isLoading}
          qualityItem={snapshotEntry.id == null ? null : qualityByJournalId.get(snapshotEntry.id) || null}
          isKo={isKo}
          onClose={() => setSnapshotEntry(null)}
          onBehaviorUpdated={async () => {
            await queryClient.invalidateQueries({ queryKey: journalQueryKeys.entries });
            await Promise.all(journalDerivedQueryPrefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
          }}
        />
      )}
      {connectionOpen && selectedExchangeStatus && (
        <ExchangeConnectionModal
          exchange={selectedExchangeStatus}
          isKo={isKo}
          isSaving={isConnecting}
          isDeleting={isDisconnecting}
          error={connectionError}
          onSave={connect}
          onDelete={() => {
            const confirmed = window.confirm(isKo ? `${selectedExchangeStatus.name} 연결 정보를 삭제할까요?` : `Remove saved ${selectedExchangeStatus.name} credentials?`);
            if (confirmed) disconnect();
          }}
          onClose={() => setConnectionOpen(false)}
        />
      )}

    </div>
  );
}
