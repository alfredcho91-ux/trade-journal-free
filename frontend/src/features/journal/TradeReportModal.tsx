import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, X } from 'lucide-react';

import { getTradeReport } from '../../api/client';
import { getDeepcoinTradeMarkers, getExchangeExecutions } from '../../api/journal';
import PositionReviewChart, { type TradePathChartMarker } from '../../components/PositionReviewChart';
import TradeIndicatorCharts from '../../components/TradeIndicatorCharts';
import TradeReferenceSummary from '../../components/TradeReferenceSummary';
import type { JournalEntry, TradeExcursion, TradeIndicatorTimeframeSnapshot, TradeQualityItem } from '../../types';
import { anchoredVwapSampleLabel, anchoredVwapZoneLabel } from '../../utils/indicatorLabels';
import { resolvePositionEntryTime } from '../../utils/positionReview';
import { ENTRY_REASON_FIELDS, formatEntryReason } from './entryReasons';
import { isClosedPosition } from './journalEntries';
import { tradeOutcomeAssessment } from './tradeOutcomeAssessment';
import TradeBehaviorEditor from './TradeBehaviorEditor';
import {
  buildTradePathSummary,
  tradePathMarkerLabel,
  tradePathSummaryText,
  type TradePathInterval,
} from './tradePathSummary';
import TradeExitReview from '../tradeAnalysis/TradeExitReviewPanel';
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

function macdCrossLabel(
  value: 'golden' | 'dead' | 'none' | undefined,
  isKo: boolean,
): string {
  if (value === 'golden') return isKo ? '골든크로스' : 'Golden cross';
  if (value === 'dead') return isKo ? '데드크로스' : 'Dead cross';
  return '-';
}

type ReviewMoment = 'entry' | 'exit';
type ReportInterval = '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M';

const REPORT_INTERVALS: ReportInterval[] = ['5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M'];
const REPORT_INTERVAL_MS: Record<ReportInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000,
};

const PATH_INTERVAL_MS: Record<TradePathInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
};
const MAX_PATH_CANDLES = 950;

function pathRequestConfig(entryMs: number, exitMs: number): { interval: TradePathInterval; limit: number } | null {
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs < entryMs) return null;
  const duration = exitMs - entryMs;
  for (const interval of ['5m', '15m'] as const) {
    const durationBars = Math.ceil(duration / PATH_INTERVAL_MS[interval]);
    if (durationBars <= MAX_PATH_CANDLES) return { interval, limit: Math.max(100, durationBars + 12) };
  }
  return null;
}

function coinFromJournalSymbol(symbol?: string): string | null {
  const value = symbol?.toUpperCase().replace(/[-_]/g, '/');
  return value?.split('/')[0] || null;
}

function entryReasonTexts(entry: JournalEntry): string[] {
  return ENTRY_REASON_FIELDS.map(({ indicatorKey, detailKey }) =>
    formatEntryReason(entry, indicatorKey, detailKey),
  ).filter((reason): reason is string => Boolean(reason));
}

function holdingDurationLabel(entryTime: number, exitTime: number, isKo: boolean): string {
  if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime) || exitTime < entryTime) return '-';
  const minutes = Math.round((exitTime - entryTime) / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (isKo) return hours > 0 ? `${hours}시간 ${remainingMinutes}분` : `${remainingMinutes}분`;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function CompactSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-dark-700 bg-dark-900/25 p-3 sm:p-4">
      <h3 className="border-b border-dark-700 pb-2 text-xs font-semibold text-dark-200">{title}</h3>
      <div className="pt-3">{children}</div>
    </section>
  );
}

