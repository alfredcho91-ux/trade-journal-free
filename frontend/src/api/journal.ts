// 매매 일지 API

import { api, ApiResponse, ensureApiSuccess, toApiClientError, unwrapApiResponse } from './config';
import type {
  DeepcoinStatus,
  DeepcoinSyncResult,
  DeepcoinTradeMarkers,
  ExchangeId,
  ExchangeStatus,
  ExchangeSyncResult,
  JournalExcursionData,
  JournalCurrentMarketData,
  JournalQualityAnalysisData,
  JournalSlTpAnalysisData,
  JournalStopLossAnalysisData,
  JournalStopOptimizationData,
  JournalEntry,
} from '../types';

export async function getJournal(): Promise<JournalEntry[]> {
  try {
    const res = await api.get<ApiResponse<JournalEntry[]>>('/journal');
    return unwrapApiResponse(res, 'Failed to load journal entries.');
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load journal entries.');
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
