// 매매 일지 API

import { api, ApiResponse, ensureApiSuccess, toApiClientError, unwrapApiResponse } from './config';
import type {
  DeepcoinStatus,
  DeepcoinOpenPosition,
  ExchangeOpenPositionsData,
  DeepcoinSyncResult,
  DeepcoinTradeMarkers,
  ExchangeId,
  ExchangeStatus,
  ExchangeSyncResult,
  JournalExcursionData,
  JournalCurrentMarketData,
  JournalBehaviorAnalysisData,
  JournalBehaviorComparisonData,
  JournalBehaviorCondition,
  JournalBehaviorRule,
  JournalQualityAnalysisData,
  JournalSlTpAnalysisData,
  JournalStopLossAnalysisData,
  JournalStopOptimizationData,
  JournalEntry,
  JournalBehaviorUpdatePayload,
  DailyJournalEntry,
  DailyJournalUpdatePayload,
  JournalExitHoldAnalysisData,
  ExitHoldInterval,
  JournalPerformanceData,
  PlanLabData,
  PlanRevisionInput,
  PlanSide,
  PlanSource,
  PlanStatus,
  TradingPlan,
} from '../types';

export async function getPlans(): Promise<TradingPlan[]> {
  try {
    const res = await api.get<ApiResponse<TradingPlan[]>>('/plans');
    return unwrapApiResponse(res, 'Failed to load trading plans.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load trading plans.');
  }
}

export async function createPlan(payload: {
  exchange: string;
  symbol: string;
  side: PlanSide;
  revision: PlanRevisionInput;
}): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>('/plans', payload);
    return unwrapApiResponse(res, 'Failed to create the plan.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to create the plan.');
  }
}

export async function createRetrospectivePlan(
  journalEntryId: number,
  revision: PlanRevisionInput,
): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>('/plans/retrospective', {
      journal_entry_id: journalEntryId,
      revision,
    });
    return unwrapApiResponse(res, 'Failed to create the retrospective plan.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to create the retrospective plan.');
  }
}

export async function createInTradePlan(payload: {
  exchange: string;
  position_id: string;
  revision: PlanRevisionInput;
}): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>('/plans/in-trade', payload);
    return unwrapApiResponse(res, 'Failed to create the in-trade plan.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to create the in-trade plan.');
  }
}

export async function addPlanRevision(planId: number, payload: PlanRevisionInput): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>(`/plans/${planId}/revisions`, payload);
    return unwrapApiResponse(res, 'Failed to revise the plan.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to revise the plan.');
  }
}

export async function addInTradePlanRevision(planId: number, payload: PlanRevisionInput): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>(`/plans/${planId}/in-trade-revisions`, payload);
    return unwrapApiResponse(res, 'Failed to revise the in-trade plan.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to revise the in-trade plan.');
  }
}

export async function linkPlanToTrade(planId: number, journalEntryId: number): Promise<TradingPlan> {
  try {
    const res = await api.post<ApiResponse<TradingPlan>>(`/plans/${planId}/link`, { journal_entry_id: journalEntryId });
    return unwrapApiResponse(res, 'Failed to link the plan to the trade.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to link the plan to the trade.');
  }
}

export async function updatePlanStatus(planId: number, status: PlanStatus): Promise<TradingPlan> {
  try {
    const res = await api.patch<ApiResponse<TradingPlan>>(`/plans/${planId}/status`, { status });
    return unwrapApiResponse(res, 'Failed to update the plan status.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to update the plan status.');
  }
}

export async function getPlanLab(params: {
  start_time: number;
  end_time: number;
  direction?: PlanSide;
  setup?: string;
  symbol?: string;
  plan_source?: Exclude<PlanSource, 'UNLINKED'>;
}): Promise<PlanLabData> {
  try {
    const res = await api.get<ApiResponse<PlanLabData>>('/plan-lab', { params, timeout: 180_000 });
    return unwrapApiResponse(res, 'Failed to load Plan Lab.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load Plan Lab.');
  }
}

export async function getJournal(): Promise<JournalEntry[]> {
  try {
    const res = await api.get<ApiResponse<JournalEntry[]>>('/journal');
    return unwrapApiResponse(res, 'Failed to load journal entries.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load journal entries.');
  }
}

