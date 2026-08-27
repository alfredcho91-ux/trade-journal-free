import type { JournalEntry, PlanRevision, PlanRevisionInput, PlanSide, PlanSource, TradingPlan } from '../../types';

export type PlanDraft = {
  exchange: 'deepcoin' | 'binance';
  symbol: string;
  side: PlanSide;
  entryMode: 'exact' | 'range';
  entryPrice: string;
  entryMin: string;
  entryMax: string;
  stopLoss: string;
  takeProfit: string;
  takeProfit2: string;
  maxHoldHours: string;
  setup: string;
  entryNote: string;
  exitNote: string;
  memo: string;
};

export type TargetRiskRewardInput = {
  direction: PlanSide;
  entry: number | null | undefined;
  stopLoss: number | null | undefined;
  tp1: number | null | undefined;
  tp2?: number | null;
};

export type TargetRiskRewardResult = {
  valid: boolean;
  mode: 'INCOMPLETE' | 'INVALID' | 'TP1_ONLY' | 'SPLIT_TP_50_50';
  riskDistance: number | null;
  riskPct: number | null;
  tp1R: number | null;
  tp2R: number | null;
  splitTargetR: number | null;
  validationError: 'ENTRY_REQUIRED' | 'STOP_REQUIRED' | 'TP1_REQUIRED' | 'TP2_INVALID' | 'RISK_INVALID' | 'LONG_STOP' | 'SHORT_STOP' | 'LONG_TP1' | 'SHORT_TP1' | 'LONG_TP2_ORDER' | 'SHORT_TP2_ORDER' | null;
};

function finiteInput(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function incompleteResult(validationError: TargetRiskRewardResult['validationError']): TargetRiskRewardResult {
  return { valid: false, mode: 'INCOMPLETE', riskDistance: null, riskPct: null, tp1R: null, tp2R: null, splitTargetR: null, validationError };
}

function invalidResult(validationError: TargetRiskRewardResult['validationError']): TargetRiskRewardResult {
  return { valid: false, mode: 'INVALID', riskDistance: null, riskPct: null, tp1R: null, tp2R: null, splitTargetR: null, validationError };
}

export function calculateTargetRiskReward(input: TargetRiskRewardInput): TargetRiskRewardResult {
  const { direction, entry, stopLoss, tp1, tp2 } = input;
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return incompleteResult('ENTRY_REQUIRED');
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) return incompleteResult('STOP_REQUIRED');
  if (tp1 == null || !Number.isFinite(tp1) || tp1 <= 0) return incompleteResult('TP1_REQUIRED');
  if (tp2 != null && (!Number.isFinite(tp2) || tp2 <= 0)) return incompleteResult('TP2_INVALID');

  if (direction === 'Long') {
    if (stopLoss >= entry) return invalidResult('LONG_STOP');
    if (tp1 <= entry) return invalidResult('LONG_TP1');
    if (tp2 != null && tp2 <= tp1) return invalidResult('LONG_TP2_ORDER');
  } else {
    if (stopLoss <= entry) return invalidResult('SHORT_STOP');
    if (tp1 >= entry) return invalidResult('SHORT_TP1');
    if (tp2 != null && tp2 >= tp1) return invalidResult('SHORT_TP2_ORDER');
  }

  const riskDistance = Math.abs(entry - stopLoss);
  if (riskDistance <= 0) return invalidResult('RISK_INVALID');
  const tp1Reward = direction === 'Long' ? tp1 - entry : entry - tp1;
  const tp2Reward = tp2 == null ? null : direction === 'Long' ? tp2 - entry : entry - tp2;
  const tp1R = tp1Reward / riskDistance;
  const tp2R = tp2Reward == null ? null : tp2Reward / riskDistance;
  const mode = tp2R == null ? 'TP1_ONLY' : 'SPLIT_TP_50_50';
  return {
    valid: true,
    mode,
    riskDistance,
    riskPct: (riskDistance / entry) * 100,
    tp1R,
    tp2R,
    splitTargetR: tp2R == null ? null : (tp1R * 0.5) + (tp2R * 0.5),
    validationError: null,
  };
}

export function calculateTargetRiskRewardFromDraft(draft: PlanDraft, actualEntry?: number | null, direction = draft.side): TargetRiskRewardResult {
  const exactEntry = draft.entryMode === 'exact' ? finiteInput(draft.entryPrice) : null;
  const rangeMin = finiteInput(draft.entryMin);
  const rangeMax = finiteInput(draft.entryMax);
  const entry = actualEntry ?? (exactEntry ?? (rangeMin != null && rangeMax != null ? (rangeMin + rangeMax) / 2 : null));
  const tp2 = draft.takeProfit2.trim() ? finiteInput(draft.takeProfit2) ?? Number.NaN : null;
  return calculateTargetRiskReward({
    direction,
    entry,
    stopLoss: finiteInput(draft.stopLoss),
    tp1: finiteInput(draft.takeProfit),
    tp2,
  });
}

export function revisionPayload(draft: PlanDraft, retrospective = false): PlanRevisionInput | null {
  const stopLoss = finiteInput(draft.stopLoss);
  const takeProfit = finiteInput(draft.takeProfit);
  const takeProfit2 = finiteInput(draft.takeProfit2);
  const entryPrice = !retrospective && draft.entryMode === 'exact' ? finiteInput(draft.entryPrice) : null;
  const entryMin = !retrospective && draft.entryMode === 'range' ? finiteInput(draft.entryMin) : null;
  const entryMax = !retrospective && draft.entryMode === 'range' ? finiteInput(draft.entryMax) : null;
  if (stopLoss == null || takeProfit == null) return null;
  if (draft.takeProfit2.trim() && takeProfit2 == null) return null;
  if (!retrospective && draft.entryMode === 'exact' && entryPrice == null) return null;
  if (!retrospective && draft.entryMode === 'range' && (entryMin == null || entryMax == null || entryMin > entryMax)) return null;
  return {
    entry_price: entryPrice,
    entry_min: entryMin,
    entry_max: entryMax,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    take_profit_2: takeProfit2,
    max_hold_hours: finiteInput(draft.maxHoldHours),
    setup: draft.setup.trim() || null,
    entry_note: draft.entryNote.trim() || null,
    exit_note: draft.exitNote.trim() || null,
    memo: draft.memo.trim() || null,
  };
}

export function shouldLoadPlanLabAnalysis(requested: boolean, validPeriod: boolean): boolean {
  return requested && validPeriod;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

export function planEntryLabel(revision: PlanRevision | undefined): string {
  if (!revision) return '-';
  if (revision.entry_price != null) return formatPrice(revision.entry_price);
  if (revision.entry_min != null && revision.entry_max != null) {
    return `${formatPrice(revision.entry_min)} ~ ${formatPrice(revision.entry_max)}`;
  }
  return '-';
}

export function planStatusForEntry(entryId: number | null | undefined, plans: TradingPlan[]): 'NO_PLAN' | PlanSource {
  if (entryId == null) return 'NO_PLAN';
  return plans.find((plan) => plan.link?.journal_entry_id === entryId)?.source || 'NO_PLAN';
}

export function nextMissingTrade(current: JournalEntry | undefined, missing: JournalEntry[]): JournalEntry | undefined {
  const remaining = missing.filter((entry) => entry.id != null && entry.id !== current?.id);
  if (!remaining.length) return undefined;
  const currentTime = new Date(current?.entry_datetime || 0).getTime();
  return remaining.find((entry) => new Date(entry.entry_datetime || 0).getTime() < currentTime) || remaining[0];
}