function CompactMetric({
  label,
  value,
  tone = 'text-dark-100',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="border border-dark-800 bg-dark-950/45 px-2.5 py-2">
      <div className="text-[10px] text-dark-500">{label}</div>
      <div className={`mt-1 break-words font-mono text-xs font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function TradeReportModal({
  entry,
  allEntries,
  excursion,
  excursionLoading = false,
  qualityItem,
  isKo,
  onClose,
  onBehaviorUpdated,
}: {
  entry: JournalEntry;
  allEntries: JournalEntry[];
  excursion?: TradeExcursion | null;
  excursionLoading?: boolean;
  qualityItem?: TradeQualityItem | null;
  isKo: boolean;
  onClose: () => void;
  onBehaviorUpdated?: () => void;
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
  const resolvedExcursion = excursion || qualityItem?.excursion || null;
  const outcomeAssessment = resolvedExcursion
    ? tradeOutcomeAssessment(resolvedExcursion, qualityItem?.quality_class, isKo)
    : null;
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
  const pathConfig = useMemo(
    () => pathRequestConfig(entryMs, exitMs),
    [entryMs, exitMs],
  );
  const endTime = Number.isFinite(exitMs)
    ? exitMs + REPORT_INTERVAL_MS[reportInterval] * 60
    : undefined;
  const exchangeId = String(entry.exchange || '').trim().toLowerCase();
  const reportExchange = ['deepcoin', 'binance', 'bybit', 'okx'].includes(exchangeId)
    ? exchangeId as 'deepcoin' | 'binance' | 'bybit' | 'okx'
    : undefined;
  const reportInstrumentType = String(entry.tags || '').split(',').map((tag) => tag.trim().toLowerCase()).includes('spot')
    ? 'SPOT' as const
    : 'SWAP' as const;
  const reportQuery = useQuery({
    queryKey: [
      'trade-report',
      coin,
      reportInterval,
      endTime,
      Number.isFinite(referenceMs) ? referenceMs : null,
      candleLimit,
      reportExchange,
      reportInstrumentType,
    ],
    queryFn: () => getTradeReport(coin as string, reportInterval, {
      limit: candleLimit,
      end_time: endTime,
      as_of: Number.isFinite(referenceMs) ? referenceMs : undefined,
      profile_candles: profileCandleLimit,
      exchange: reportExchange,
      instrument_type: reportInstrumentType,
    }),
    enabled: Boolean(coin && endTime),
    staleTime: 5 * 60_000,
  });
  const pathQuery = useQuery({
    queryKey: ['trade-path-summary', coin, pathConfig?.interval, pathConfig?.limit, entryMs, exitMs, entry.entry_price, entry.exit_price, entry.direction, reportExchange, reportInstrumentType],
    queryFn: () => getTradeReport(coin as string, pathConfig!.interval, {
      limit: pathConfig!.limit,
      end_time: exitMs + PATH_INTERVAL_MS[pathConfig!.interval] * 2,
      as_of: entryMs,
      profile_candles: 100,
      exchange: reportExchange,
      instrument_type: reportInstrumentType,
    }),
    enabled: Boolean(
      isClosedPosition(entry)
      && coin
      && pathConfig
      && (entry.direction === 'Long' || entry.direction === 'Short')
      && entry.entry_price != null && Number.isFinite(entry.entry_price)
      && entry.exit_price != null && Number.isFinite(entry.exit_price),
    ),
    staleTime: 5 * 60_000,
  });
  const pathSummary = useMemo(() => {
    if (
      pathConfig == null || pathQuery.data == null || resolvedEntryTime.datetime == null || entry.datetime == null
      || entry.entry_price == null || entry.exit_price == null || (entry.direction !== 'Long' && entry.direction !== 'Short')
    ) return null;
    return buildTradePathSummary({
      candles: pathQuery.data.candles,
      direction: entry.direction,
      entry_time: resolvedEntryTime.datetime,
      exit_time: entry.datetime,
      entry_price: entry.entry_price,
      exit_price: entry.exit_price,
      interval: pathConfig.interval,
    });
  }, [entry.datetime, entry.direction, entry.entry_price, entry.exit_price, pathConfig, pathQuery.data, resolvedEntryTime.datetime]);
  const pathEvents = useMemo<TradePathChartMarker[]>(() => {
    if (pathSummary == null || (entry.direction !== 'Long' && entry.direction !== 'Short')) return [];
    const favorablePosition = entry.direction === 'Long' ? 'aboveBar' : 'belowBar';
    const adversePosition = entry.direction === 'Long' ? 'belowBar' : 'aboveBar';
    return [
      pathSummary.favorable_peak == null ? null : { datetime: new Date(pathSummary.favorable_peak.time).toISOString(), price: pathSummary.favorable_peak.price, label: tradePathMarkerLabel(pathSummary.favorable_peak, isKo), position: favorablePosition, color: '#a78bfa' },
      pathSummary.entry_retest == null ? null : { datetime: new Date(pathSummary.entry_retest.time).toISOString(), price: pathSummary.entry_retest.price, label: tradePathMarkerLabel(pathSummary.entry_retest, isKo), position: 'inBar', color: '#fbbf24' },
      pathSummary.adverse_peak_after_retest == null ? null : { datetime: new Date(pathSummary.adverse_peak_after_retest.time).toISOString(), price: pathSummary.adverse_peak_after_retest.price, label: tradePathMarkerLabel(pathSummary.adverse_peak_after_retest, isKo), position: adversePosition, color: '#f97316' },
    ].filter((event): event is TradePathChartMarker => event != null);
  }, [entry.direction, isKo, pathSummary]);
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
      id: 'rsi',
      label: 'RSI',
      group: isKo ? '모멘텀' : 'Momentum',
      hasData: (snapshot) => snapshot.rsi != null,
    },
    {
      id: 'macd',
      label: 'MACD',
      group: isKo ? '모멘텀' : 'Momentum',
      hasData: (snapshot) => snapshot.macd?.line != null || snapshot.macd?.signal != null,
    },
    {
      id: 'stoch_rsi',
      label: 'Stoch RSI',
      group: isKo ? '모멘텀' : 'Momentum',
      hasData: (snapshot) => snapshot.stoch_rsi?.k != null || snapshot.stoch_rsi?.d != null,
    },
    {
      id: 'slow_stochastic',
      label: 'Slow Stochastic',
      group: isKo ? '모멘텀' : 'Momentum',
      hasData: (snapshot) => Object.values(snapshot.slow_stochastic || {}).some((value) => value.k != null || value.d != null),
    },
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
  ];
  const anchoredVwaps = activeSnapshot?.anchored_vwaps || {};
  const hasAnchoredVwaps = Object.values(anchoredVwaps).some((value) => value?.vwap != null);
  if (hasAnchoredVwaps) {
    knownDefinitions.push({
      id: 'anchored_vwaps',
      label: isKo ? '일·주·월 VWAP 위치' : 'Daily · Weekly · Monthly VWAP',
      group: isKo ? '가격·거래량' : 'Price · Volume',
      hasData: () => true,
    });
  }

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
    if (indicatorId === 'rsi') {
      return [{ label: 'RSI', value: formatSnapshotNumber(snapshot.rsi) }];
    }

    if (indicatorId === 'macd') {
      return [
        { label: isKo ? 'MACD 선' : 'MACD line', value: formatSnapshotNumber(snapshot.macd?.line, 6) },
        { label: isKo ? '신호선' : 'Signal line', value: formatSnapshotNumber(snapshot.macd?.signal, 6) },
        { label: isKo ? '막대' : 'Histogram', value: formatSnapshotNumber(snapshot.macd?.histogram, 6) },
        { label: isKo ? '교차 신호' : 'Cross', value: macdCrossLabel(snapshot.macd?.cross, isKo) },
      ];
    }

    if (indicatorId === 'stoch_rsi') {
      return [
        { label: 'K', value: formatSnapshotNumber(snapshot.stoch_rsi?.k) },
        { label: 'D', value: formatSnapshotNumber(snapshot.stoch_rsi?.d) },
        { label: isKo ? '교차 신호' : 'Cross', value: macdCrossLabel(snapshot.stoch_rsi?.cross, isKo) },
      ];
    }

    if (indicatorId === 'slow_stochastic') {
      return Object.entries(snapshot.slow_stochastic || {}).flatMap(([setting, value]) => [
        { label: `${setting} K`, value: formatSnapshotNumber(value.k) },
        { label: `${setting} D`, value: formatSnapshotNumber(value.d) },
        { label: `${setting} ${isKo ? '교차' : 'Cross'}`, value: macdCrossLabel(value.cross, isKo) },
      ]);
    }

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

    if (indicatorId.startsWith('extra:')) {
      const key = indicatorId.slice('extra:'.length);
      return flattenSnapshotMetrics((snapshot as Record<string, unknown>)[key]);
    }

    return [];
  };

  const isAnchoredVwapView = selectedIndicator?.id === 'anchored_vwaps';
  const intervals = isAnchoredVwapView
    ? ['day', 'week', 'month']
    : REPORT_INTERVALS.filter((interval) => timeframes[interval] != null);
  const metricLabels = selectedIndicator
    ? isAnchoredVwapView
      ? ['VWAP', isKo ? 'VWAP 대비 위치' : 'VWAP position', isKo ? '구간' : 'Zone', isKo ? '계산 표본' : 'Sample']
      : Array.from(
        new Set(
          Object.values(timeframes).flatMap((snapshot) =>
            indicatorMetrics(snapshot, selectedIndicator.id).map((metric) => metric.label),
          ),
        )
      )
    : [];

  const valueFor = (interval: string, metricLabel: string): string => {
    if (!selectedIndicator) return '-';
    if (isAnchoredVwapView) {
      const vwap = anchoredVwaps[interval as 'day' | 'week' | 'month'];
      if (!vwap) return '-';
      if (metricLabel === 'VWAP') return formatSnapshotNumber(vwap.vwap);
      if (metricLabel === (isKo ? 'VWAP 대비 위치' : 'VWAP position')) {
        return vwap.sigma == null ? '-' : `${vwap.sigma >= 0 ? '+' : ''}${vwap.sigma.toFixed(2)}σ`;
      }
      if (metricLabel === (isKo ? '구간' : 'Zone')) return anchoredVwapZoneLabel(vwap.zone, isKo);
      return anchoredVwapSampleLabel(vwap, isKo);
    }
    const snapshot = timeframes[interval];
    if (!snapshot || snapshot.status !== 'complete' || !selectedIndicator.hasData(snapshot)) return '-';
    return indicatorMetrics(snapshot, selectedIndicator.id).find((metric) => metric.label === metricLabel)?.value || '-';
  };

  const holdingDuration = holdingDurationLabel(entryMs, exitMs, isKo);
  const totalCosts = [entry.fee, entry.funding_fee]
    .filter((value): value is number => value != null && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const hasCostData = entry.fee != null || entry.funding_fee != null;
  const tradeDetailMetrics = [
    { label: isKo ? '수량' : 'Size', value: formatSnapshotNumber(entry.size, 6) },
    { label: isKo ? '투입금' : 'Invested', value: entry.invested_amount == null ? '-' : `${formatSnapshotNumber(entry.invested_amount, 2)} USDT` },
    { label: isKo ? '레버리지' : 'Leverage', value: entry.leverage == null ? '-' : `${formatSnapshotNumber(entry.leverage, 2)}x` },
    { label: isKo ? '보유 시간' : 'Held', value: holdingDuration },
    { label: isKo ? '수수료' : 'Fees', value: hasCostData ? `${formatSignedNumber(totalCosts, 4)} ${entry.fee_currency || 'USDT'}` : '-' },
    { label: isKo ? '계획 손익비' : 'Planned RR', value: entry.planned_stop_pct && entry.planned_target_pct ? `1 : ${(entry.planned_target_pct / entry.planned_stop_pct).toFixed(2)}` : '-' },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-2 sm:p-4">
      <div className="flex h-[94vh] w-full max-w-[1600px] flex-col overflow-hidden border border-dark-700 bg-dark-900 shadow-2xl">
        <header className="border-b border-dark-700 bg-dark-950/35 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-white">{entry.symbol || (isKo ? '거래 리포트' : 'Trade Report')}</h2>
                <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${entry.direction === 'Long' ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear'}`}>{entry.direction || '-'}</span>
                {isClosedPosition(entry) && <span className="border border-dark-600 bg-dark-800 px-1.5 py-0.5 text-[10px] text-dark-300">CLOSED</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dark-400">
                <span>{isKo ? '진입' : 'Entry'} <strong className="font-mono text-dark-100">{formatSnapshotNumber(entry.entry_price, 6)}</strong></span>
                <span>{isKo ? '종료' : 'Exit'} <strong className="font-mono text-dark-100">{formatSnapshotNumber(entry.exit_price, 6)}</strong></span>
                <span>{entry.datetime ? new Date(entry.datetime).toLocaleString() : isKo ? '진행중' : 'Open'}</span>
                {entry.realized_pnl != null && <span className={`font-mono font-semibold ${entry.realized_pnl >= 0 ? 'text-bull' : 'text-bear'}`}>{formatSignedNumber(entry.realized_pnl, 4)} USDT</span>}
              </div>
              {(outcomeAssessment || pathSummary) && <div className="mt-2 flex flex-wrap gap-1.5">
                {outcomeAssessment && <span className={`border px-2 py-1 text-[10px] font-medium ${outcomeAssessment.tone === 'negative' ? 'border-bear/30 bg-bear/10 text-bear' : outcomeAssessment.tone === 'warning' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-primary-400/30 bg-primary-500/10 text-primary-200'}`}>{outcomeAssessment.label}</span>}
                {pathSummary && <span className="border border-primary-400/25 bg-primary-500/10 px-2 py-1 text-[10px] text-primary-200">{tradePathSummaryText(pathSummary, isKo)}</span>}
              </div>}
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-dark-400 transition-colors hover:text-white" title={isKo ? '닫기' : 'Close'}><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(340px,1fr)]">
          <main className="min-w-0 space-y-4 p-3 sm:p-5 lg:border-r lg:border-dark-700">
            <section>
              <div className="mb-3 flex flex-col gap-3 border-y border-dark-700 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid grid-cols-3 border border-dark-700 bg-dark-900/40 p-1 sm:grid-cols-9">
                  {REPORT_INTERVALS.map((interval) => <button key={interval} type="button" onClick={() => setReportInterval(interval)} className={`min-w-0 px-2.5 py-1.5 text-xs font-semibold uppercase transition-colors sm:min-w-14 ${reportInterval === interval ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'}`}>{interval}</button>)}
                </div>
                <div className="text-[11px] text-dark-500">{reportQuery.data?.source || 'Binance USDT-M Futures'} · {candleLimit}{isKo ? '봉' : ' bars'}{reportQuery.data?.profile_as_of ? ` · VPVR/VWAP ${new Date(reportQuery.data.profile_as_of).toLocaleString()}` : ''}</div>
              </div>

              {reportQuery.isLoading ? (
                <div className="flex h-[520px] items-center justify-center gap-2 border border-dark-700 bg-[#0b1220] text-sm text-dark-400"><Loader2 className="h-4 w-4 animate-spin" />{isKo ? '거래 리포트 불러오는 중' : 'Loading trade report'}</div>
              ) : reportQuery.isError ? (
                <div className="flex h-48 items-center justify-center border border-dark-700 bg-[#0b1220] px-5 text-sm text-bear"><AlertCircle className="mr-2 h-4 w-4" />{isKo ? '거래 리포트 데이터를 불러오지 못했습니다.' : 'Could not load trade report data.'}</div>
              ) : reportQuery.data?.candles.length ? (
                <div className="space-y-4">
                  {!Number.isFinite(referenceMs) && <div className="border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{isKo ? '진입시간 확인 불가: 캔들은 표시하지만 진입 시점 VPVR/VWAP는 계산하지 않습니다.' : 'Entry time unavailable: candles are shown without entry-time VPVR/VWAP.'}</div>}
                  <PositionReviewChart data={reportQuery.data.candles} direction={entry.direction} entryTime={resolvedEntryTime.datetime} entryTimeConfidence={resolvedEntryTime.confidence} exitTime={entry.datetime as string} entryPrice={entry.entry_price} exitPrice={entry.exit_price} entryEvents={splitEntryMarkers} takeProfitEvents={tradeMarkerQuery.data?.take_profits || exchangeExitMarkers} pathEvents={pathEvents} />
                  {tradeMarkerQuery.data?.warnings.map((warning) => <div key={warning} className="border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{warning}</div>)}
                  <TradeIndicatorCharts series={reportQuery.data.series} latest={reportQuery.data.latest} entryTime={resolvedEntryTime.datetime} exitTime={entry.datetime || null} referenceLabel={reviewMoment === 'entry' ? 'ENTRY' : 'EXIT'} />
                </div>
              ) : <div className="flex h-48 items-center justify-center border border-dark-700 bg-[#0b1220] text-sm text-dark-500">{isKo ? '표시할 거래 리포트 데이터가 없습니다.' : 'No trade report data is available.'}</div>}
            </section>
          </main>

          <aside className="min-w-0 space-y-4 bg-dark-950/25 p-3 sm:p-5">
            <CompactSection title={isKo ? '거래 세부 정보' : 'Trade Details'}>
              <div className="grid grid-cols-2 gap-2">{tradeDetailMetrics.map((metric) => <CompactMetric key={metric.label} {...metric} />)}</div>
            </CompactSection>

            <CompactSection title={isKo ? '진입 후 가격 흐름' : 'Price Movement While Held'}>
              {resolvedExcursion ? <>
                <div className="grid grid-cols-2 gap-2"><CompactMetric label={isKo ? '보유 중 최대 수익' : 'Best move while held'} value={`+${formatSnapshotNumber(resolvedExcursion.mfe_pct)}%`} tone="text-bull" /><CompactMetric label={isKo ? '보유 중 최대 손실' : 'Worst move while held'} value={`-${formatSnapshotNumber(resolvedExcursion.mae_pct)}%`} tone="text-bear" /><CompactMetric label={isKo ? '실제 종료' : 'Actual exit'} value={`${formatSignedNumber(resolvedExcursion.realized_move_pct, 2)}%`} tone={resolvedExcursion.realized_move_pct >= 0 ? 'text-bull' : 'text-bear'} /><CompactMetric label={isKo ? '수익 구간 확보' : 'Profit captured'} value={resolvedExcursion.capture_pct == null ? '-' : `${formatSnapshotNumber(resolvedExcursion.capture_pct)}%`} tone="text-primary-200" /></div>
                {outcomeAssessment && <p className="mt-3 text-xs leading-5 text-dark-300">{outcomeAssessment.explanation}</p>}
                <p className="mt-2 text-[10px] text-dark-500">{resolvedExcursion.interval === '1m' ? (isKo ? '완성된 1분봉 가격 움직임 기준 · 수수료·펀딩 제외' : 'Completed 1m price movement · fees and funding excluded') : (isKo ? '완성된 15분봉 가격 움직임 기준 · 수수료·펀딩 제외' : 'Completed 15m price movement · fees and funding excluded')}</p>
              </> : <div className="text-xs text-dark-500">{excursionLoading ? (isKo ? '보유 중 가격 움직임을 계산하고 있습니다.' : 'Calculating held-price movement.') : (isKo ? '이 거래의 가격 흐름 데이터가 없습니다.' : 'This trade has no price-movement data.')}</div>}
            </CompactSection>

            {reportQuery.data && <TradeReferenceSummary vpvr={reportQuery.data.vpvr} vwaps={reportQuery.data.vwaps} isKo={isKo} />}

            <CompactSection title={isKo ? '진입 · 종료 시점 지표' : 'Entry · Exit Indicator Snapshot'}>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setReviewMoment('entry')} className={`border px-3 py-2.5 text-left transition-colors ${reviewMoment === 'entry' ? 'border-primary-500/60 bg-primary-500/15 text-white' : 'border-dark-700 bg-dark-900/35 text-dark-400 hover:text-white'}`}><div className="text-xs font-semibold">{isKo ? '진입 시점' : 'Entry'}</div><div className="mt-1 text-[10px] text-dark-500">{entrySnapshot && matchedEntry?.datetime ? `${new Date(matchedEntry.datetime).toLocaleString()}${resolvedEntryTime.confidence === 'estimated' ? (isKo ? ' · 추정' : ' · Estimated') : ''}` : (isKo ? '스냅샷 없음' : 'No snapshot')}</div></button>
                <button type="button" onClick={() => setReviewMoment('exit')} disabled={!entry.datetime} className={`border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${reviewMoment === 'exit' ? 'border-primary-500/60 bg-primary-500/15 text-white' : 'border-dark-700 bg-dark-900/35 text-dark-400 hover:text-white'}`}><div className="text-xs font-semibold">{isKo ? '종료 시점' : 'Exit'}</div><div className="mt-1 text-[10px] text-dark-500">{entry.datetime ? new Date(entry.datetime).toLocaleString() : (isKo ? '종료 시점 없음' : 'No exit time')}</div></button>
              </div>
              {reviewMoment === 'entry' && reasons.length > 0 && <div className="mt-3"><div className="mb-1.5 text-[10px] text-dark-500">{isKo ? '기록된 진입 근거' : 'Saved entry rationale'}</div><div className="flex flex-wrap gap-1.5">{reasons.map((reason, index) => <span key={`${reason}-${index}`} className="border border-dark-600 bg-dark-800 px-2 py-1 text-[10px] text-dark-200">{index + 1}. {reason}</span>)}</div></div>}
              {activeSnapshot && intervals.length > 0 && availableIndicators.length > 0 ? <>
                <div className="mt-3 flex flex-wrap gap-1.5">{availableIndicators.map((definition) => { const isSelected = selectedIndicator?.id === definition.id; return <button key={definition.id} type="button" onClick={() => setSelectedIndicatorId(definition.id)} className={`border px-2 py-1 text-[10px] font-medium transition-colors ${isSelected ? 'border-primary-500/60 bg-primary-500/15 text-primary-200' : 'border-dark-700 bg-dark-900/35 text-dark-300 hover:border-dark-600 hover:text-white'}`}>{definition.label}</button>; })}</div>
                <div className="mt-3 overflow-x-auto border border-dark-700"><table className="w-full min-w-[480px] text-xs"><thead className="bg-dark-900/70"><tr className="border-b border-dark-700"><th className="w-32 px-2 py-2 text-left text-[10px] font-semibold text-dark-500">{selectedIndicator?.label || (isKo ? '지표' : 'Indicator')}</th>{intervals.map((interval) => <th key={interval} className="px-2 py-2 text-center text-[10px] font-semibold text-white">{isAnchoredVwapView ? ({ day: isKo ? '일간' : 'Daily', week: isKo ? '주간' : 'Weekly', month: isKo ? '월간' : 'Monthly' }[interval] || interval) : interval.toUpperCase()}</th>)}</tr></thead><tbody>{metricLabels.map((metricLabel) => <tr key={metricLabel} className="border-b border-dark-800 last:border-b-0"><td className="px-2 py-2 text-[10px] text-dark-400">{metricLabel}</td>{intervals.map((interval) => <td key={`${metricLabel}-${interval}`} className="px-2 py-2 text-center font-mono text-[11px] text-dark-100">{valueFor(interval, metricLabel)}</td>)}</tr>)}</tbody></table></div>
              </> : <div className="mt-3 text-xs text-dark-500">{isKo ? '이 거래의 지표 스냅샷이 없습니다.' : 'This trade has no indicator snapshot.'}</div>}
            </CompactSection>

            {isClosedPosition(entry) && <CompactSection title={isKo ? '보유 후 복기' : 'Post-Exit Review'}>
              {pathQuery.isLoading ? <div className="flex items-center gap-2 text-xs text-dark-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{isKo ? '실제 보유 구간의 가격 흐름을 계산 중' : 'Calculating the price path during the position'}</div> : pathSummary ? <><div className="text-xs font-semibold leading-5 text-dark-200">{tradePathSummaryText(pathSummary, isKo)}</div><div className="mt-1 text-[10px] text-dark-500">{pathSummary.interval} {isKo ? '봉의 실제 보유 구간만 사용 · 봉 고가/저가 기준 · 수수료·펀딩 제외' : 'bars fully inside holding period · high/low basis · fees and funding excluded'}{pathQuery.data?.source ? ` · ${pathQuery.data.source}` : ''}</div></> : <div className="text-xs text-dark-500">{pathConfig == null ? (isKo ? '보유 시간이 길거나 진입·청산 시간이 없어 가격 흐름을 계산하지 못했습니다.' : 'The holding period is too long or entry/exit timing is unavailable.') : pathQuery.isError ? (isKo ? '가격 흐름 데이터를 불러오지 못했습니다.' : 'Could not load the price path data.') : (isKo ? '이 거래의 보유 후 복기 데이터가 없습니다.' : 'This trade has no post-exit review data.')}</div>}
              <div className="mt-3"><TradeExitReview qualityItem={qualityItem} isKo={isKo} /></div>
            </CompactSection>}

            {isClosedPosition(entry) && <TradeBehaviorEditor entry={entry} isKo={isKo} onUpdated={onBehaviorUpdated} />}
            {entry.notes && <CompactSection title={isKo ? '메모' : 'Memo'}><p className="whitespace-pre-wrap text-xs leading-5 text-dark-300">{entry.notes}</p></CompactSection>}
          </aside>
        </div>
      </div>
    </div>
  );
}
