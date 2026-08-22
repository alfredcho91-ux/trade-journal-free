import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, X } from 'lucide-react';

import { getTradeReport } from '../../api/client';
import { getDeepcoinTradeMarkers, getExchangeExecutions } from '../../api/journal';
import PositionReviewChart from '../../components/PositionReviewChart';
import TradeIndicatorCharts from '../../components/TradeIndicatorCharts';
import TradeReferenceSummary from '../../components/TradeReferenceSummary';
import type { JournalEntry, TradeExcursion, TradeIndicatorTimeframeSnapshot } from '../../types';
import { resolvePositionEntryTime } from '../../utils/positionReview';
import { ENTRY_REASON_FIELDS, formatEntryReason } from './entryReasons';
import { isClosedPosition } from './journalEntries';
import { tradeOutcomeAssessment } from './tradeOutcomeAssessment';
import {
  flattenSnapshotMetrics,
  formatSnapshotNumber,
  humanizeIndicatorKey,
  KNOWN_SNAPSHOT_INDICATOR_KEYS,
  SNAPSHOT_METADATA_KEYS,
  type SnapshotIndicatorDefinition,
} from './tradeReportSnapshot';

function formatSignedNumber(value: number | null | undefined, maximumFractionDigits = 4): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits })}`;
}

type ReviewMoment = 'entry' | 'exit';
type ReportInterval = '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d';

const REPORT_INTERVALS: ReportInterval[] = ['5m', '15m', '30m', '1h', '2h', '4h', '1d'];
const REPORT_INTERVAL_MS: Record<ReportInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

function coinFromJournalSymbol(symbol?: string): string | null {
  const value = symbol?.toUpperCase().replace(/[-_]/g, '/');
  return value?.split('/')[0] || null;
}

function entryReasonTexts(entry: JournalEntry): string[] {
  return ENTRY_REASON_FIELDS.map(({ indicatorKey, detailKey }) =>
    formatEntryReason(entry, indicatorKey, detailKey),
  ).filter((reason): reason is string => Boolean(reason));
}

export default function TradeReportModal({
  entry,
  allEntries,
  excursion,
  excursionLoading = false,
  isKo,
  onClose,
}: {
  entry: JournalEntry;
  allEntries: JournalEntry[];
  excursion?: TradeExcursion | null;
  excursionLoading?: boolean;
  isKo: boolean;
  onClose: () => void;
}) {
  const [reviewMoment, setReviewMoment] = useState<ReviewMoment>('entry');
  const [reportInterval, setReportInterval] = useState<ReportInterval>('4h');
  const isGenericExchange = Boolean(entry.exchange && entry.exchange !== 'Deepcoin');
  const executionQuery = useQuery({
    queryKey: ['exchange-executions', entry.exchange, entry.symbol, entry.entry_datetime, entry.datetime],
    queryFn: () => getExchangeExecutions({
      exchange: entry.exchange,
      symbol: entry.symbol,
      start_time: entry.entry_datetime,
      end_time: entry.datetime,
    }),
    enabled: isGenericExchange && Boolean(entry.symbol && entry.datetime),
    staleTime: 5 * 60_000,
  });
  const reviewEntries = useMemo(
    () => [...allEntries, ...(executionQuery.data || [])],
    [allEntries, executionQuery.data],
  );
  const resolvedEntryTime = useMemo(
    () => resolvePositionEntryTime(entry, reviewEntries),
    [entry, reviewEntries],
  );
  const matchedEntry = resolvedEntryTime.matchedEntry;
  const splitEntryMarkers = useMemo(
    () => resolvedEntryTime.entryFills.flatMap((fill, index) => {
      if (!fill.datetime || fill.entry_price == null || !Number.isFinite(fill.entry_price)) return [];
      return [{
        datetime: fill.datetime,
        price: fill.entry_price,
        size: fill.size,
        order_id: fill.order_id,
        label: index === 0 ? 'ENTRY' : `ADD${index}`,
      }];
    }),
    [resolvedEntryTime.entryFills],
  );
  const exchangeExitMarkers = useMemo(() => {
    if (entry.exchange === 'Deepcoin' || !resolvedEntryTime.datetime || !entry.datetime) return [];
    const entryMs = new Date(resolvedEntryTime.datetime).getTime();
    const exitMs = new Date(entry.datetime).getTime();
    return reviewEntries
      .filter((candidate) => {
        if (!candidate.source?.endsWith('_fill')) return false;
        if (candidate.exchange !== entry.exchange || candidate.symbol !== entry.symbol) return false;
        if (candidate.direction === entry.direction || !candidate.datetime) return false;
        const candidateMs = new Date(candidate.datetime).getTime();
        return Number.isFinite(candidateMs) && candidateMs >= entryMs && candidateMs <= exitMs;
      })
      .sort((left, right) => new Date(left.datetime as string).getTime() - new Date(right.datetime as string).getTime())
      .flatMap((fill, index) => {
        if (!fill.datetime || fill.entry_price == null || !Number.isFinite(fill.entry_price)) return [];
        return [{
          datetime: fill.datetime,
          price: fill.entry_price,
          size: fill.size,
          order_id: fill.order_id,
          label: `EXIT${index + 1}`,
        }];
      });
  }, [entry, resolvedEntryTime.datetime, reviewEntries]);
  const entrySnapshot = matchedEntry?.indicator_snapshot || null;
  const exitSnapshot = isClosedPosition(entry) ? entry.indicator_snapshot || null : null;
  const activeSnapshot = reviewMoment === 'entry' ? entrySnapshot : exitSnapshot;
  const timeframes = activeSnapshot?.timeframes || {};
  const snapshots = Object.values(timeframes);
  const reasons = entryReasonTexts(entry);
  const outcomeAssessment = excursion ? tradeOutcomeAssessment(excursion, isKo) : null;
  const coin = coinFromJournalSymbol(entry.symbol);
  const exitMs = entry.datetime ? new Date(entry.datetime).getTime() : Number.NaN;
  const entryMs = resolvedEntryTime.datetime
    ? new Date(resolvedEntryTime.datetime).getTime()
    : Number.NaN;
  const referenceDatetime = reviewMoment === 'entry' ? resolvedEntryTime.datetime : entry.datetime || null;
  const referenceMs = referenceDatetime ? new Date(referenceDatetime).getTime() : Number.NaN;
  const durationBars = Number.isFinite(entryMs) && Number.isFinite(exitMs)
    ? Math.ceil(Math.max(0, exitMs - entryMs) / REPORT_INTERVAL_MS[reportInterval])
    : 0;
  const candleLimit = reportInterval === '5m'
    ? 1000
    : Math.min(1000, Math.max(300, durationBars + 120));
  const profileCandleLimit = reportInterval === '5m' ? 1000 : 300;
  const endTime = Number.isFinite(exitMs)
    ? exitMs + REPORT_INTERVAL_MS[reportInterval] * 60
    : undefined;
  const reportQuery = useQuery({
    queryKey: [
      'trade-report',
      coin,
      reportInterval,
      endTime,
      Number.isFinite(referenceMs) ? referenceMs : null,
      candleLimit,
    ],
    queryFn: () => getTradeReport(coin as string, reportInterval, {
      limit: candleLimit,
      end_time: endTime,
      as_of: Number.isFinite(referenceMs) ? referenceMs : undefined,
      profile_candles: profileCandleLimit,
    }),
    enabled: Boolean(coin && endTime),
    staleTime: 5 * 60_000,
  });
  const tradeMarkerQuery = useQuery({
    queryKey: [
      'deepcoin-trade-markers',
      entry.symbol,
      entry.direction,
      resolvedEntryTime.datetime,
      entry.datetime,
      entry.entry_price,
    ],
    queryFn: () => getDeepcoinTradeMarkers({
      symbol: entry.symbol as string,
      direction: entry.direction as 'Long' | 'Short',
      entry_time: resolvedEntryTime.datetime as string,
      exit_time: entry.datetime as string,
      entry_price: entry.entry_price as number,
    }),
    enabled: Boolean(
      isClosedPosition(entry) &&
      entry.exchange === 'Deepcoin' &&
      entry.symbol &&
      (entry.direction === 'Long' || entry.direction === 'Short') &&
      resolvedEntryTime.datetime &&
      entry.datetime &&
      entry.entry_price != null &&
      Number.isFinite(entry.entry_price),
    ),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const knownDefinitions: SnapshotIndicatorDefinition[] = [
    {
      id: 'vpvr',
      label: 'VPVR',
      group: isKo ? '가격·거래량' : 'Price · Volume',
      hasData: (snapshot) =>
        snapshot.vpvr != null &&
        [
          snapshot.vpvr.poc_low,
          snapshot.vpvr.poc_high,
          snapshot.vpvr.poc_mid,
          snapshot.vpvr.value_area_low,
          snapshot.vpvr.value_area_high,
        ].some((value) => value != null),
    },
    {
      id: 'vwap',
      label: 'VWAP',
      group: isKo ? '가격·거래량' : 'Price · Volume',
      hasData: (snapshot) => snapshot.vpvr?.vwap != null,
    },
  ];

  const extraKeys = Array.from(
    new Set(
      snapshots.flatMap((snapshot) =>
        Object.keys(snapshot as Record<string, unknown>).filter(
          (key) => !SNAPSHOT_METADATA_KEYS.has(key) && !KNOWN_SNAPSHOT_INDICATOR_KEYS.has(key),
        ),
      ),
    ),
  ).sort();

  const extraDefinitions: SnapshotIndicatorDefinition[] = extraKeys.map((key) => ({
    id: `extra:${key}`,
    label: humanizeIndicatorKey(key),
    group: isKo ? '기타 저장 지표' : 'Other Saved Indicators',
    hasData: (snapshot) => (snapshot as Record<string, unknown>)[key] != null,
  }));

  const availableIndicators = [...knownDefinitions, ...extraDefinitions].filter((definition) =>
    snapshots.some(definition.hasData),
  );

  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('vpvr');
  const selectedIndicator =
    availableIndicators.find((definition) => definition.id === selectedIndicatorId) ||
    availableIndicators[0];

  const indicatorMetrics = (
    snapshot: TradeIndicatorTimeframeSnapshot,
    indicatorId: string,
  ): Array<{ label: string; value: string }> => {
    if (indicatorId === 'vpvr') {
      const vpvr = snapshot.vpvr;
      return [
        {
          label: `POC (${vpvr?.candles || '-'} bars)`,
          value: `${formatSnapshotNumber(vpvr?.poc_low)} - ${formatSnapshotNumber(vpvr?.poc_high)}`,
        },
        { label: 'POC Mid', value: formatSnapshotNumber(vpvr?.poc_mid) },
        {
          label: 'Value Area 70%',
          value: `${formatSnapshotNumber(vpvr?.value_area_low)} - ${formatSnapshotNumber(vpvr?.value_area_high)}`,
        },
        { label: isKo ? '가격 구간 수' : 'Bins', value: formatSnapshotNumber(vpvr?.bin_count, 0) },
      ];
    }

    if (indicatorId === 'vwap') {
      return [{ label: 'VWAP', value: formatSnapshotNumber(snapshot.vpvr?.vwap) }];
    }

    if (indicatorId.startsWith('extra:')) {
      const key = indicatorId.slice('extra:'.length);
      return flattenSnapshotMetrics((snapshot as Record<string, unknown>)[key]);
    }

    return [];
  };

  const intervals = Object.keys(timeframes);
  const metricLabels = selectedIndicator
    ? Array.from(
        new Set(
          Object.values(timeframes).flatMap((snapshot) =>
            indicatorMetrics(snapshot, selectedIndicator.id).map((metric) => metric.label),
          ),
        ),
      )
    : [];

  const valueFor = (interval: string, metricLabel: string): string => {
    if (!selectedIndicator) return '-';
    const snapshot = timeframes[interval];
    if (!snapshot || snapshot.status !== 'complete' || !selectedIndicator.hasData(snapshot)) return '-';
    return indicatorMetrics(snapshot, selectedIndicator.id).find((metric) => metric.label === metricLabel)?.value || '-';
  };

  const momentTitle = reviewMoment === 'entry'
    ? isKo ? '진입근거' : 'Entry rationale'
    : isKo ? '종료근거' : 'Exit rationale';

  const sourceTime = reviewMoment === 'entry'
    ? matchedEntry?.datetime
    : entry.datetime;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-2 sm:p-4">
      <div className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden border border-dark-700 bg-dark-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-dark-700 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-white">{isKo ? '거래 리포트' : 'Trade Report'}</h2>
              <span className={`text-xs font-semibold ${entry.direction === 'Long' ? 'text-bull' : 'text-bear'}`}>
                {entry.direction || '-'}
              </span>
              {isClosedPosition(entry) && (
                <span className="border border-bull/30 bg-bull/10 px-1.5 py-0.5 text-[10px] text-bull">CLOSED</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dark-400">
              <span className="font-medium text-dark-200">{entry.symbol || '-'}</span>
              <span>{entry.datetime ? new Date(entry.datetime).toLocaleString() : '-'}</span>
              <span>
                {isKo ? '진입가' : 'Entry'}{' '}
                <strong className="font-mono text-dark-100">{formatSnapshotNumber(entry.entry_price, 6)}</strong>
              </span>
              <span>
                {isKo ? '종료가' : 'Exit'}{' '}
                <strong className="font-mono text-dark-100">{formatSnapshotNumber(entry.exit_price, 6)}</strong>
              </span>
              {entry.realized_pnl != null && (
                <span className={`font-mono font-semibold ${entry.realized_pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                  {formatSignedNumber(entry.realized_pnl, 4)} USDT
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-dark-400 transition-colors hover:text-white"
            title={isKo ? '닫기' : 'Close'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isClosedPosition(entry) && (
            <div className="mb-5 border-y border-dark-700 py-3">
              <div className="text-[11px] font-semibold text-dark-500">
                {isKo ? '결과 판정' : 'Outcome Assessment'}
              </div>
              {outcomeAssessment ? (
                <div className="mt-1">
                  <div className={`text-sm font-semibold ${outcomeAssessment.tone === 'negative' ? 'text-bear' : outcomeAssessment.tone === 'warning' ? 'text-amber-300' : 'text-primary-300'}`}>
                    {outcomeAssessment.label}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-dark-300">{outcomeAssessment.explanation}</div>
                  <div className="mt-1 text-[11px] font-mono text-dark-500">
                    MFE +{formatSnapshotNumber(excursion?.mfe_pct)}% · MAE -{formatSnapshotNumber(excursion?.mae_pct)}% · {isKo ? '종료' : 'Exit'} {formatSignedNumber(excursion?.realized_move_pct, 2)}%
                  </div>
                  <div className="mt-0.5 text-[10px] text-dark-500">
                    {isKo ? '15분봉 가격 움직임 기준 · 수수료·펀딩 제외' : '15m price-move basis · excludes fees and funding'}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-xs text-dark-500">
                  {excursionLoading
                    ? isKo ? 'MFE/MAE 판정 계산 중' : 'Calculating MFE/MAE assessment'
                    : isKo ? '판정 데이터 없음' : 'Assessment unavailable'}
                </div>
              )}
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setReviewMoment('entry')}
              className={`border px-4 py-3 text-left transition-colors ${
                reviewMoment === 'entry'
                  ? 'border-primary-500/60 bg-primary-500/15 text-white'
                  : 'border-dark-700 bg-dark-900/35 text-dark-400 hover:text-white'
              }`}
            >
              <div className="text-sm font-semibold">{isKo ? '진입근거' : 'Entry rationale'}</div>
              <div className="mt-0.5 text-[11px] text-dark-500">
                {entrySnapshot
                  ? sourceTime
                    ? `${new Date(sourceTime).toLocaleString()}${resolvedEntryTime.confidence === 'estimated' ? isKo ? ' · 추정' : ' · Estimated' : ''}`
                    : isKo ? '진입 시점 스냅샷' : 'Entry snapshot'
                  : isKo ? '진입 스냅샷 없음' : 'No entry snapshot'}
              </div>
            </button>
              <button
                type="button"
                onClick={() => setReviewMoment('exit')}
                disabled={!entry.datetime}
              className={`border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                reviewMoment === 'exit'
                  ? 'border-primary-500/60 bg-primary-500/15 text-white'
                  : 'border-dark-700 bg-dark-900/35 text-dark-400 hover:text-white'
              }`}
            >
              <div className="text-sm font-semibold">{isKo ? '종료근거' : 'Exit rationale'}</div>
              <div className="mt-0.5 text-[11px] text-dark-500">
                {entry.datetime
                  ? new Date(entry.datetime).toLocaleString()
                  : isKo ? '종료 시점 확인 불가' : 'Exit time unavailable'}
              </div>
            </button>
          </div>

          {reviewMoment === 'entry' && reasons.length > 0 && (
            <div className="mb-4 border border-dark-700 bg-dark-900/35 p-3">
              <div className="mb-2 text-[11px] font-semibold text-dark-500">
                {isKo ? '기록된 진입 근거' : 'Saved entry rationale'}
              </div>
              <div className="flex flex-wrap gap-2">
                {reasons.map((reason, index) => (
                  <span key={`${reason}-${index}`} className="border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-dark-200">
                    {index + 1}. {reason}
                  </span>
                ))}
              </div>
            </div>
          )}

          <section className="mb-5">
            <div className="mb-3 flex flex-col gap-3 border-y border-dark-700 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-4 border border-dark-700 bg-dark-900/40 p-1 sm:grid-cols-7">
                {REPORT_INTERVALS.map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    onClick={() => setReportInterval(interval)}
                    className={`min-w-0 px-2.5 py-1.5 text-xs font-semibold uppercase transition-colors sm:min-w-14 ${
                      reportInterval === interval
                        ? 'bg-primary-500 text-white'
                        : 'text-dark-400 hover:text-white'
                    }`}
                  >
                    {interval}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-dark-500">
                {reportQuery.data?.source || 'Binance Spot'} · {candleLimit}{isKo ? '봉' : ' bars'}
                {reportQuery.data?.profile_as_of
                  ? ` · VPVR/VWAP ${new Date(reportQuery.data.profile_as_of).toLocaleString()}`
                  : ''}
              </div>
            </div>

            {reportQuery.isLoading ? (
              <div className="flex h-[520px] items-center justify-center gap-2 border border-dark-700 bg-[#0b1220] text-sm text-dark-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isKo ? '거래 리포트 불러오는 중' : 'Loading trade report'}
              </div>
            ) : reportQuery.isError ? (
              <div className="flex h-48 items-center justify-center border border-dark-700 bg-[#0b1220] px-5 text-sm text-bear">
                <AlertCircle className="mr-2 h-4 w-4" />
                {isKo ? '거래 리포트 데이터를 불러오지 못했습니다.' : 'Could not load trade report data.'}
              </div>
            ) : reportQuery.data?.candles.length ? (
              <div className="space-y-4">
                {!Number.isFinite(referenceMs) && (
                  <div className="border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                    {isKo
                      ? '진입시간 확인 불가: 캔들은 표시하지만 진입 시점 VPVR/VWAP는 계산하지 않습니다.'
                      : 'Entry time unavailable: candles are shown without entry-time VPVR/VWAP.'}
                  </div>
                )}
                <PositionReviewChart
                  data={reportQuery.data.candles}
                  direction={entry.direction}
                  entryTime={resolvedEntryTime.datetime}
                  entryTimeConfidence={resolvedEntryTime.confidence}
                  exitTime={entry.datetime as string}
                  entryPrice={entry.entry_price}
                  exitPrice={entry.exit_price}
                  entryEvents={splitEntryMarkers}
                  takeProfitEvents={tradeMarkerQuery.data?.take_profits || exchangeExitMarkers}
                />
                {tradeMarkerQuery.data?.warnings.map((warning) => (
                  <div key={warning} className="border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                    {warning}
                  </div>
                ))}
                <TradeReferenceSummary
                  vpvr={reportQuery.data.vpvr}
                  vwaps={reportQuery.data.vwaps}
                  isKo={isKo}
                />
                <TradeIndicatorCharts
                  series={reportQuery.data.series}
                  latest={reportQuery.data.latest}
                  entryTime={resolvedEntryTime.datetime}
                  exitTime={entry.datetime || null}
                  referenceLabel={reviewMoment === 'entry' ? 'ENTRY' : 'EXIT'}
                />
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center border border-dark-700 bg-[#0b1220] text-sm text-dark-500">
                {isKo ? '표시할 거래 리포트 데이터가 없습니다.' : 'No trade report data is available.'}
              </div>
            )}
          </section>

          {activeSnapshot && intervals.length > 0 && availableIndicators.length > 0 && (
            <>
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-white">{momentTitle}</div>
                  {reviewMoment === 'entry' && isClosedPosition(entry) && matchedEntry && (
                    <span className={`text-[10px] ${resolvedEntryTime.confidence === 'estimated' ? 'text-amber-300' : 'text-dark-500'}`}>
                      {resolvedEntryTime.confidence === 'estimated'
                        ? isKo ? '진입 체결 추정값' : 'Estimated entry fill'
                        : isKo ? `${entry.exchange || '거래소'} 주문 체결 확인` : `Confirmed ${entry.exchange || 'exchange'} order fill`}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {availableIndicators.map((definition) => {
                    const isSelected = selectedIndicator?.id === definition.id;
                    return (
                      <button
                        key={definition.id}
                        type="button"
                        onClick={() => setSelectedIndicatorId(definition.id)}
                        className={`border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary-500/60 bg-primary-500/15 text-primary-200'
                            : 'border-dark-700 bg-dark-900/35 text-dark-300 hover:border-dark-600 hover:text-white'
                        }`}
                      >
                        {definition.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-x-auto border border-dark-700">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-dark-900/70">
                    <tr className="border-b border-dark-700">
                      <th className="w-44 px-4 py-2.5 text-left text-[11px] font-semibold text-dark-500">
                        {selectedIndicator?.label || (isKo ? '지표' : 'Indicator')}
                      </th>
                      {intervals.map((interval) => (
                        <th key={interval} className="px-4 py-2.5 text-center text-xs font-semibold text-white">
                          {interval.toUpperCase()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metricLabels.map((metricLabel) => (
                      <tr key={metricLabel} className="border-b border-dark-800 last:border-b-0">
                        <td className="px-4 py-3 text-xs text-dark-400">{metricLabel}</td>
                        {intervals.map((interval) => (
                          <td key={`${metricLabel}-${interval}`} className="px-4 py-3 text-center font-mono text-sm text-dark-100">
                            {valueFor(interval, metricLabel)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