export async function getJournalPerformance(params: {
  start_time: number;
  end_time: number;
}): Promise<JournalPerformanceData> {
  try {
    const res = await api.get<ApiResponse<JournalPerformanceData>>('/journal/performance', { params });
    return unwrapApiResponse(res, 'Failed to load journal performance.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load journal performance.');
  }
}

export async function getJournalCurrentMarket(coin: string): Promise<JournalCurrentMarketData> {
  try {
    const res = await api.get<ApiResponse<JournalCurrentMarketData>>('/journal/current-market', {
      params: { coin },
      timeout: 60_000,
    });
    return unwrapApiResponse(res, 'Failed to load the current market snapshot.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load the current market snapshot.');
  }
}

export async function getJournalExcursions(params: {
  start_time: number;
  end_time: number;
}): Promise<JournalExcursionData> {
  try {
    const res = await api.get<ApiResponse<JournalExcursionData>>('/journal/excursions', { params, timeout: 60_000 });
    return unwrapApiResponse(res, 'Failed to load trade excursions.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load trade excursions.');
  }
}

export async function getJournalQualityAnalysis(params: {
  start_time: number;
  end_time: number;
  min_abs_net_return_pct?: number;
}): Promise<JournalQualityAnalysisData> {
  try {
    const res = await api.get<ApiResponse<JournalQualityAnalysisData>>('/journal/quality-analysis', {
      params,
      timeout: 120_000,
    });
    return unwrapApiResponse(res, 'Failed to load trade quality analysis.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load trade quality analysis.');
  }
}

export async function getJournalExitHoldAnalysis(params: {
  start_time: number;
  end_time: number;
  interval: ExitHoldInterval;
  min_abs_net_return_pct?: number;
}): Promise<JournalExitHoldAnalysisData> {
  try {
    const res = await api.get<ApiResponse<JournalExitHoldAnalysisData>>('/journal/exit-hold-analysis', {
      params,
      timeout: 120_000,
    });
    return unwrapApiResponse(res, 'Failed to load post-exit holding analysis.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load post-exit holding analysis.');
  }
}

export async function getJournalBehaviorAnalysis(params: {
  start_time: number;
  end_time: number;
  min_abs_net_return_pct?: number;
}): Promise<JournalBehaviorAnalysisData> {
  try {
    const res = await api.get<ApiResponse<JournalBehaviorAnalysisData>>('/journal/behavior-analysis', { params, timeout: 120_000 });
    return unwrapApiResponse(res, 'Failed to load trade behavior analysis.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load trade behavior analysis.');
  }
}

export async function compareJournalBehavior(payload: {
  start_time: number;
  end_time: number;
  min_abs_net_return_pct?: number;
  left: JournalBehaviorCondition;
  right: JournalBehaviorCondition;
}): Promise<JournalBehaviorComparisonData> {
  try {
    const res = await api.post<ApiResponse<JournalBehaviorComparisonData>>('/journal/behavior-analysis/compare', payload, { timeout: 120_000 });
    return unwrapApiResponse(res, 'Failed to compare trade behavior.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to compare trade behavior.');
  }
}

export async function updateJournalBehavior(id: number, payload: JournalBehaviorUpdatePayload): Promise<JournalEntry> {
  try {
    const res = await api.patch<ApiResponse<JournalEntry>>(`/journal/${id}/behavior`, payload);
    return unwrapApiResponse(res, 'Failed to update trade behavior.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to update trade behavior.');
  }
}

export async function getDailyJournals(params: {
  start_date?: string;
  end_date?: string;
} = {}): Promise<DailyJournalEntry[]> {
  try {
    const res = await api.get<ApiResponse<DailyJournalEntry[]>>('/journal/daily', { params });
    return unwrapApiResponse(res, 'Failed to load daily journal entries.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load daily journal entries.');
  }
}

export async function getDailyJournal(tradeDate: string, signal?: AbortSignal): Promise<DailyJournalEntry | null> {
  try {
    const res = await api.get<ApiResponse<DailyJournalEntry>>(`/journal/daily/${tradeDate}`, { signal });
    return unwrapApiResponse(res, 'Failed to load the daily journal.');
  } catch (error: unknown) {
    const apiError = toApiClientError(error, 'Failed to load the daily journal.');
    if (apiError.status === 404) return null;
    throw apiError;
  }
}

