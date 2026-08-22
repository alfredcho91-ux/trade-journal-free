import type { OHLCV } from '../../types';

export type TradePathInterval = '5m' | '15m';
export type TradePathEventKind = 'favorable_peak' | 'entry_retest' | 'adverse_peak' | 'exit';

export interface TradePathEvent {
  kind: TradePathEventKind;
  time: number;
  price: number;
  raw_move_pct: number;
  elapsed_ms: number;
}
export interface TradePathSummary {
  interval: TradePathInterval;
  candle_count: number;
  favorable_peak: TradePathEvent | null;
  entry_retest: TradePathEvent | null;
  adverse_peak_after_retest: TradePathEvent | null;
  exit: TradePathEvent;
}

export interface TradePathSummaryInput {
  candles: OHLCV[];
  direction: 'Long' | 'Short';
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  interval: TradePathInterval;
}

const INTERVAL_MS: Record<TradePathInterval, number> = {
  '5m': 300_000,
  '15m': 900_000,
};

function finite(value: number | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function timestamp(value: string): number | null {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function rawMovePct(price: number, entryPrice: number): number {
  return ((price - entryPrice) / entryPrice) * 100;
}

function favorableMovePct(price: number, entryPrice: number, direction: 'Long' | 'Short'): number {
  const raw = rawMovePct(price, entryPrice);
  return direction === 'Long' ? raw : -raw;
}

function adverseMovePct(price: number, entryPrice: number, direction: 'Long' | 'Short'): number {
  return -favorableMovePct(price, entryPrice, direction);
}

function event(
  kind: TradePathEventKind,
  time: number,
  price: number,
  entryTime: number,
  entryPrice: number,
): TradePathEvent {
  return {
    kind,
    time,
    price,
    raw_move_pct: rawMovePct(price, entryPrice),
    elapsed_ms: Math.max(0, time - entryTime),
  };
}

/**
 * Summarize only candles fully contained between entry and exit. Boundary prices
 * are inserted separately so no post-exit portion of a candle is used.
 */
export function buildTradePathSummary(input: TradePathSummaryInput): TradePathSummary | null {
  const entryTime = timestamp(input.entry_time);
  const exitTime = timestamp(input.exit_time);
  if (
    entryTime == null || exitTime == null || exitTime < entryTime
    || !finite(input.entry_price) || input.entry_price <= 0 || !finite(input.exit_price)
  ) {
    return null;
  }

  const intervalMs = INTERVAL_MS[input.interval];
  const candles = input.candles
    .filter((candle) => finite(candle.open_time) && finite(candle.high) && finite(candle.low))
    .filter((candle) => candle.open_time >= entryTime && candle.open_time + intervalMs - 1 <= exitTime)
    .sort((left, right) => left.open_time - right.open_time);

  const exitEvent = event('exit', exitTime, input.exit_price, entryTime, input.entry_price);
  const favorableCandidates: Array<{ time: number; price: number }> = candles.map((candle) => ({
    time: candle.open_time,
    price: input.direction === 'Long' ? candle.high : candle.low,
  }));
  favorableCandidates.push({ time: exitTime, price: input.exit_price });

  let favorableCandidate = favorableCandidates[0] || null;
  for (const candidate of favorableCandidates) {
    if (
      favorableCandidate == null
      || favorableMovePct(candidate.price, input.entry_price, input.direction)
        > favorableMovePct(favorableCandidate.price, input.entry_price, input.direction)
    ) {
      favorableCandidate = candidate;
    }
  }
  const favorablePeak = favorableCandidate != null
    && favorableMovePct(favorableCandidate.price, input.entry_price, input.direction) > 0
    ? event('favorable_peak', favorableCandidate.time, favorableCandidate.price, entryTime, input.entry_price)
    : null;

  const retestCandle = favorablePeak == null
    ? null
    : candles.find((candle) => candle.open_time > favorablePeak.time
      && candle.low <= input.entry_price
      && candle.high >= input.entry_price) || null;
  const entryRetest = retestCandle == null
    ? null
    : event('entry_retest', retestCandle.open_time, input.entry_price, entryTime, input.entry_price);

  const adverseCandidates = entryRetest == null
    ? []
    : candles
      .filter((candle) => candle.open_time > entryRetest.time)
      .map((candle) => ({
        time: candle.open_time,
        price: input.direction === 'Long' ? candle.low : candle.high,
      }));
  if (entryRetest != null && exitTime > entryRetest.time) {
    adverseCandidates.push({ time: exitTime, price: input.exit_price });
  }

  let adverseCandidate = adverseCandidates[0] || null;
  for (const candidate of adverseCandidates) {
    if (
      adverseCandidate == null
      || adverseMovePct(candidate.price, input.entry_price, input.direction)
        > adverseMovePct(adverseCandidate.price, input.entry_price, input.direction)
    ) {
      adverseCandidate = candidate;
    }
  }
  const adversePeak = adverseCandidate != null
    && adverseMovePct(adverseCandidate.price, input.entry_price, input.direction) > 0
    ? event('adverse_peak', adverseCandidate.time, adverseCandidate.price, entryTime, input.entry_price)
    : null;

  return {
    interval: input.interval,
    candle_count: candles.length,
    favorable_peak: favorablePeak,
    entry_retest: entryRetest,
    adverse_peak_after_retest: adversePeak,
    exit: exitEvent,
  };
}

function elapsedLabel(milliseconds: number, isKo: boolean): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (isKo) {
    if (hours === 0) return `${minutes}분`;
    return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
  }
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function moveLabel(event: TradePathEvent, isKo: boolean): string {
  const magnitude = Math.abs(event.raw_move_pct).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (isKo) return `${event.raw_move_pct >= 0 ? '+' : '-'}${magnitude}% ${event.raw_move_pct >= 0 ? '상승' : '하락'}`;
  return `${event.raw_move_pct >= 0 ? '+' : '-'}${magnitude}% ${event.raw_move_pct >= 0 ? 'up' : 'down'}`;
}

export function tradePathSummaryText(summary: TradePathSummary, isKo: boolean): string {
  const parts: string[] = [];
  if (summary.favorable_peak) {
    parts.push(isKo
      ? `진입 약 ${elapsedLabel(summary.favorable_peak.elapsed_ms, true)} 후 최대 ${moveLabel(summary.favorable_peak, true)}`
      : `About ${elapsedLabel(summary.favorable_peak.elapsed_ms, false)} after entry, maximum ${moveLabel(summary.favorable_peak, false)}`);
  } else {
    parts.push(isKo ? '진입 후 유리한 가격 움직임 확인 불가' : 'No favorable price move after entry');
  }

  if (summary.entry_retest) {
    parts.push(isKo
      ? `약 ${elapsedLabel(summary.entry_retest.elapsed_ms, true)} 후 진입가 재도달`
      : `entry price retested after about ${elapsedLabel(summary.entry_retest.elapsed_ms, false)}`);
  } else if (summary.favorable_peak) {
    parts.push(isKo ? '진입가 재도달 없음' : 'no entry-price retest');
  }

  if (summary.adverse_peak_after_retest) {
    parts.push(isKo
      ? `이후 최대 ${moveLabel(summary.adverse_peak_after_retest, true)}`
      : `then maximum ${moveLabel(summary.adverse_peak_after_retest, false)}`);
  }
  parts.push(isKo ? `실제 청산 ${moveLabel(summary.exit, true)}` : `actual exit ${moveLabel(summary.exit, false)}`);
  return parts.join(' → ');
}

export function tradePathMarkerLabel(event: TradePathEvent, isKo: boolean): string {
  if (event.kind === 'favorable_peak') return isKo ? '최대 유리' : 'MAX FAVORABLE';
  if (event.kind === 'entry_retest') return isKo ? '진입가 재도달' : 'ENTRY RETEST';
  if (event.kind === 'adverse_peak') return isKo ? '최대 불리' : 'MAX ADVERSE';
  return 'EXIT';
}
