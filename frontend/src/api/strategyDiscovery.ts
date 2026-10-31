import type { AxiosResponse } from 'axios';
import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';
import type { StrategyCreateInput } from '../types';
import type { CandidateAdoption, DiscoveryEvidencePage, DiscoveryMetadata, DiscoveryRequest, DiscoveryRunDetail, DiscoveryRunPage, StrategyCandidate } from '../types/strategyDiscovery';

async function request<T>(operation: () => Promise<AxiosResponse<ApiResponse<T>>>): Promise<T> {
  try { return unwrapApiResponse(await operation(), 'Strategy discovery request failed.'); }
  catch (error) { throw toApiClientError(error, 'Strategy discovery request failed.'); }
}
const root = '/strategy-discovery';
export const getDiscoveryMetadata = (signal?: AbortSignal) => request(() => api.get<ApiResponse<DiscoveryMetadata>>(`${root}/metadata`, { signal }));
export const listDiscoveryRuns = (offset = 0, signal?: AbortSignal) => request(() => api.get<ApiResponse<DiscoveryRunPage>>(`${root}/runs`, { params: { offset }, signal }));
export const getDiscoveryRun = (id: number, signal?: AbortSignal) => request(() => api.get<ApiResponse<DiscoveryRunDetail>>(`${root}/runs/${id}`, { signal }));
export const getDiscoveryCandidate = (id: number, signal?: AbortSignal) => request(() => api.get<ApiResponse<StrategyCandidate>>(`${root}/candidates/${id}`, { signal }));
export const getDiscoveryEvidence = (id: number, offset: number, signal?: AbortSignal) => request(() => api.get<ApiResponse<DiscoveryEvidencePage>>(`${root}/candidates/${id}/evidence`, { params: { offset }, signal }));
export const createDiscoveryRun = (payload: DiscoveryRequest, key: string) => request(() => api.post<ApiResponse<DiscoveryRunDetail>>(`${root}/runs`, payload, { headers: { 'Idempotency-Key': key } }));
export const adoptDiscoveryCandidate = (id: number, strategy: StrategyCreateInput, key: string) => request(() => api.post<ApiResponse<CandidateAdoption>>(`${root}/candidates/${id}/adopt`, { strategy }, { headers: { 'Idempotency-Key': key } }));