export async function saveDailyJournal(
  tradeDate: string,
  payload: DailyJournalUpdatePayload,
): Promise<DailyJournalEntry> {
  try {
    const res = await api.put<ApiResponse<DailyJournalEntry>>(`/journal/daily/${tradeDate}`, payload);
    return unwrapApiResponse(res, 'Failed to save the daily journal.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to save the daily journal.');
  }
}

export async function deleteDailyJournal(tradeDate: string): Promise<boolean> {
  try {
    const res = await api.delete<ApiResponse<null>>(`/journal/daily/${tradeDate}`);
    ensureApiSuccess(res, 'Failed to delete the daily journal.');
    return true;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to delete the daily journal.');
  }
}

export async function getJournalBehaviorRules(): Promise<JournalBehaviorRule[]> {
  try {
    const res = await api.get<ApiResponse<JournalBehaviorRule[]>>('/journal/behavior-rules');
    return unwrapApiResponse(res, 'Failed to load behavior rules.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load behavior rules.');
  }
}

export async function createJournalBehaviorRule(payload: Omit<JournalBehaviorRule, 'id' | 'created_at' | 'updated_at'>): Promise<JournalBehaviorRule> {
  try {
    const res = await api.post<ApiResponse<JournalBehaviorRule>>('/journal/behavior-rules', payload);
    return unwrapApiResponse(res, 'Failed to create behavior rule.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to create behavior rule.');
  }
}

export async function updateJournalBehaviorRule(id: number, payload: Partial<Omit<JournalBehaviorRule, 'id' | 'created_at' | 'updated_at'>>): Promise<JournalBehaviorRule> {
  try {
    const res = await api.patch<ApiResponse<JournalBehaviorRule>>(`/journal/behavior-rules/${id}`, payload);
    return unwrapApiResponse(res, 'Failed to update behavior rule.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to update behavior rule.');
  }
}

export async function deleteJournalBehaviorRule(id: number): Promise<boolean> {
  try {
    const res = await api.delete<ApiResponse<null>>(`/journal/behavior-rules/${id}`);
    ensureApiSuccess(res, 'Failed to delete behavior rule.');
    return true;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to delete behavior rule.');
  }
}

export async function getJournalStopLossAnalysis(params: {
  start_time: number;
  end_time: number;
}): Promise<JournalStopLossAnalysisData> {
  try {
    const res = await api.get<ApiResponse<JournalStopLossAnalysisData>>('/journal/stop-loss-analysis', {
      params,
      timeout: 120_000,
    });
    return unwrapApiResponse(res, 'Failed to load stop-loss analysis.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load stop-loss analysis.');
  }
}

export async function getJournalStopOptimization(params: {
  start_time: number;
  end_time: number;
}): Promise<JournalStopOptimizationData> {
  try {
    const res = await api.get<ApiResponse<JournalStopOptimizationData>>('/journal/stop-optimization', {
      params,
      timeout: 180_000,
    });
    return unwrapApiResponse(res, 'Failed to load stop optimization.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load stop optimization.');
  }
}

export interface JournalSlTpParams {
  start_time: number;
  end_time: number;
  sl_min: number;
  sl_max: number;
  sl_step: number;
  tp_min: number;
  tp_max: number;
  tp_step: number;
}

export async function getJournalSlTpAnalysis(params: JournalSlTpParams): Promise<JournalSlTpAnalysisData> {
  try {
    const res = await api.get<ApiResponse<JournalSlTpAnalysisData>>('/journal/sl-tp-analysis', {
      params,
      timeout: 240_000,
    });
    return unwrapApiResponse(res, 'Failed to load SL/TP analysis.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load SL/TP analysis.');
  }
}

export async function deleteJournalEntry(id: number): Promise<boolean> {
  try {
    const res = await api.delete<ApiResponse<null>>(`/journal/${id}`);
    ensureApiSuccess(res, 'Failed to delete the journal entry.');
    return true;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to delete the journal entry.');
  }
}

