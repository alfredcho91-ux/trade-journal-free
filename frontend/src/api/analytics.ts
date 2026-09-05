import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';
import type { AnalyticsMetadata, AnalyticsRequest, AnalyticsResult } from '../types/analytics';

export async function getAnalyticsMetadata(signal?: AbortSignal): Promise<AnalyticsMetadata> {
  try {
    return unwrapApiResponse(await api.get<ApiResponse<AnalyticsMetadata>>('/analytics/metadata', { signal }), 'Unable to load analytics metadata.');
  } catch (error) { throw toApiClientError(error, 'Unable to load analytics metadata.'); }
}
export async function queryAnalytics(request: AnalyticsRequest, signal?: AbortSignal): Promise<AnalyticsResult> {
  try {
    return unwrapApiResponse(await api.post<ApiResponse<AnalyticsResult>>('/analytics/query', request, { signal }), 'Unable to load analysis.');
  } catch (error) { throw toApiClientError(error, 'Unable to load analysis.'); }
}
