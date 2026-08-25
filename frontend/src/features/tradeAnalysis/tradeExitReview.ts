import type { TradeQualityItem } from '../../types';

type ExitResult = {
  available?: boolean;
  reason?: string;
  return_pct?: number | null;
  r_multiple?: number | null;
  exit_time?: number | null;
};

type ExitQuality = {
  actual_return_pct?: number | null;
  hold_results?: Record<string, ExitResult>;
  virtual_exits?: Record<string, ExitResult>;
  post_exit_mfe_pct?: number | null;
  post_exit_adverse_pct?: number | null;
  additional_profit_potential_pct?: number | null;
  capture_ratio_pct?: number | null;
  profit_give_up_pct?: number | null;
};

export type ExitReviewRow = {
  id: string;
  label: string;
  kind: 'actual' | 'hold' | 'signal';
  available: boolean;
  returnPct: number | null;
  rMultiple: number | null;
  reason?: string;
};

export type ExitReview = {
  actual: ExitReviewRow | null;
  holds: ExitReviewRow[];
  signals: ExitReviewRow[];
  bestAlternative: ExitReviewRow | null;
  postExitMfePct: number | null;
  postExitAdversePct: number | null;
  captureRatioPct: number | null;
  profitGiveUpPct: number | null;
};

const HOLD_IDS = Array.from({ length: 10 }, (_, index) => String(index + 1));

function holdLabel(id: string): string {
  return id === 'actual' ? '실제 청산' : `청산 후 +${id}봉`;
}

const SIGNAL_LABELS: Record<string, string> = {
  rsi_overheat: 'RSI 과열 도달',
  stoch_rsi_overheat: 'Stoch RSI 과열 도달',
  slow_5_overheat: 'Slow 5-3-3 과열 도달',
  slow_10_overheat: 'Slow 10-6-6 과열 도달',
  slow_20_overheat: 'Slow 20-12-12 과열 도달',
  slow_5_cross: 'Slow 5-3-3 과열 후 반대 크로스',
  slow_10_cross: 'Slow 10-6-6 과열 후 반대 크로스',
  slow_20_cross: 'Slow 20-12-12 과열 후 반대 크로스',
  macd_weakening: 'MACD 모멘텀 약화',
  atr_trailing_stop: 'ATR 트레일링 스톱',
};

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function exitQuality(item: TradeQualityItem | null | undefined): ExitQuality | null {
  if (!item?.exit_quality || typeof item.exit_quality !== 'object') return null;
  return item.exit_quality as ExitQuality;
}

function row(id: string, label: string, kind: ExitReviewRow['kind'], result?: ExitResult): ExitReviewRow {
  return {
    id,
    label,
    kind,
    available: result?.available === true,
    returnPct: finite(result?.return_pct),
    rMultiple: finite(result?.r_multiple),
    reason: result?.reason,
  };
}

export function buildExitReview(item: TradeQualityItem | null | undefined): ExitReview | null {
  const quality = exitQuality(item);
  if (!quality) return null;
  const holds = HOLD_IDS.map((id) => row(id, holdLabel(id), 'hold', quality.hold_results?.[id]));
  const actual = row('actual', holdLabel('actual'), 'actual', quality.hold_results?.actual);
  const signals = Object.entries(SIGNAL_LABELS)
    .map(([id, label]) => row(id, label, 'signal', quality.virtual_exits?.[id]));
  const bestAlternative = [...holds, ...signals]
    .filter((candidate) => candidate.available && candidate.returnPct != null)
    .sort((left, right) => (right.returnPct as number) - (left.returnPct as number))[0] || null;

  return {
    actual: actual.available ? actual : null,
    holds,
    signals,
    bestAlternative,
    postExitMfePct: finite(quality.post_exit_mfe_pct ?? quality.additional_profit_potential_pct),
    postExitAdversePct: finite(quality.post_exit_adverse_pct),
    captureRatioPct: finite(quality.capture_ratio_pct),
    profitGiveUpPct: finite(quality.profit_give_up_pct),
  };
}

export function exitReviewConclusion(review: ExitReview | null): string {
  if (!review?.actual) return '청산 복기 데이터 없음';
  if (!review.bestAlternative || review.bestAlternative.returnPct == null || review.actual.returnPct == null) {
    return '비교 가능한 대안 없음';
  }
  const difference = review.bestAlternative.returnPct - review.actual.returnPct;
  if (difference <= 0) return '실제 청산이 가장 나음';
  return `${review.bestAlternative.label}이 ${difference.toFixed(2)}%p 더 높음`;
}
