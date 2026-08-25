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
  direction: 'Long' | 'Short';
  exitHold?: {
    interval: ExitHoldInterval;
    holdId: string;
    resultsByJournalId: Record<number, EvidenceHoldResult>;
  };
};

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
