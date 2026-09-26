import { api, type ApiResponse, unwrapApiResponse } from './config';
import type { JournalEntry, PlanRevision, TradingPlan } from '../types';

export interface PlanningContext {
  journal_entry_id: number;
  journal_notes: {
    source: 'journal_entries'; journal_entry_id: number;
    planned_stop_pct: unknown; planned_target_pct: unknown; planned_entry_reason: unknown;
    plan_recorded_at: string | null; has_notes: boolean; timing_verified: false;
  };
  actual_execution: Pick<JournalEntry, 'direction' | 'entry_datetime' | 'datetime' | 'symbol' | 'exchange' | 'source' | 'external_id'> & { entry_price?: number | null };
  link_state: 'LINKED' | 'NO_LINKED_PLAN' | 'CANDIDATES' | 'AMBIGUOUS';
  linked_plan: {
    plan: TradingPlan; entry_time_revision: PlanRevision | null; analysis_revision: PlanRevision | null;
    analysis_basis: 'VERIFIED_PRETRADE' | 'RETROSPECTIVE' | 'NOT_ELIGIBLE';
  } | null;
  candidate_plans: TradingPlan[];
  candidates_truncated: boolean;
  issues: string[];
}

export async function getPlanningContext(id: number, signal?: AbortSignal): Promise<PlanningContext> {
  const response = await api.get<ApiResponse<PlanningContext>>(`/journal/${id}/planning-context`, { signal });
  const context = unwrapApiResponse(response, 'Unable to load planning context');
  if (context.journal_entry_id !== id) throw new Error('Planning context belongs to another trade');
  return context;
}
