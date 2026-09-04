import type { AxiosResponse } from 'axios';

import type { RuleEngineMetadata } from '../types';
import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';

async function request<T>(operation: () => Promise<AxiosResponse<ApiResponse<T>>>, fallback: string): Promise<T> {
  try {
    return unwrapApiResponse(await operation(), fallback);
  } catch (error: unknown) {
    throw toApiClientError(error, fallback);
  }
}

export function getRuleEngineMetadata(): Promise<RuleEngineMetadata> {
  return request(
    () => api.get<ApiResponse<RuleEngineMetadata>>('/rule-engine/metadata'),
    'Failed to load Rule Engine metadata.',
  );
}
