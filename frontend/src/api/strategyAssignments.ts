import type { AxiosResponse } from 'axios';

import type { JournalStrategyAssignment } from '../types';
import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';

async function request<T>(operation: () => Promise<AxiosResponse<ApiResponse<T>>>, fallback: string): Promise<T> {
  try {
    return unwrapApiResponse(await operation(), fallback);
  } catch (error: unknown) {
    throw toApiClientError(error, fallback);
  }
}

export function getJournalStrategyAssignment(entryId: number): Promise<JournalStrategyAssignment | null> {
  return request(
    () => api.get<ApiResponse<JournalStrategyAssignment | null>>(`/journal/${entryId}/strategy-version`),
    'Failed to load the Strategy assignment.',
  );
}

export function putJournalStrategyAssignment(entryId: number, strategyVersionId: number): Promise<JournalStrategyAssignment> {
  return request(
    () => api.put<ApiResponse<JournalStrategyAssignment>>(`/journal/${entryId}/strategy-version`, {
      strategy_version_id: strategyVersionId,
    }),
    'Failed to save the Strategy assignment.',
  );
}

export function deleteJournalStrategyAssignment(entryId: number): Promise<null> {
  return request(
    () => api.delete<ApiResponse<null>>(`/journal/${entryId}/strategy-version`),
    'Failed to remove the Strategy assignment.',
  );
}
