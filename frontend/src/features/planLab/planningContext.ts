import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { linkPlanToTrade } from '../../api/journal';
import { getPlanningContext, type PlanningContext } from '../../api/planningContext';
import { journalQueryKeys } from '../journal/journalQueryKeys';
import type { PlanDraft } from './pastTradePlan';

export function usePlanningContext(id: number | null) {
  return useQuery({ queryKey: journalQueryKeys.planningContext(id),
    queryFn: ({ signal }) => getPlanningContext(id!, signal), enabled: id != null, retry: false });
}

export function invalidatePlanningContexts(client: QueryClient, id?: number | null) {
  // Cancel in-flight reads first: an older read must not become the post-save authority.
  const key = id == null ? journalQueryKeys.planningContexts : journalQueryKeys.planningContext(id);
  return client.cancelQueries({ queryKey: key }).then(() => client.invalidateQueries({ queryKey: key }));
}

export function useLinkPlanningContext() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ planId, journalId }: { planId: number; journalId: number }) => linkPlanToTrade(planId, journalId),
    onSuccess: async (_, { journalId }) => { await Promise.all([
      invalidatePlanningContexts(client), // Linking removes this candidate from other trade contexts too.
      client.invalidateQueries({ queryKey: journalQueryKeys.plans }),
      client.invalidateQueries({ queryKey: ['plan-lab'] }),
      client.invalidateQueries({ queryKey: journalQueryKeys.strategyEvaluation(journalId) }),
    ]); },
  });
}

export function convertedJournalPrices(context: PlanningContext) {
  const { entry_price: entry, direction } = context.actual_execution;
  const { planned_stop_pct: stop, planned_target_pct: target } = context.journal_notes;
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (!positive(entry) || !['Long', 'Short'].includes(direction || '')) return null;
  // Incomplete notes may seed one field; malformed supplied fields must never be guessed.
  if ((stop != null && (!positive(stop) || stop > 100)) || (target != null && (!positive(target) || target > 500))) return null;
  if (stop == null && target == null) return null;
  const sign = direction === 'Long' ? 1 : -1;
  const sl = stop == null ? null : entry * (1 - sign * (stop as number) / 100);
  const tp = target == null ? null : entry * (1 + sign * (target as number) / 100);
  if ((sl != null && !positive(sl)) || (tp != null && !positive(tp))) return null;
  return { stopLoss: sl?.toString() || '', takeProfit: tp?.toString() || '' };
}

export function retrospectiveDraft(context: PlanningContext, base: PlanDraft, confirmedPricePercent: boolean): PlanDraft {
  const prices = confirmedPricePercent ? convertedJournalPrices(context) : null;
  const reason = context.journal_notes.planned_entry_reason;
  return { ...base, entryPrice: '', entryMin: '', entryMax: '', takeProfit2: '', setup: '',
    stopLoss: prices?.stopLoss || '', takeProfit: prices?.takeProfit || '',
    entryNote: typeof reason === 'string' ? reason : '',
    memo: prices ? `Retrospective draft from Journal #${context.journal_entry_id}. User confirmed price-move percentages. Actual entry conversion basis: ${context.actual_execution.entry_price}; stop: ${context.journal_notes.planned_stop_pct ?? 'unrecorded'}%; target: ${context.journal_notes.planned_target_pct ?? 'unrecorded'}%. This does not establish original planned entry or pre-trade evidence.` : '',
  };
}
