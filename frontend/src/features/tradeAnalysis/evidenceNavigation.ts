import { create } from 'zustand';

import type { JournalPeriod } from '../journal/journalPeriod';
import type { ExitHoldInterval, JournalExitHoldItem } from '../../types';

export type EvidenceHoldResult = {
  actualReturnPct: number | null;
  holdReturnPct: number | null;
  differencePct: number | null;
  exitTime: string | null;
};

export type EvidenceRequest = {
  title: string;
  filterLabel: string;
  tradeIds: number[];
  period: JournalPeriod;
  direction: 'All' | 'Long' | 'Short';
  minimumAbsNetReturnPct: number;
  exitHold?: {
    interval: ExitHoldInterval;
    holdId: string;
    resultsByJournalId: Record<number, EvidenceHoldResult>;
  };
};

export function matchesEvidenceDirection(
  scopeDirection: EvidenceRequest['direction'],
  tradeDirection: string | null | undefined,
): boolean {
  return scopeDirection === 'All' || tradeDirection === scopeDirection;
}

export function evidenceMinimumReturnLabel(value: number, isKo: boolean): string {
  if (value <= 0) return isKo ? '순수익률 전체' : 'all net returns';
  return `|${isKo ? '순수익률' : 'net return'}| > ${value}%`;
}

export function selectExitHoldEvidence(
  items: JournalExitHoldItem[],
  direction: 'Long' | 'Short',
  holdId: string,
  lossOnly = false,
): { tradeIds: number[]; resultsByJournalId: Record<number, EvidenceHoldResult> } {
  const resultsByJournalId: Record<number, EvidenceHoldResult> = {};
  const tradeIds: number[] = [];
  items.forEach((item) => {
    if (item.direction !== direction) return;
    const actual = item.hold_results.actual;
    const selected = item.hold_results[holdId];
    if (!actual?.available || !selected?.available) return;
    const actualReturnPct = actual.return_pct != null && Number.isFinite(actual.return_pct) ? actual.return_pct : null;
    const holdReturnPct = selected.return_pct != null && Number.isFinite(selected.return_pct) ? selected.return_pct : null;
    if (actualReturnPct == null || holdReturnPct == null) return;
    if (lossOnly && holdReturnPct >= 0) return;
    tradeIds.push(item.journal_id);
    resultsByJournalId[item.journal_id] = {
      actualReturnPct,
      holdReturnPct,
      differencePct: holdReturnPct - actualReturnPct,
      exitTime: item.exit_datetime || null,
    };
  });
  return { tradeIds: [...new Set(tradeIds)], resultsByJournalId };
}

type EvidenceNavigationState = {
  request: EvidenceRequest | null;
  setRequest: (request: EvidenceRequest) => void;
  clearRequest: () => void;
};

// Evidence is intentionally in-memory: it is navigation state, not saved user data.
export const useEvidenceNavigation = create<EvidenceNavigationState>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
  clearRequest: () => set({ request: null }),
}));
