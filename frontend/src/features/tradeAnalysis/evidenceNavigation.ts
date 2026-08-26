import { create } from 'zustand';

import type { JournalPeriod } from '../journal/journalPeriod';
import type { ExitHoldInterval } from '../../types';

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
