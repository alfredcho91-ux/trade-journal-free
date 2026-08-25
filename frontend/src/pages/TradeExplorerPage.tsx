import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { getJournal, getJournalQualityAnalysis } from '../api/client';
import CurrentMarketSimilarityPanel from '../features/tradeAnalysis/CurrentMarketSimilarityPanel';
import EvidenceTradePanel from '../features/tradeAnalysis/EvidenceTradePanel';
import TradeExitReviewList from '../features/tradeAnalysis/TradeExitReviewList';
import { buildAnalyzedTrades } from '../features/tradeAnalysis/tradeAnalysis';
import { useEvidenceNavigation, type EvidenceRequest } from '../features/tradeAnalysis/evidenceNavigation';
import { AnalysisAccordion } from '../features/tradeAnalysis/AnalysisGroup';
import { buildJournalPeriod, dateBoundaryTimestamp, isJournalEntryWithinPeriod, type JournalPeriod } from '../features/journal/journalPeriod';
import { journalQueryKeys } from '../features/journal/journalQueryKeys';
import { useLanguage, useSelectedCoin } from '../store/useStore';

type Direction = 'Long' | 'Short';

function isSamePeriod(left: JournalPeriod, right: JournalPeriod): boolean {
  return left.start === right.start && left.end === right.end;
}

export default function TradeExplorerPage() {
  const isKo = useLanguage() === 'ko';
  const selectedCoin = useSelectedCoin();
  const evidenceRequest = useEvidenceNavigation((state) => state.request);
  const setEvidenceRequest = useEvidenceNavigation((state) => state.setRequest);
  const clearEvidenceRequest = useEvidenceNavigation((state) => state.clearRequest);
  const [period, setPeriod] = useState<JournalPeriod>(() => evidenceRequest?.period || buildJournalPeriod(90));
  const [direction, setDirection] = useState<Direction>(() => evidenceRequest?.direction || 'Long');

  useEffect(() => {
    if (!evidenceRequest) return;
    if (!isSamePeriod(period, evidenceRequest.period)) setPeriod(evidenceRequest.period);
    if (direction !== evidenceRequest.direction) setDirection(evidenceRequest.direction);
  }, [direction, evidenceRequest, period]);

  const startTime = dateBoundaryTimestamp(period.start);
  const endTime = dateBoundaryTimestamp(period.end, true);
  const { data: entries = [], isLoading: isJournalLoading, isError: isJournalError, refetch: refetchJournal } = useQuery({
    queryKey: journalQueryKeys.entries,
    queryFn: getJournal,
  });
  const qualityQuery = useQuery({
    queryKey: journalQueryKeys.qualityAnalysis(startTime, endTime, 0),
    queryFn: () => getJournalQualityAnalysis({ start_time: startTime as number, end_time: endTime as number, min_abs_net_return_pct: 0 }),
    enabled: startTime != null && endTime != null && startTime <= endTime,
    staleTime: 30 * 60_000,
  });
  const periodTrades = useMemo(() => {
    const excursions = qualityQuery.data?.items
      .map((item) => item.excursion)
      .filter((item): item is NonNullable<typeof item> => item != null) || [];
    return buildAnalyzedTrades(entries, excursions)
      .filter((trade) => isJournalEntryWithinPeriod(trade.entry, period));
  }, [entries, period, qualityQuery.data?.items]);
  const directionTrades = useMemo(() => periodTrades.filter((trade) => trade.entry.direction === direction), [direction, periodTrades]);
  const defaultRequest = useMemo<EvidenceRequest>(() => ({
    title: isKo ? '현재 필터의 종료 거래' : 'Closed trades in the current filter',
    filterLabel: `${direction.toUpperCase()} · ${period.start} ~ ${period.end} · ${directionTrades.length}${isKo ? '건' : ' trades'}`,
    tradeIds: directionTrades.flatMap((trade) => trade.entry.id == null ? [] : [trade.entry.id]),
    period,
    direction,
  }), [direction, directionTrades, isKo, period]);
  const activeRequest = evidenceRequest && isSamePeriod(evidenceRequest.period, period) ? evidenceRequest : defaultRequest;
  const openEvidence = (title: string, tradeIds: number[]) => {
    setEvidenceRequest({
      title,
      filterLabel: `${direction.toUpperCase()} · ${period.start} ~ ${period.end} · ${tradeIds.length}${isKo ? '건' : ' trades'}`,
      tradeIds: [...new Set(tradeIds)],
      period,
      direction,
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-dark-700 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><Search className="h-5 w-5 text-primary-300" />{isKo ? '거래 탐색 · 근거 거래' : 'Trade Explorer · Evidence'}</h1>
          <p className="mt-1 text-xs text-dark-500">{isKo ? '분석 결과의 근거 거래를 확인하고, 한 건씩 차트로 복기합니다.' : 'Inspect evidence trades behind analysis results and review each trade on its chart.'}</p>
        </div>
        <div className="flex border border-dark-700 bg-dark-950/50 p-1">
          {(['Long', 'Short'] as Direction[]).map((item) => <button key={item} type="button" onClick={() => { setDirection(item); clearEvidenceRequest(); }} className={`min-h-8 px-3 text-xs font-medium ${direction === item ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400 hover:text-white'}`}>{item.toUpperCase()}</button>)}
        </div>
      </header>
      <div className="text-xs text-dark-500">{direction.toUpperCase()} · {period.start} ~ {period.end} · {isKo ? '현재 분석 기간 기준' : 'Current analysis period'}</div>
      {isJournalError && <div className="flex items-center justify-between gap-3 border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-xs text-amber-200"><span>{isKo ? '거래 기록을 불러오지 못했습니다.' : 'Trade history could not be loaded.'}</span><button type="button" onClick={() => void refetchJournal()} className="border border-amber-300/40 px-2 py-1">{isKo ? '재시도' : 'Retry'}</button></div>}
      <EvidenceTradePanel request={activeRequest} trades={periodTrades} qualityItems={qualityQuery.data?.items || []} entries={entries} isKo={isKo} onClear={clearEvidenceRequest} />
      <AnalysisAccordion title={isKo ? '현재 차트와 유사한 과거 거래 보기' : 'View past trades similar to the current chart'}>
        <CurrentMarketSimilarityPanel coin={selectedCoin} allEntries={entries} trades={directionTrades} qualityItems={qualityQuery.data?.items || []} isHistoryLoading={isJournalLoading || qualityQuery.isLoading} isKo={isKo} />
      </AnalysisAccordion>
      <AnalysisAccordion title={isKo ? '거래별 청산 복기 보기' : 'View exit review by trade'}>
        <TradeExitReviewList entries={entries} qualityItems={qualityQuery.data?.items || []} direction={direction} isKo={isKo} onViewAll={(journalIds) => openEvidence(isKo ? '거래별 청산 복기 근거 거래' : 'Trade exit review evidence', journalIds)} />
      </AnalysisAccordion>
    </div>
  );
}
