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
  maxHoldHours: string;
  setup: string;
  entryNote: string;
  exitNote: string;
  memo: string;
};

function finiteInput(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function revisionPayload(draft: PlanDraft, retrospective = false): PlanRevisionInput | null {
  const stopLoss = finiteInput(draft.stopLoss);
  const takeProfit = finiteInput(draft.takeProfit);
  const entryPrice = !retrospective && draft.entryMode === 'exact' ? finiteInput(draft.entryPrice) : null;
  const entryMin = !retrospective && draft.entryMode === 'range' ? finiteInput(draft.entryMin) : null;
  const entryMax = !retrospective && draft.entryMode === 'range' ? finiteInput(draft.entryMax) : null;
  if (stopLoss == null || takeProfit == null) return null;
  if (!retrospective && draft.entryMode === 'exact' && entryPrice == null) return null;
  if (!retrospective && draft.entryMode === 'range' && (entryMin == null || entryMax == null || entryMin > entryMax)) return null;
  return {
    entry_price: entryPrice,
    entry_min: entryMin,
    entry_max: entryMax,
    stop_loss: stopLoss,
    take_profit: takeProfit,
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
