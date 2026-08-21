// Trading Journal Page
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CandlestickChart, KeyRound, Link2, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

import {
  configureExchangeCredentials,
  deleteJournalEntry,
  getExchangeStatuses,
  getJournal,
  getJournalExcursions,
  syncExchange,
} from '../api/client';
import { useLanguage } from '../store/useStore';
import type { ExchangeId, ExchangeStatus, JournalEntry } from '../types';
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
  aggregateNetPnl,
  aggregateNetReturnPct,
  feeImpact,
  fundingImpact,
  netCostImpact,
  netReturnPct,
} from '../features/journal/journalReturns';
import { journalDerivedQueryPrefixes, journalQueryKeys } from '../features/journal/journalQueryKeys';
import TradeReportModal from '../features/journal/TradeReportModal';
import { tradeOutcomeAssessment } from '../features/journal/tradeOutcomeAssessment';

function formatSignedNumber(value: number | null | undefined, maximumFractionDigits = 4): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits })}`;
}

function ExchangeConnectionModal({
  exchange,
  isKo,
  isSaving,
  error,
  onSave,
  onClose,
}: {
  exchange: ExchangeStatus;
  isKo: boolean;
  isSaving: boolean;
  error: unknown;
  onSave: (values: { api_key: string; secret_key: string; passphrase?: string }) => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const errorText = error instanceof Error ? error.message : null;
  const canSave = Boolean(apiKey.trim() && secretKey.trim() && (!exchange.requires_passphrase || passphrase.trim())) && !isSaving;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={isKo ? `${exchange.name} API 연결` : `${exchange.name} API connection`}>
      <form className="w-full max-w-md border border-dark-600 bg-dark-950 shadow-2xl" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ api_key: apiKey, secret_key: secretKey, passphrase }); }}>
        <div className="flex items-start justify-between gap-4 border-b border-dark-700 px-5 py-4">
          <div><h2 className="flex items-center gap-2 text-base font-semibold text-white"><KeyRound className="h-4 w-4 text-primary-300" />{exchange.name} {isKo ? '연결' : 'Connection'}</h2><p className="mt-1 text-xs leading-5 text-dark-400">{isKo ? '읽기 전용 연결을 확인한 뒤 이 컴퓨터의 git 제외 .env 파일에만 저장합니다. 브라우저에는 저장하지 않습니다.' : 'Read access is verified before saving only to this computer\'s git-ignored .env. Nothing is stored in the browser.'}</p></div>
          <button type="button" onClick={onClose} disabled={isSaving} className="text-dark-400 hover:text-white" aria-label={isKo ? '닫기' : 'Close'}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="block text-xs text-dark-300">API Key<input autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>
          <label className="block text-xs text-dark-300">Secret Key<input type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>
          {exchange.requires_passphrase && <label className="block text-xs text-dark-300">Passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>}
          {errorText && <div className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs leading-5 text-bear">{errorText}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-dark-700 px-5 py-4"><button type="button" onClick={onClose} disabled={isSaving} className="border border-dark-700 px-3 py-2 text-xs text-dark-300 hover:text-white">{isKo ? '취소' : 'Cancel'}</button><button type="submit" disabled={!canSave} className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50">{isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{isKo ? '연결 확인 후 저장' : 'Verify and Save'}</button></div>
      </form>
    </div>
  );
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
  closedEntries,
  isKo,
  instType,
  canSync,
  isSyncing,
  syncMessage,
  syncError,
  period,
  onSyncDays,
  onPeriodApply,
}: {
  closedEntries: JournalEntry[];
  isKo: boolean;
  instType: 'SWAP' | 'SPOT';
  canSync: boolean;
  isSyncing: boolean;
  syncMessage: string | null;
  syncError: unknown;
  period: JournalPeriod;
  onSyncDays: (days: number) => void;
  onPeriodApply: (period: JournalPeriod) => void;
}) {
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
  const missingPnlCount = periodClosedEntries.length - analysisTrades.length;
  const pnlValues = analysisTrades.map((entry) => entry.realized_pnl as number);
  const wins = pnlValues.filter((value) => value > 0);
  const losses = pnlValues.filter((value) => value < 0);
  const breakevens = pnlValues.filter((value) => value === 0);
  const netPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const periodNetReturn = aggregateNetReturnPct(analysisTrades);
  const returnTradeCount = analysisTrades.filter((entry) => netReturnPct(entry) != null).length;
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const winRate = analysisTrades.length > 0 ? (wins.length / analysisTrades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? -grossLoss / losses.length : 0;
  const expectancy = analysisTrades.length > 0 ? netPnl / analysisTrades.length : 0;
  const periodFeeImpact = feeImpact(analysisTrades);
  const periodFundingImpact = fundingImpact(analysisTrades);
  const periodNetCostImpact = netCostImpact(analysisTrades);

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  for (const trade of analysisTrades) {
    const pnl = trade.realized_pnl as number;
    if (pnl > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else if (pnl < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  }

  const bestTrade = analysisTrades.reduce<JournalEntry | null>((best, entry) => {
    if (!best || (entry.realized_pnl || 0) > (best.realized_pnl || 0)) return entry;
    return best;
  }, null);
  const worstTrade = analysisTrades.reduce<JournalEntry | null>((worst, entry) => {
    if (!worst || (entry.realized_pnl || 0) < (worst.realized_pnl || 0)) return entry;
    return worst;
  }, null);

  const directionStats = (direction: 'Long' | 'Short') => {
    const subset = analysisTrades.filter((entry) => entry.direction === direction);
    const subsetWins = subset.filter((entry) => (entry.realized_pnl || 0) > 0).length;
    const subsetPnl = subset.reduce((sum, entry) => sum + (entry.realized_pnl || 0), 0);
    return {
      count: subset.length,
      pnl: subsetPnl,
      winRate: subset.length > 0 ? (subsetWins / subset.length) * 100 : 0,
    };
  };

  const longStats = directionStats('Long');
  const shortStats = directionStats('Short');
  const symbolMap = new Map<string, { count: number; wins: number; pnl: number }>();
  for (const entry of analysisTrades) {
    const symbol = entry.symbol || '-';
    const current = symbolMap.get(symbol) || { count: 0, wins: 0, pnl: 0 };
    current.count += 1;
    current.wins += (entry.realized_pnl || 0) > 0 ? 1 : 0;
    current.pnl += entry.realized_pnl || 0;
    symbolMap.set(symbol, current);
  }
  const symbolRows = [...symbolMap.entries()]
    .map(([symbol, data]) => ({
      symbol,
      ...data,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  const inputStartTs = dateBoundaryTimestamp(analysisStart);
  const inputEndTs = dateBoundaryTimestamp(analysisEnd, true);
  const periodInvalid = inputStartTs != null && inputEndTs != null && inputStartTs > inputEndTs;
  const syncErrorText = syncError instanceof Error ? syncError.message : null;

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
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <AnalysisMetric
              label={isKo ? '기간 순수익률' : 'Net Return'}
              value={periodNetReturn == null ? '-' : `${formatSignedNumber(periodNetReturn, 2)}%`}
              tone={(periodNetReturn || 0) >= 0 ? 'positive' : 'negative'}
              detail={`${returnTradeCount}${isKo ? '회 · 수수료·펀딩 반영' : ' trades · after fees/funding'}`}
            />
            <AnalysisMetric
              label={isKo ? '기간 순수익금' : 'Net Profit'}
              value={`${formatSignedNumber(netPnl, 2)} USDT`}
              tone={netPnl >= 0 ? 'positive' : 'negative'}
              detail={`${analysisTrades.length}${isKo ? '회 종료 거래 합계' : ' closed trades'}`}
            />
            <AnalysisMetric
              label={isKo ? '승률' : 'Win Rate'}
              value={`${winRate.toFixed(1)}%`}
              tone="primary"
              detail={`${wins.length}W · ${losses.length}L · ${breakevens.length}BE`}
            />
            <AnalysisMetric
              label="Profit Factor"
              value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}
              detail={isKo ? '총이익 ÷ 총손실' : 'Gross profit / gross loss'}
            />
            <AnalysisMetric
              label={isKo ? '평균 수익' : 'Avg Win'}
              value={`${formatSignedNumber(averageWin, 2)} USDT`}
              tone="positive"
            />
            <AnalysisMetric
              label={isKo ? '평균 손실' : 'Avg Loss'}
              value={`${formatSignedNumber(averageLoss, 2)} USDT`}
              tone="negative"
            />
            <AnalysisMetric
              label={isKo ? '거래당 기대값' : 'Expectancy / Trade'}
              value={`${formatSignedNumber(expectancy, 2)} USDT`}
              tone={expectancy >= 0 ? 'positive' : 'negative'}
            />
            <AnalysisMetric
              label={isKo ? '비용 순효과' : 'Net Cost Impact'}
              value={`${formatSignedNumber(periodNetCostImpact, 2)} USDT`}
              tone={periodNetCostImpact >= 0 ? 'positive' : 'negative'}
              detail={`${isKo ? '수수료' : 'Fee'} ${formatSignedNumber(periodFeeImpact, 2)} · ${isKo ? '펀딩' : 'Funding'} ${formatSignedNumber(periodFundingImpact, 2)}`}
            />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">LONG</div>
              <div className={`mt-2 font-mono text-xl font-bold ${longStats.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatSignedNumber(longStats.pnl, 2)} USDT
              </div>
              <div className="mt-1 text-xs text-dark-500">
                {longStats.count}{isKo ? '회' : ' trades'} · {isKo ? '승률' : 'win'} {longStats.winRate.toFixed(1)}%
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">SHORT</div>
              <div className={`mt-2 font-mono text-xl font-bold ${shortStats.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {formatSignedNumber(shortStats.pnl, 2)} USDT
              </div>
              <div className="mt-1 text-xs text-dark-500">
                {shortStats.count}{isKo ? '회' : ' trades'} · {isKo ? '승률' : 'win'} {shortStats.winRate.toFixed(1)}%
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">{isKo ? '최고 / 최악 거래' : 'Best / Worst Trade'}</div>
              <div className="mt-2 text-xs text-dark-400">
                <div className="flex justify-between gap-2">
                  <span>{bestTrade?.symbol || '-'}</span>
                  <span className="font-mono text-bull">{bestTrade ? `${formatSignedNumber(bestTrade.realized_pnl, 2)}` : '-'}</span>
                </div>
                <div className="mt-1 flex justify-between gap-2">
                  <span>{worstTrade?.symbol || '-'}</span>
                  <span className="font-mono text-bear">{worstTrade ? `${formatSignedNumber(worstTrade.realized_pnl, 2)}` : '-'}</span>
                </div>
              </div>
            </div>
            <div className="border border-dark-700 bg-dark-900/35 p-4">
              <div className="text-xs font-semibold text-dark-300">{isKo ? '연속 기록' : 'Streaks'}</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-dark-500">{isKo ? '최대 연승' : 'Max wins'}</div>
                  <div className="font-mono text-xl font-bold text-bull">{maxWinStreak}</div>
                </div>
                <div>
                  <div className="text-[10px] text-dark-500">{isKo ? '최대 연패' : 'Max losses'}</div>
                  <div className="font-mono text-xl font-bold text-bear">{maxLossStreak}</div>
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
                        <tr key={row.symbol} className="border-b border-dark-800">
                          <td className="py-2 text-dark-200">{row.symbol}</td>
                          <td className="py-2 text-right font-mono text-dark-300">{row.count}</td>
                          <td className="py-2 text-right font-mono text-dark-300">{row.winRate.toFixed(0)}%</td>
                          <td className={`py-2 text-right font-mono ${row.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                            {formatSignedNumber(row.pnl, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dark-500">
            <span>
              {isKo
                ? `분석 대상 ${periodClosedEntries.length}건 · PnL 계산 가능 ${analysisTrades.length}건`
                : `${periodClosedEntries.length} closed · ${analysisTrades.length} with PnL`}
              {missingPnlCount > 0 ? ` · ${isKo ? 'PnL 누락' : 'missing PnL'} ${missingPnlCount}` : ''}
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

  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('deepcoin');
  const [exchangeInstType, setExchangeInstType] = useState<'SWAP' | 'SPOT'>('SWAP');
  const [exchangeSymbols, setExchangeSymbols] = useState('BTC/USDT, ETH/USDT, SOL/USDT');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [snapshotEntry, setSnapshotEntry] = useState<JournalEntry | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<JournalPeriod>(() => buildJournalPeriod());
  const [connectionOpen, setConnectionOpen] = useState(false);

  const { data: entries, isLoading } = useQuery({
    queryKey: journalQueryKeys.entries,
    queryFn: getJournal,
  });
  const historyStartTime = dateBoundaryTimestamp(historyPeriod.start);
  const historyEndTime = dateBoundaryTimestamp(historyPeriod.end, true);
  const excursionQuery = useQuery({
    queryKey: journalQueryKeys.excursions(historyStartTime, historyEndTime),
    queryFn: () => getJournalExcursions({
      start_time: historyStartTime as number,
      end_time: historyEndTime as number,
    }),
    enabled: historyStartTime != null && historyEndTime != null && historyStartTime <= historyEndTime,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const excursionByJournalId = useMemo(
    () => new Map((excursionQuery.data?.items || []).map((item) => [item.journal_id, item])),
    [excursionQuery.data?.items],
  );

  const { data: exchangeStatuses } = useQuery({
    queryKey: ['exchange-statuses'],
    queryFn: getExchangeStatuses,
    staleTime: 60_000,
  });
  const selectedExchangeStatus = exchangeStatuses?.find((item) => item.id === selectedExchange);

  const deleteMutation = useMutation({
    mutationFn: deleteJournalEntry,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: journalQueryKeys.entries });
      await Promise.all(journalDerivedQueryPrefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });

  const exchangeConnectionMutation = useMutation({
    mutationFn: configureExchangeCredentials,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exchange-statuses'] });
      setConnectionOpen(false);
      setSyncMessage(isKo ? `${selectedExchangeStatus?.name || '거래소'} 읽기 전용 연결을 확인하고 이 컴퓨터에 저장했습니다.` : `${selectedExchangeStatus?.name || 'Exchange'} read-only connection verified and saved on this computer.`);
    },
  });

  const exchangeSyncMutation = useMutation({
    mutationFn: syncExchange,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: journalQueryKeys.entries });
      await Promise.all(journalDerivedQueryPrefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setSyncMessage(
        isKo
          ? `동기화 완료: 체결 ${result.imported}건 저장, 종료 포지션 ${result.positions_imported}건 저장·${result.positions_updated}건 재계산${result.warnings.length ? ' · 일부 스냅샷 또는 조회 범위를 확인하세요.' : ''}`
          : `Sync complete: ${result.imported} fills imported, ${result.positions_imported} closed positions imported and ${result.positions_updated} recalculated${result.warnings.length ? ' · Review snapshot or range warnings.' : ''}`,
      );
    },
  });

  const allEntries = entries || [];
  const closedEntries = allEntries.filter(isClosedPosition);
  const periodClosedEntries = closedEntries.filter((entry) => isJournalEntryWithinPeriod(entry, historyPeriod));
  const evaluatedEntries = periodClosedEntries.filter((entry) =>
    ['Win', 'Loss', 'Breakeven'].includes(entry.outcome || ''),
  );
  const stats = {
    total: periodClosedEntries.length,
    wins: evaluatedEntries.filter((entry) => entry.outcome === 'Win').length,
    losses: evaluatedEntries.filter((entry) => entry.outcome === 'Loss').length,
    netReturnPct: aggregateNetReturnPct(periodClosedEntries),
    netPnl: aggregateNetPnl(periodClosedEntries),
  };
  const winRate = evaluatedEntries.length > 0 ? (stats.wins / evaluatedEntries.length) * 100 : 0;

  const visibleEntries = periodClosedEntries
    .sort((a, b) => {
      const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
      const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.id || 0) - (a.id || 0);
    });

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

      <section className="flex flex-col gap-3 border border-dark-700 bg-dark-800/35 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center border border-dark-600 bg-dark-900 text-primary-300">
            <Link2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{selectedExchangeStatus?.name || 'Exchange'}</div>
            <div className={`text-xs ${selectedExchangeStatus?.configured ? 'text-bull' : 'text-dark-400'}`}>
              {selectedExchangeStatus?.configured
                ? isKo
                  ? '읽기 전용 연결 준비됨'
                  : 'Read-only connection ready'
                : isKo
                ? '서버 환경변수 설정 필요'
                : 'Server environment setup required'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setConnectionOpen(true)} className="inline-flex items-center gap-1.5 border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-dark-200 hover:border-primary-400/60 hover:text-white"><KeyRound className="h-3.5 w-3.5 text-primary-300" />{selectedExchangeStatus?.configured ? (isKo ? '연결 설정' : 'Connection settings') : (isKo ? 'API 연결' : 'Connect API')}</button>
          <select
            value={selectedExchange}
            onChange={(event) => {
              setSelectedExchange(event.target.value as ExchangeId);
              setSyncMessage(null);
            }}
            className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
            aria-label={isKo ? '거래소' : 'Exchange'}
          >
            {(exchangeStatuses || []).map((exchange) => (
              <option key={exchange.id} value={exchange.id}>
                {exchange.name}{exchange.configured ? '' : isKo ? ' · 미설정' : ' · Not configured'}
              </option>
            ))}
          </select>
          <select
            value={exchangeInstType}
            onChange={(event) => setExchangeInstType(event.target.value as 'SWAP' | 'SPOT')}
            className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
            aria-label={isKo ? '상품 유형' : 'Instrument type'}
          >
            <option value="SWAP">{isKo ? 'USDT 선물' : 'USDT Perpetual'}</option>
            <option value="SPOT">{isKo ? '현물' : 'Spot'}</option>
          </select>
          {selectedExchange !== 'deepcoin' && (
            <input
              value={exchangeSymbols}
              onChange={(event) => setExchangeSymbols(event.target.value)}
              className="min-w-[280px] bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
              aria-label={isKo ? '동기화 종목' : 'Sync symbols'}
              placeholder="BTC/USDT, ETH/USDT"
            />
          )}
          <span className="text-xs text-dark-400">
            {isKo ? '동기화 기간은 아래 기간 성과 분석에서 선택합니다.' : 'Choose the sync period in the performance section below.'}
          </span>
        </div>
      </section>

      <PeriodAnalysis
        closedEntries={closedEntries}
        isKo={isKo}
        instType={exchangeInstType}
        canSync={Boolean(selectedExchangeStatus?.configured)}
        isSyncing={exchangeSyncMutation.isPending}
        syncMessage={syncMessage}
        syncError={exchangeSyncMutation.error}
        period={historyPeriod}
        onSyncDays={(days) => {
          setSyncMessage(null);
          exchangeSyncMutation.mutate({
            exchange: selectedExchange,
            inst_type: exchangeInstType,
            lookback_days: days,
            symbols: exchangeSymbols.split(',').map((value) => value.trim()).filter(Boolean),
          });
        }}
        onPeriodApply={setHistoryPeriod}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-sm text-dark-400">{isKo ? '종료 거래' : 'Closed Trades'}</div>
          <div className="mt-1 text-[11px] text-dark-500">{isKo ? '연결 거래소 기준' : 'Connected exchanges'}</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-primary-400">{winRate.toFixed(2)}%</div>
          <div className="text-sm text-dark-400">{isKo ? '승률' : 'Win Rate'}</div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold ${(stats.netReturnPct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>
            {stats.netReturnPct == null ? '-' : `${formatSignedNumber(stats.netReturnPct, 2)}%`}
          </div>
          <div className="text-sm text-dark-400">{isKo ? '순수익률' : 'Net Return'}</div>
          <div className="mt-1 text-[11px] text-dark-500">
            {isKo ? '수수료·펀딩 반영' : 'After fees and funding'}
          </div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold ${stats.netPnl >= 0 ? 'text-bull' : 'text-bear'}`}>
            {formatSignedNumber(stats.netPnl, 2)} USDT
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
                ? `${historyPeriod.start} ~ ${historyPeriod.end} · 종료된 포지션만 표시합니다.`
                : `${historyPeriod.start} ~ ${historyPeriod.end} · Closed positions only.`}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">{isKo ? '로딩 중...' : 'Loading...'}</div>
        ) : visibleEntries.length === 0 ? (
          <div className="text-center py-8 text-dark-400">
            {isKo ? '현재 필터에 표시할 거래가 없습니다.' : 'No trades match the current filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="text-left py-2 px-3">{isKo ? '날짜' : 'Date'}</th>
                  <th className="text-left py-2 px-3">{isKo ? '심볼' : 'Symbol'}</th>
                  <th className="text-left py-2 px-3">{isKo ? '결과 판정' : 'Outcome Assessment'}</th>
                  <th className="text-center py-2 px-3">{isKo ? '방향' : 'Dir'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '진입' : 'Entry'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '청산' : 'Exit'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '순수익률' : 'Net Return'}</th>
                  <th className="text-right py-2 px-3">{isKo ? '순수익금' : 'Net Profit'}</th>
                  <th className="text-center py-2 px-3">{isKo ? '손익 결과' : 'PnL Result'}</th>
                  <th className="text-center py-2 px-1">
                    <span className="sr-only">{isKo ? '거래 리포트' : 'Trade report'}</span>
                  </th>
                  <th className="text-center py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const closed = isClosedPosition(entry);
                  const excursion = entry.id == null ? null : excursionByJournalId.get(entry.id) || null;
                  const assessment = excursion ? tradeOutcomeAssessment(excursion, isKo) : null;
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
                        ) : excursionQuery.isLoading ? (
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
        )}
      </div>

      {snapshotEntry && (
        <TradeReportModal
          entry={snapshotEntry}
          allEntries={entries || []}
          excursion={snapshotEntry.id == null ? null : excursionByJournalId.get(snapshotEntry.id) || null}
          excursionLoading={excursionQuery.isLoading}
          isKo={isKo}
          onClose={() => setSnapshotEntry(null)}
        />
      )}
      {connectionOpen && selectedExchangeStatus && (
        <ExchangeConnectionModal
          exchange={selectedExchangeStatus}
          isKo={isKo}
          isSaving={exchangeConnectionMutation.isPending}
          error={exchangeConnectionMutation.error}
          onSave={(values) => exchangeConnectionMutation.mutate({ exchange: selectedExchange, ...values })}
          onClose={() => setConnectionOpen(false)}
        />
      )}

    </div>
  );
}