export async function getDeepcoinStatus(): Promise<DeepcoinStatus> {
  try {
    const res = await api.get<ApiResponse<DeepcoinStatus>>('/deepcoin/status');
    return unwrapApiResponse(res, 'Failed to load Deepcoin connection status.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load Deepcoin connection status.');
  }
}

export async function getDeepcoinOpenPositions(): Promise<DeepcoinOpenPosition[]> {
  try {
    const res = await api.get<ApiResponse<DeepcoinOpenPosition[]>>('/deepcoin/open-positions');
    return unwrapApiResponse(res, 'Failed to load Deepcoin open positions.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load Deepcoin open positions.');
  }
}

export async function getExchangeOpenPositions(): Promise<ExchangeOpenPositionsData> {
  try {
    const res = await api.get<ApiResponse<ExchangeOpenPositionsData>>('/exchanges/open-positions');
    return unwrapApiResponse(res, 'Failed to load exchange open positions.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load exchange open positions.');
  }
}

export async function syncDeepcoinFills(params: {
  inst_type: 'SWAP' | 'SPOT';
  lookback_days: number;
}): Promise<DeepcoinSyncResult> {
  try {
    const res = await api.post<ApiResponse<DeepcoinSyncResult>>('/deepcoin/sync', params, {
      timeout: 360_000,
    });
    return unwrapApiResponse(res, 'Failed to sync Deepcoin fills.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to sync Deepcoin fills.');
  }
}

export async function getDeepcoinTradeMarkers(params: {
  symbol: string;
  direction: 'Long' | 'Short';
  entry_time: string;
  exit_time: string;
  entry_price: number;
}): Promise<DeepcoinTradeMarkers> {
  try {
    const res = await api.get<ApiResponse<DeepcoinTradeMarkers>>('/deepcoin/trade-markers', {
      params,
    });
    return unwrapApiResponse(res, 'Failed to load Deepcoin trade markers.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load Deepcoin trade markers.');
  }
}

export async function getExchangeStatuses(): Promise<ExchangeStatus[]> {
  try {
    const res = await api.get<ApiResponse<{ exchanges: ExchangeStatus[] }>>('/exchanges');
    return unwrapApiResponse(res, 'Failed to load exchange connection status.').exchanges;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load exchange connection status.');
  }
}

export async function getExchangeExecutions(params: {
  exchange?: string;
  symbol?: string;
  start_time?: string;
  end_time?: string;
}): Promise<JournalEntry[]> {
  try {
    const res = await api.get<ApiResponse<JournalEntry[]>>('/exchanges/executions', { params });
    return unwrapApiResponse(res, 'Failed to load exchange executions.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load exchange executions.');
  }
}

export async function configureExchangeCredentials(params: {
  exchange: ExchangeId;
  api_key: string;
  secret_key: string;
  passphrase?: string;
}): Promise<ExchangeStatus[]> {
  try {
    const { exchange, ...body } = params;
    const res = await api.post<ApiResponse<{ exchanges: ExchangeStatus[] }>>(`/exchanges/${exchange}/credentials`, body, { timeout: 30_000 });
    return unwrapApiResponse(res, 'Failed to verify and save exchange credentials.').exchanges;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to verify and save exchange credentials.');
  }
}

export async function deleteExchangeCredentials(exchange: ExchangeId): Promise<{
  exchanges: ExchangeStatus[];
  deleted: boolean;
  environment_override: boolean;
}> {
  try {
    const res = await api.delete<ApiResponse<{
      exchanges: ExchangeStatus[];
      deleted: boolean;
      environment_override: boolean;
    }>>(`/exchanges/${exchange}/credentials`);
    return unwrapApiResponse(res, 'Failed to remove exchange credentials.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to remove exchange credentials.');
  }
}

export async function syncExchange(params: {
  exchange: ExchangeId;
  inst_type: 'SWAP' | 'SPOT';
  lookback_days: number;
  symbols: string[];
}): Promise<ExchangeSyncResult> {
  try {
    const { exchange, ...body } = params;
    const res = await api.post<ApiResponse<ExchangeSyncResult>>(`/exchanges/${exchange}/sync`, body, {
      timeout: 360_000,
    });
    return unwrapApiResponse(res, 'Failed to sync exchange trades.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to sync exchange trades.');
  }
}
