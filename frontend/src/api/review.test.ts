import type { AxiosResponse } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './config';
import { createExperiment, getDiagnoses, getExperiment, getPatterns, getReview, listExperiments, measureExperiment, transitionExperiment, updateExperiment } from './review';
import { experimentFixture, filters, tradingFixture } from '../features/review/reviewFixtures';

afterEach(() => vi.restoreAllMocks());
it('uses typed Review endpoints and prevents comparison leaking into current-only requests', async () => {
  const review = tradingFixture();
  const post = vi.spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: review } } as AxiosResponse)
    .mockResolvedValueOnce({ data: { success: true, data: review.patterns } } as AxiosResponse)
    .mockResolvedValueOnce({ data: { success: true, data: review.strategy_execution } } as AxiosResponse);
  const signal = new AbortController().signal;
  const request = { filters, compare_previous: true };
  await getReview(request, signal); await getPatterns(request, signal); await getDiagnoses(request, signal);
  expect(post).toHaveBeenNthCalledWith(1, '/review/trading', request, { signal });
  expect(post).toHaveBeenNthCalledWith(2, '/review/patterns', { filters, compare_previous: false }, { signal });
  expect(post).toHaveBeenNthCalledWith(3, '/review/strategy-execution', { filters, compare_previous: false }, { signal });
});
it('rejects stale backend diagnosis evidence without substituting global adherence', async () => {
  const data = tradingFixture().strategy_execution;
  const { execution_rule_evidence: omitted, ...legacy } = data.diagnoses[0];
  expect(omitted.summary.adherence_pct).toBe('100');
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: { ...data, diagnoses: [legacy] } } } as AxiosResponse);
  await expect(getDiagnoses({ filters, compare_previous: false })).rejects.toThrow('backend execution-process evidence is missing');
});
it('rejects stale embedded diagnosis evidence from the single Review response', async () => {
  const review = tradingFixture();
  const { execution_rule_evidence: omitted, ...legacy } = review.strategy_execution.diagnoses[0];
  expect(omitted.summary.coverage_pct).toBe('80');
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: { ...review, strategy_execution: { ...review.strategy_execution, diagnoses: [legacy] } } } } as AxiosResponse);
  await expect(getReview({ filters, compare_previous: false })).rejects.toThrow('backend execution-process evidence is missing');
});
it('uses bounded experiment resources, revision-protected mutations and fresh measurement', async () => {
  const row = experimentFixture(); const response = { data: { success: true, data: row } } as AxiosResponse;
  const get = vi.spyOn(api, 'get').mockResolvedValue(response); const post = vi.spyOn(api, 'post').mockResolvedValue(response); const patch = vi.spyOn(api, 'patch').mockResolvedValue(response);
  const signal = new AbortController().signal;
  await listExperiments(50, signal); await getExperiment(1, signal); await measureExperiment(1, signal);
  expect(get).toHaveBeenCalledWith('/experiments?offset=50&limit=50', { signal });
  expect(get).toHaveBeenCalledWith('/experiments/1/measurement', { signal });
  await createExperiment(row.definition); await updateExperiment(1,2,row.definition); await transitionExperiment(1,2,'ACTIVE');
  expect(post).toHaveBeenCalledWith('/experiments', row.definition, { signal: undefined });
  expect(patch).toHaveBeenCalledWith('/experiments/1', { revision: 2, definition: row.definition }, { signal: undefined });
  expect(post).toHaveBeenCalledWith('/experiments/1/transition', { revision: 2, status: 'ACTIVE' }, { signal: undefined });
});
it('preserves conflict and validation semantics for the editor', async () => {
  vi.spyOn(api, 'patch').mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { error: 'Experiment changed; reload before saving' } } });
  await expect(updateExperiment(1,1,experimentFixture().definition)).rejects.toMatchObject({ status: 409, message: 'Experiment changed; reload before saving' });
});
