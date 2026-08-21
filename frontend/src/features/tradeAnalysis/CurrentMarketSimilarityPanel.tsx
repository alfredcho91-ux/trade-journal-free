import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CandlestickChart, Loader2, RefreshCw } from 'lucide-react';

import { getJournalCurrentMarket } from '../../api/client';
import ErrorNotice from '../../components/ErrorNotice';
import TradeReportModal from '../journal/TradeReportModal';
import { journalQueryKeys } from '../journal/journalQueryKeys';
import { useHourlyRefresh } from '../../hooks/useHourlyRefresh';
import type { Coin, JournalEntry, TradeQualityItem } from '../../types';
import type { AnalyzedTrade } from './tradeAnalysis';
import {
  buildCurrentMarketSimilarities,
  MIN_CURRENT_MARKET_SIMILARITY_PCT,
  selectCurrentMarketSimilarities,
  trendDirectionLabel,
} from './currentMarketSimilarity';

interface CurrentMarketSimilarityPanelProps {
  coin: Coin;
  allEntries: JournalEntry[];
  trades: AnalyzedTrade[];
  qualityItems: TradeQualityItem[];
  isHistoryLoading: boolean;
  isKo: boolean;
}

function percent(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function similarity(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '-' : `${value.toFixed(0)}%`;
}

function formatDate(value: string | null, isKo: boolean, includeTime = false): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  if (!isKo) {
    return includeTime
      ? date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const dateText = `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, '0')}월 ${String(date.getDate()).padStart(2, '0')}일`;
  return includeTime
    ? `${dateText} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : dateText;
}

export default function CurrentMarketSimilarityPanel({
  coin,
  allEntries,
  trades,
  qualityItems,
  isHistoryLoading,
  isKo,
}: CurrentMarketSimilarityPanelProps) {
  const [selectedTrade, setSelectedTrade] = useState<AnalyzedTrade | null>(null);
  const query = useQuery({
    queryKey: journalQueryKeys.currentMarket(coin),
    queryFn: () => getJournalCurrentMarket(coin),
    staleTime: 60 * 60_000,
    gcTime: 65 * 60_000,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
    retry: 1,
  });
  const refetch = query.refetch;
  const refreshCurrent = useCallback(() => {
    void refetch();
  }, [refetch]);
  const refresh = useHourlyRefresh(refreshCurrent);
  const candidates = useMemo(
    () => query.data
      ? buildCurrentMarketSimilarities(query.data, trades, qualityItems)
      : [],
    [qualityItems, query.data, trades],
  );
  const rows = useMemo(() => selectCurrentMarketSimilarities(candidates), [candidates]);
  const bestCandidate = candidates[0] || null;
  const winners = rows.filter((row) => row.outcome === 'win');
  const losses = rows.filter((row) => row.outcome === 'loss');
  const winnerDirection = winners.length === 0
    ? '-'
    : winners.filter((row) => row.trade.entry.direction === 'Long').length
      >= winners.filter((row) => row.trade.entry.direction === 'Short').length
      ? 'LONG'
      : 'SHORT';
  const winnerReturns = winners.flatMap((row) => row.netReturnPct ?? []);
  const averageWinnerReturn = winnerReturns.length > 0
    ? winnerReturns.reduce((sum, value) => sum + value, 0) / winnerReturns.length
    : null;
  const isLoading = query.isLoading || isHistoryLoading;

  return (
    <section className="border border-dark-700 bg-dark-900/25">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-primary-400" />
            {isKo ? '현재 차트와 유사한 과거 거래' : 'Past Trades Similar to the Current Chart'}
          </h2>
          <div className="mt-1 text-[11px] text-dark-500">
            {query.data
              ? `${query.data.symbol} · ${trendDirectionLabel(query.data.trend_states)} · ${formatDate(query.data.as_of, isKo, true)}`
              : `${coin}/USDT`}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={query.isFetching}
          className="rounded p-1.5 text-dark-300 hover:bg-dark-700 hover:text-white disabled:opacity-40"
          title={isKo ? '현재 시장 다시 계산' : 'Refresh current market'}
          aria-label={isKo ? '현재 시장 다시 계산' : 'Refresh current market'}
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {query.isError ? (
        <div className="p-4">
          <ErrorNotice
            title={isKo ? '현재 시장 유사 거래를 계산하지 못했습니다' : 'Current-market similarity is unavailable'}
            message={isKo ? 'Binance 현재 데이터 또는 저장된 거래 데이터를 확인할 수 없습니다.' : 'Current Binance or saved trade data is unavailable.'}
            actionLabel={isKo ? '다시 계산' : 'Retry'}
            actionDisabled={query.isFetching}
            onAction={refresh}
          />
        </div>
      ) : isLoading ? (
        <div className="flex h-36 items-center justify-center text-xs text-dark-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {isKo ? '현재 시장과 과거 진입을 비교하는 중' : 'Comparing current and historical entries'}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-dark-500">
          {bestCandidate
            ? isKo
              ? `완전한 비교 후보 ${candidates.length}건 중 ${MIN_CURRENT_MARKET_SIMILARITY_PCT}% 이상은 없습니다. 최고 ${similarity(bestCandidate.similarityPct)} · 억지로 상위 거래를 채우지 않습니다.`
              : `None of ${candidates.length} complete candidates reached ${MIN_CURRENT_MARKET_SIMILARITY_PCT}%. Best: ${similarity(bestCandidate.similarityPct)}.`
            : isKo
              ? `${coin}의 확정 진입 데이터와 전체 지표를 갖춘 비교 거래가 없습니다.`
              : `No ${coin} trade has a confirmed entry with complete comparison data.`}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-7 gap-y-2 border-b border-dark-800 px-4 py-2.5 text-xs text-dark-400">
            <span>{isKo ? '상위 유사 거래' : 'Top Matches'} <strong className="ml-1 font-mono text-white">{rows.length}</strong></span>
            <span>{isKo ? '승리 / 패배' : 'Wins / Losses'} <strong className="ml-1 font-mono text-bull">{winners.length}</strong> / <strong className="font-mono text-bear">{losses.length}</strong></span>
            <span>{isKo ? '유사 승리 방향' : 'Winning Side'} <strong className="ml-1 font-mono text-primary-300">{winnerDirection}</strong></span>
            <span>{isKo ? '승리 평균 순수익률' : 'Avg Win Net Return'} <strong className="ml-1 font-mono text-bull">{percent(averageWinnerReturn)}</strong></span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="text-dark-500">
                <tr className="border-b border-dark-700">
                  <th className="px-4 py-2 text-left">{isKo ? '과거 진입' : 'Historical Entry'}</th>
                  <th className="py-2 text-left">{isKo ? '당시 추세' : 'Entry Trend'}</th>
                  <th className="py-2 text-center">{isKo ? '진입 방향' : 'Side'}</th>
                  <th className="py-2 text-right">{isKo ? '일치도' : 'Similarity'}</th>
                  <th className="py-2 text-center">{isKo ? '결과' : 'Result'}</th>
                  <th className="py-2 text-right">{isKo ? '순수익률' : 'Net Return'}</th>
                  <th className="py-2 text-right">MFE</th>
                  <th className="px-4 py-2 text-right">{isKo ? '청산 후 추가폭' : 'Post-exit Move'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pnl = row.trade.entry.realized_pnl;
                  const resultClass = row.outcome === 'win' ? 'text-bull' : row.outcome === 'loss' ? 'text-bear' : 'text-dark-300';
                  return (
                    <tr key={row.trade.entry.id} className="border-b border-dark-800 last:border-b-0">
                      <td className="px-4 py-2.5 text-dark-200">
                        <button
                          type="button"
                          onClick={() => setSelectedTrade(row.trade)}
                          className="group text-left hover:text-primary-200"
                          title={isKo ? '거래 분석 보고서 열기' : 'Open trade analysis report'}
                        >
                          <span className="flex items-center gap-1.5">
                            {formatDate(row.trade.entryDatetime, isKo)}
                            <CandlestickChart className="h-3.5 w-3.5 text-amber-300 transition-colors group-hover:text-amber-100" />
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] text-dark-600">#{row.trade.entry.id}</span>
                        </button>
                      </td>
                      <td className="py-2.5 font-mono text-dark-300">
                        {trendDirectionLabel(row.qualityItem?.trend_states || {})}
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={row.trade.entry.direction === 'Long' ? 'text-bull' : 'text-bear'}>
                          {row.trade.entry.direction?.toUpperCase() || '-'}
                        </span>
                        <div className="mt-0.5 text-[10px] text-dark-600">
                          {row.directionAlignment === 'with_trend'
                            ? isKo ? '현재 추세 순방향' : 'With current trend'
                            : row.directionAlignment === 'counter_trend'
                              ? isKo ? '현재 추세 역방향' : 'Counter current trend'
                              : isKo ? '현재 중립' : 'Current neutral'}
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-white">
                        {similarity(row.similarityPct)}
                        <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-dark-500">
                          {isKo ? '추세' : 'T'} {similarity(row.trendSimilarityPct)} · {isKo ? '지표' : 'I'} {similarity(row.indicatorSimilarityPct)} · {row.matchedIndicatorTimeframes}TF/{row.matchedIndicatorMetrics}
                        </div>
                      </td>
                      <td className={`py-2.5 text-center font-semibold ${resultClass}`}>
                        {row.outcome === 'win' ? (isKo ? '승리' : 'Win') : row.outcome === 'loss' ? (isKo ? '패배' : 'Loss') : (isKo ? '보합' : 'Flat')}
                      </td>
                      <td className={`py-2.5 text-right font-mono ${resultClass}`}>
                        {percent(row.netReturnPct)}
                        <div className="mt-0.5 text-[10px] text-dark-500">
                          {pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT` : '-'}
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono text-bull">{percent(row.mfePct)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-300">{percent(row.postExitPotentialPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!isLoading && !query.isError && (
        <details className="border-t border-dark-800 px-4 py-2 text-[10px] text-dark-500">
          <summary className="cursor-pointer select-none hover:text-dark-300">{isKo ? '유사도 계산 기준' : 'Similarity methodology'}</summary>
          <div className="mt-2 grid gap-1 leading-5 md:grid-cols-2">
            <span>{isKo ? '후보: 같은 종목 · 확정 최초 진입 · 7개 타임프레임 전체 데이터' : 'Candidates: same symbol, confirmed first entry, complete seven-timeframe data'}</span>
            <span>{isKo ? '추세 45%: Weekly 25% · Daily 35% · 4H 40%' : 'Trend 45%: Weekly 25%, Daily 35%, 4H 40%'}</span>
            <span>{isKo ? '지표 55%: 1H 15% · 2H 20% · 4H 40% · 1D 25%' : 'Indicators 55%: 1H 15%, 2H 20%, 4H 40%, 1D 25%'}</span>
            <span>{isKo ? '지표 구성: RSI 15% · Stoch 계열 35% · MACD 20% · VWAP 15% · VPVR 15%' : 'Indicator mix: RSI 15%, Stoch family 35%, MACD 20%, VWAP 15%, VPVR 15%'}</span>
            <span>{isKo ? `${MIN_CURRENT_MARKET_SIMILARITY_PCT}% 이상만 표시 · LONG/SHORT와 손익은 점수에서 제외` : `Only ${MIN_CURRENT_MARKET_SIMILARITY_PCT}%+ shown; side and PnL are excluded from scoring`}</span>
          </div>
        </details>
      )}
      {selectedTrade && (
        <TradeReportModal
          entry={selectedTrade.entry}
          allEntries={allEntries}
          excursion={selectedTrade.excursion}
          excursionLoading={isHistoryLoading}
          isKo={isKo}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </section>
  );
}
