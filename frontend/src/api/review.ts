import { api, toApiClientError, unwrapApiResponse, type ApiResponse } from './config';
import type { Diagnoses, Experiment, ExperimentDefinition, Measurement, Patterns, ReviewRequest, TradingReview } from '../types/review';

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  try { return unwrapApiResponse(await api.get<ApiResponse<T>>(path, { signal }), 'Unable to load evidence.'); }
  catch (error) { throw toApiClientError(error, 'Unable to load evidence.'); }
}
async function send<T>(path: string, payload: unknown, signal?: AbortSignal, patch = false): Promise<T> {
  try { return unwrapApiResponse(await api[patch ? 'patch' : 'post']<ApiResponse<T>>(path, payload, { signal }), 'Request failed.'); }
  catch (error) { throw toApiClientError(error, 'Request failed.'); }
}
function requireProcessEvidence(data: Diagnoses): Diagnoses {
  // Never render outcome-contaminated legacy diagnosis axes.
  if (!Array.isArray(data?.diagnoses) || data.diagnoses.some(item =>
    !item.execution_rule_evidence?.summary || !item.execution_rule_evidence.excluded_rule_counts_by_role)) {
    throw new Error('Diagnosis unavailable: backend execution-process evidence is missing. Restart the updated Trade Journal backend and retry.');
  }
  return data;
}

export async function getReview(request: ReviewRequest, signal?: AbortSignal): Promise<TradingReview> {
  const data = await send<TradingReview>('/review/trading', request, signal);
  requireProcessEvidence(data.strategy_execution);
  return data;
}
export const getPatterns = (request: ReviewRequest, signal?: AbortSignal) => send<Patterns>('/review/patterns', { ...request, compare_previous: false }, signal);
export async function getDiagnoses(request: ReviewRequest, signal?: AbortSignal): Promise<Diagnoses> {
  const data = await send<Diagnoses>('/review/strategy-execution', { ...request, compare_previous: false }, signal);
  return requireProcessEvidence(data);
}
export const listExperiments = (offset = 0, signal?: AbortSignal) => read<Experiment[]>(`/experiments?offset=${offset}&limit=50`, signal);
export const getExperiment = (id: number, signal?: AbortSignal) => read<Experiment>(`/experiments/${id}`, signal);
export const createExperiment = (definition: ExperimentDefinition) => send<Experiment>('/experiments', definition);
export const updateExperiment = (id: number, revision: number, definition: ExperimentDefinition) => send<Experiment>(`/experiments/${id}`, { revision, definition }, undefined, true);
export const transitionExperiment = (id: number, revision: number, status: Experiment['status']) => send<Experiment>(`/experiments/${id}/transition`, { revision, status });
export const measureExperiment = (id: number, signal?: AbortSignal) => read<Measurement>(`/experiments/${id}/measurement`, signal);
