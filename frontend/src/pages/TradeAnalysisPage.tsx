import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, Loader2, SlidersHorizontal } from 'lucide-react';

import { getJournal, getJournalQualityAnalysis } from '../api/client';
import {
  ANALYSIS_TIMEFRAMES,
  buildAnalyzedTrades,
  conditionComparisons,
  filterTradesByReturnRange,
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
import OngoingPositionFills from '../features/tradeAnalysis/OngoingPositionFills';
import TradeExitReviewList from '../features/tradeAnalysis/TradeExitReviewList';
import { journalQueryKeys } from '../features/journal/journalQueryKeys';
import { useLanguage, useSelectedCoin } from '../store/useStore';

type AnalysisMode = 'all' | 'wins' | 'losses' | 'compare';
type DirectionFilter = 'Long' | 'Short';
type AnalysisSection = 'overview' | 'entry';

const DEFAULT_ANALYSIS_DAYS = 90;

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function plain(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function TradeQuality({ trades, isKo, isLoading }: { trades: AnalyzedTrade[]; isKo: boolean; isLoading: boolean }) {
  const withExcursion = trades.filter((trade) => trade.excursion);
  const goodEntryPoorExit = withExcursion.filter((trade) => trade.excursion?.classification === 'good_entry_poor_exit');
  const poorEntry = withExcursion.filter((trade) => trade.excursion?.classification === 'poor_entry');
  const rows = [...goodEntryPoorExit, ...poorEntry]
    .sort((a, b) => {
      const aTime = a.entry.datetime ? new Date(a.entry.datetime).getTime() : 0;
      const bTime = b.entry.datetime ? new Date(b.entry.datetime).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.entry.id || 0) - (a.entry.id || 0);
    })
    .slice(0, 10);
  const qualitySummary = performanceSummary(trades);

  return (
    <section className="border border-dark-700 bg-dark-900/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">진입 후 최대 이익·손실 움직임</h2>
          <div className="mt-0.5 text-[11px] text-dark-500">
            {isKo ? '15분봉 · 진입 이후부터 종료 이전까지 완전히 포함된 봉 기준' : '15m candles fully contained between entry and exit'}
          </div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-dark-400" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-y border-dark-800 py-2 text-xs text-dark-400">
        <span>{isKo ? '계산 가능' : 'Available'} <strong className="font-mono text-dark-200">{withExcursion.length}/{trades.length}</strong></span>
        <span>{isKo ? '최대 이익 움직임' : 'MFE'} <strong className="font-mono text-bull">+{plain(qualitySummary.averageMfePct)}%</strong></span>
        <span>{isKo ? '최대 손실 움직임' : 'MAE'} <strong className="font-mono text-bear">-{plain(qualitySummary.averageMaePct)}%</strong></span>
        <span>{isKo ? '종료 아쉬움' : 'Exit Miss'} <strong className="font-mono text-amber-300">{goodEntryPoorExit.length}</strong></span>
        <span>{isKo ? '진입 불리' : 'Poor Entry'} <strong className="font-mono text-bear">{poorEntry.length}</strong></span>
      </div>
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-dark-500">
              <tr className="border-b border-dark-700">
                <th className="py-2 text-left">{isKo ? '거래' : 'Trade'}</th>
                <th className="py-2 text-left">{isKo ? '분류' : 'Class'}</th>
                <th className="py-2 text-right">{isKo ? '최대 이익' : 'MFE'}</th>
                <th className="py-2 text-right">{isKo ? '최대 손실' : 'MAE'}</th>
                <th className="py-2 text-right">{isKo ? '실제 가격 움직임' : 'Realized Move'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={trade.entry.id} className="border-b border-dark-800">
                  <td className="py-2 text-dark-200">
                    {trade.entry.symbol} · {trade.entry.direction} · {trade.entry.datetime ? toDateInputValue(new Date(trade.entry.datetime)) : '-'}
                  </td>
                  <td className={`py-2 ${trade.excursion?.classification === 'poor_entry' ? 'text-bear' : 'text-amber-300'}`}>
                    {trade.excursion?.classification === 'poor_entry'
                      ? isKo ? '진입 불리' : 'Poor Entry'
                      : isKo ? '진입 양호·종료 아쉬움' : 'Good Entry · Exit Miss'}
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
  const [returnRange, setReturnRange] = useState<ReturnRangeId>('all');
  const [timeframe, setTimeframe] = useState<AnalysisTimeframe>('4h');
  const [minimumAbsNetReturnPct, setMinimumAbsNetReturnPct] = useState(0);
  const [periodError, setPeriodError] = useState<string | null>(null);

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
  const { refetch: refetchQualityAnalysis } = qualityQuery;
  const refreshDaily = useCallback(() => {
    lastDailyRefreshDateRef.current = toDateInputValue(new Date());
    void refetchJournal();
    if (usesRollingPeriod) {
      const next = buildJournalPeriod(DEFAULT_ANALYSIS_DAYS);
      setDraftPeriod(next);
      setPeriod(next);
    } else {
      void refetchQualityAnalysis();
    }
  }, [refetchJournal, refetchQualityAnalysis, usesRollingPeriod]);

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
  const ongoingEntries = periodEntries;
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
  const sections: Array<{ id: AnalysisSection; label: string }> = [
    { id: 'overview', label: isKo ? '한눈에 보기' : 'Overview' },
    { id: 'entry', label: isKo ? '거래 분석' : 'Trade Analysis' },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            {isKo ? '매매 분석' : 'Trade Analysis'}
          </h1>
          <div className="mt-1 text-xs text-dark-500">{period.start} ~ {period.end} · {isKo ? '연결 거래소 종료 포지션' : 'Connected exchange closed positions'}</div>
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
          <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`min-h-10 px-3 text-xs font-medium transition-colors ${activeSection === section.id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}>
            {section.label}
          </button>
        ))}
      </nav>

      <OngoingPositionFills entries={ongoingEntries} isKo={isKo} />

      {activeSection === 'entry' && <CurrentMarketSimilarityPanel
        coin={selectedCoin}
        allEntries={entries}
        trades={allTrades}
        qualityItems={qualityQuery.data?.items || []}
        isHistoryLoading={isJournalLoading || qualityQuery.isLoading}
        isKo={isKo}
      />}

      {activeSection === 'entry' && <TradeExitReviewList
        entries={entries}
        qualityItems={qualityQuery.data?.items || []}
        direction={direction}
        isKo={isKo}
      />}

      <section className="flex flex-wrap items-center justify-between gap-3 border-y border-dark-700 py-2">
        <div><div className="text-xs font-medium text-dark-200">{isKo ? '분석 방향' : 'Analysis Direction'}</div><div className="mt-0.5 text-[10px] text-dark-500">{isKo ? '아래 진입·청산 품질 통계에 적용' : 'Applied to entry and exit quality statistics'}</div></div>
        <div className="grid min-w-64 grid-cols-2 border border-dark-700 bg-dark-900/35 p-1" aria-label={isKo ? '거래 방향' : 'Trade direction'}>
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

      {activeSection === 'overview' && <TradeQualityAnalysis
        data={qualityQuery.data}
        isLoading={qualityQuery.isLoading || qualityQuery.isFetching}
        isError={qualityQuery.isError}
        isKo={isKo}
        direction={direction}
        onRetry={() => void qualityQuery.refetch()}
      />}

      {activeSection === 'entry' && <details className="group">
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
                <div className="mt-3 space-y-2">{winnerConditions.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><span className="text-dark-200">{timeframe.toUpperCase()} · {item.label}</span><span className="font-mono text-bull">{item.winFrequency.toFixed(0)}% / {item.lossFrequency.toFixed(0)}% <span className="text-dark-500">({signed(item.difference, 0)}%p · n={item.winCount}/{item.lossCount})</span></span></div>)}</div>
              </section>
              <section className="border border-bear/30 bg-bear/5 p-4">
                <h2 className="text-sm font-semibold text-bear">{isKo ? '패배 거래에서 자주 나타난 조건' : 'Conditions More Common in Losses'}</h2>
                <div className="mt-3 space-y-2">{loserConditions.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><span className="text-dark-200">{timeframe.toUpperCase()} · {item.label}</span><span className="font-mono text-bear">{item.winFrequency.toFixed(0)}% / {item.lossFrequency.toFixed(0)}% <span className="text-dark-500">({signed(item.difference, 0)}%p · n={item.winCount}/{item.lossCount})</span></span></div>)}</div>
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

          <TradeQuality trades={selectedTrades} isKo={isKo} isLoading={qualityQuery.isFetching} />
          {(qualityQuery.isError || (qualityQuery.data?.warnings.length || 0) > 1) && <div className="text-xs text-amber-300">{isKo ? '일부 거래의 시장 데이터를 불러오지 못했습니다.' : 'Market data was unavailable for some trades.'}</div>}
        </>
          )}
        </div>
      </details>}
    </div>
  );
}
