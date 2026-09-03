import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';
import type { AxiosResponse } from 'axios';
import type {
  Strategy,
  StrategyCreateInput,
  StrategyUpdateInput,
  StrategyVersion,
  StrategyVersionInput,
} from '../types';

async function request<T>(operation: () => Promise<AxiosResponse<ApiResponse<T>>>, fallback: string): Promise<T> {
  try {
    return unwrapApiResponse(await operation(), fallback);
  } catch (error: unknown) {
    throw toApiClientError(error, fallback);
  }
}

export function listStrategies(includeArchived = false): Promise<Strategy[]> {
  return request(() => api.get<ApiResponse<Strategy[]>>('/strategies', {
    params: { include_archived: includeArchived },
  }), 'Failed to load strategies.');
}

export function getStrategy(strategyId: number): Promise<Strategy> {
  return request(() => api.get<ApiResponse<Strategy>>(`/strategies/${strategyId}`), 'Failed to load the strategy.');
}

export function createStrategy(payload: StrategyCreateInput): Promise<Strategy> {
  return request(() => api.post<ApiResponse<Strategy>>('/strategies', payload), 'Failed to create the strategy.');
}

export function updateStrategy(strategyId: number, payload: StrategyUpdateInput): Promise<Strategy> {
  return request(() => api.patch<ApiResponse<Strategy>>(`/strategies/${strategyId}`, payload), 'Failed to update the strategy.');
}

export function archiveStrategy(strategyId: number): Promise<Strategy> {
  return request(() => api.post<ApiResponse<Strategy>>(`/strategies/${strategyId}/archive`), 'Failed to archive the strategy.');
}

export function restoreStrategy(strategyId: number): Promise<Strategy> {
  return request(() => api.post<ApiResponse<Strategy>>(`/strategies/${strategyId}/restore`), 'Failed to restore the strategy.');
}

export function listStrategyVersions(strategyId: number): Promise<StrategyVersion[]> {
  return request(() => api.get<ApiResponse<StrategyVersion[]>>(`/strategies/${strategyId}/versions`), 'Failed to load strategy versions.');
}

export function getStrategyVersion(strategyId: number, versionId: number): Promise<StrategyVersion> {
  return request(() => api.get<ApiResponse<StrategyVersion>>(`/strategies/${strategyId}/versions/${versionId}`), 'Failed to load the strategy version.');
}

export function createStrategyVersion(strategyId: number, payload: StrategyVersionInput): Promise<StrategyVersion> {
  return request(() => api.post<ApiResponse<StrategyVersion>>(`/strategies/${strategyId}/versions`, payload), 'Failed to create the strategy version.');
}

export function activateStrategyVersion(strategyId: number, versionId: number): Promise<StrategyVersion> {
  return request(() => api.post<ApiResponse<StrategyVersion>>(`/strategies/${strategyId}/versions/${versionId}/activate`), 'Failed to activate the strategy version.');
}

export function retireStrategyVersion(strategyId: number, versionId: number): Promise<StrategyVersion> {
  return request(() => api.post<ApiResponse<StrategyVersion>>(`/strategies/${strategyId}/versions/${versionId}/retire`), 'Failed to retire the strategy version.');
}
