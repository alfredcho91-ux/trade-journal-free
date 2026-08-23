import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, ShieldAlert } from 'lucide-react';

import { getJournal, getJournalQualityAnalysis, getJournalStopLossAnalysis, getJournalStopOptimization } from '../api/client';
import { buildAnalyzedTrades } from '../features/tradeAnalysis/tradeAnalysis';
import SlTpExpectationAnalysis from '../features/tradeAnalysis/SlTpExpectationAnalysis';
import StopLossAnalysis from '../features/tradeAnalysis/StopLossAnalysis';
import StopLossExpectationTool from '../features/tradeAnalysis/StopLossExpectationTool';
import StopOptimizationAnalysis from '../features/tradeAnalysis/StopOptimizationAnalysis';
import { journalQueryKeys } from '../features/journal/journalQueryKeys';
import {
  buildJournalPeriod,
  dateBoundaryTimestamp,
  isJournalEntryWithinPeriod,
  millisecondsUntilNextLocalDay,
  toDateInputValue,
  type JournalPeriod,
} from '../features/journal/journalPeriod';
import { useLanguage } from '../store/useStore';

type DirectionFilter = 'Long' | 'Short';

const DEFAULT_ANALYSIS_DAYS = 90;

export default function RiskLabPage() {
  const isKo = useLanguage() === 'ko';
  const [period, setPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_ANALYSIS_DAYS));
  const [draftPeriod, setDraftPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_ANALYSIS_DAYS));
  const [usesRollingPeriod, setUsesRollingPeriod] = useState(true);
  const [direction, setDirection] = useState<DirectionFilter>('Long');
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [stopDetailsOpen, setStopDetailsOpen] = useState(true);
  const lastDailyRefreshDateRef = useRef(toDateInputValue(new Date()));

  const { data: entries = [], isLoading: isJournalLoading, refetch: refetchJournal } = useQuery({
    queryKey: journalQueryKeys.entries,
    queryFn: getJournal,
  });
  const startTime = dateBoundaryTimestamp(period.start);
  const endTime = dateBoundaryTimestamp(period.end, true);
  const queryEnabled = startTime != null && endTime != null && startTime <= endTime;
  const qualityQuery = useQuery({
    queryKey: journalQueryKeys.qualityAnalysis(startTime, endTime),
    queryFn: () => getJournalQualityAnalysis({ start_time: startTime as number, end_time: endTime as number }),
    enabled: queryEnabled,
    staleTime: 30 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_500 * 2 ** attempt, 6_000),
    refetchOnWindowFocus: true,
  });
  const stopLossQuery = useQuery({
    queryKey: journalQueryKeys.stopLossAnalysis(startTime, endTime),
    queryFn: () => getJournalStopLossAnalysis({ start_time: startTime as number, end_time: endTime as number }),
    enabled: stopDetailsOpen && queryEnabled,
    staleTime: 30 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_500 * 2 ** attempt, 6_000),
    refetchOnWindowFocus: true,
  });
  const stopOptimizationQuery = useQuery({
    queryKey: journalQueryKeys.stopOptimization(startTime, endTime),
    queryFn: () => getJournalStopOptimization({ start_time: startTime as number, end_time: endTime as number }),
    enabled: stopDetailsOpen && queryEnabled,
    staleTime: 30 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_500 * 2 ** attempt, 6_000),
    refetchOnWindowFocus: true,
  });
  const { refetch: refetchQualityAnalysis } = qualityQuery;
  const { refetch: refetchStopLossAnalysis } = stopLossQuery;
  const { refetch: refetchStopOptimization } = stopOptimizationQuery;

  const refreshDaily = useCallback(() => {
    lastDailyRefreshDateRef.current = toDateInputValue(new Date());
    void refetchJournal();
    if (usesRollingPeriod) {
      const next = buildJournalPeriod(DEFAULT_ANALYSIS_DAYS);
      setDraftPeriod(next);
      setPeriod(next);
      return;
    }
    void refetchQualityAnalysis();
    if (stopDetailsOpen) {
      void refetchStopLossAnalysis();
      void refetchStopOptimization();
    }
  }, [refetchJournal, refetchQualityAnalysis, refetchStopLossAnalysis, refetchStopOptimization, stopDetailsOpen, usesRollingPeriod]);

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
      if (document.visibilityState === 'visible' && today !== lastDailyRefreshDateRef.current) refreshDaily();
    };
    scheduleNextRefresh();
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [refreshDaily]);

  const allTrades = useMemo(() => {
    const periodIds = new Set(entries.filter((entry) => isJournalEntryWithinPeriod(entry, period)).map((entry) => entry.id));
    const excursions = qualityQuery.data?.items
      .map((item) => item.excursion)
      .filter((item): item is NonNullable<typeof item> => item != null) || [];
    return buildAnalyzedTrades(entries, excursions).filter((trade) => periodIds.has(trade.entry.id));
  }, [entries, period, qualityQuery.data?.items]);
  const directionTrades = useMemo(
    () => allTrades.filter((trade) => trade.entry.direction === direction),
    [allTrades, direction],
  );

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

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><ShieldAlert className="h-5 w-5 text-amber-300" />Risk Lab</h1>
          <div className="mt-1 text-xs text-dark-500">{period.start} ~ {period.end} · {isKo ? '연결 거래소 종료 포지션의 위험 관리 복기' : 'Risk review of connected exchange closed positions'}</div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={applyRollingPeriod} className="border border-dark-700 bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:text-white">{DEFAULT_ANALYSIS_DAYS}{isKo ? '일' : 'D'}</button>
          <input type="date" max={toDateInputValue(new Date())} value={draftPeriod.start} onChange={(event) => setDraftPeriod((current) => ({ ...current, start: event.target.value }))} className="border border-dark-700 bg-dark-800 px-2 py-2 text-xs" aria-label={isKo ? '분석 시작일' : 'Analysis start date'} />
          <input type="date" max={toDateInputValue(new Date())} value={draftPeriod.end} onChange={(event) => setDraftPeriod((current) => ({ ...current, end: event.target.value }))} className="border border-dark-700 bg-dark-800 px-2 py-2 text-xs" aria-label={isKo ? '분석 종료일' : 'Analysis end date'} />
          <button type="button" onClick={applyCustom} className="btn-primary px-3 py-2 text-xs">{isKo ? '적용' : 'Apply'}</button>
        </div>
      </header>
      {periodError && <div className="text-xs text-bear">{periodError}</div>}

      <section className="flex flex-wrap items-center justify-between gap-3 border-y border-dark-700 py-2">
        <div>
          <div className="text-xs font-medium text-dark-200">{isKo ? '분석 방향' : 'Analysis direction'}</div>
          <div className="mt-0.5 text-[10px] text-dark-500">{isKo ? '선택 방향의 손절·목표가 통계에 적용' : 'Applied to selected-direction stop and target statistics'}</div>
        </div>
        <div className="grid min-w-64 grid-cols-2 border border-dark-700 bg-dark-900/35 p-1">
          {(['Long', 'Short'] as const).map((item) => (
            <button key={item} type="button" onClick={() => setDirection(item)} className={`min-h-9 px-2 text-xs font-medium transition-colors ${direction === item ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}>{item.toUpperCase()}</button>
          ))}
        </div>
      </section>

      <StopLossExpectationTool trades={directionTrades} direction={direction} isLoading={isJournalLoading || qualityQuery.isLoading} isKo={isKo} />
      <SlTpExpectationAnalysis startTime={startTime} endTime={endTime} direction={direction} isKo={isKo} />
      <details className="group" open={stopDetailsOpen} onToggle={(event) => setStopDetailsOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between border border-dark-700 bg-dark-900/30 px-4 py-3 hover:bg-dark-900/50">
          <span className="flex items-center gap-2 text-sm font-medium text-dark-200"><ShieldAlert className="h-4 w-4 text-amber-300" />{isKo ? '손절 분석 상세' : 'Stop analysis details'}</span>
          <span className="flex items-center gap-2 text-[11px] text-dark-500">{direction.toUpperCase()} · {stopLossQuery.data?.direction_breakdown[direction].summary.confirmed_stop_count || 0}{isKo ? '개 확정 손절' : ' confirmed stops'}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="mt-3 space-y-3">
          {stopDetailsOpen && (stopLossQuery.isLoading || stopOptimizationQuery.isLoading) && <div className="flex items-center gap-2 text-xs text-dark-400"><Loader2 className="h-4 w-4 animate-spin" />{isKo ? '손절 데이터를 계산 중입니다.' : 'Calculating stop data.'}</div>}
          <StopLossAnalysis data={stopLossQuery.data} direction={direction} isLoading={stopLossQuery.isLoading || stopLossQuery.isFetching} isError={stopLossQuery.isError} isKo={isKo} onRetry={() => void stopLossQuery.refetch()} />
          <StopOptimizationAnalysis data={stopOptimizationQuery.data} direction={direction} isLoading={stopOptimizationQuery.isLoading || stopOptimizationQuery.isFetching} isError={stopOptimizationQuery.isError} isKo={isKo} onRetry={() => void stopOptimizationQuery.refetch()} />
        </div>
      </details>
    </div>
  );
}
