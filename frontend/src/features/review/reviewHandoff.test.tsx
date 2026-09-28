// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '../../api/review';
import type { Pattern } from '../../types/review';
import { group } from '../analytics/analyticsTestFixtures';
import { canonicalRequest } from '../analytics/analyticsBuilder';
import ExperimentsWorkspace from './ExperimentsWorkspace';
import { diagnosisFixture, experimentFixture, filters, reviewDiscovery, reviewMetadata } from './reviewFixtures';
import { diagnosisSeed, findingSeed, patternSeed } from './reviewHandoff';
import { experimentEvidence, experimentPeriod } from './experimentPresentation';

vi.mock('../../api/review', () => ({ listExperiments: vi.fn(), getExperiment: vi.fn(), createExperiment: vi.fn(), updateExperiment: vi.fn(), transitionExperiment: vi.fn(), measureExperiment: vi.fn() }));
vi.mock('../../api/strategies', () => ({ listStrategies: vi.fn(async () => []), listStrategyVersions: vi.fn(async () => []) }));
const clients: QueryClient[] = [];
const request = { filters: { ...filters, strategy_ids: [7], strategy_version_ids: [42], symbols: ['BTC/USDT'], fomo: ['FALSE'] }, compare_previous: false };
const metadata = reviewDiscovery();
metadata.dimensions.find(item => item.id === 'confidence_score')!.label = 'Confidence Score';
const sourceMetadata = { ...reviewMetadata, filters: request.filters };
function finding(): Pattern {
  return { metric: 'average_r', dimension: 'confidence_score', observed: group('value:2', '-0.9', { trade_sample: 12, evaluable_sample: 12, unavailable_sample: 0 }),
    baseline: group('All selected trades', '0.26', { trade_sample: 36, evaluable_sample: 30, unavailable_sample: 6 }), signed_delta: '-1.16', status: 'ELIGIBLE', reasons: [], evaluable_trade_sample: 12, baseline_evaluable_trade_sample: 30 };
}
function setup(seed = patternSeed(request, finding(), sourceMetadata), isKo = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><ExperimentsWorkspace metadata={metadata} seed={seed} onDirtyChange={vi.fn()} isKo={isKo} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(api.listExperiments).mockResolvedValue([]);
  vi.mocked(api.createExperiment).mockImplementation(async definition => ({ ...experimentFixture(), definition }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

it('adds source evidence without changing the original machine handoff or mutating the Review snapshot', () => {
  const item = finding(), original = JSON.stringify({ request, item, sourceMetadata });
  const { review, ...machine } = patternSeed(request, item, sourceMetadata);
  expect(machine).toEqual(findingSeed(request, item.metric, item.dimension, item.observed.identity));
  expect(machine).toEqual({ query: { metric: 'average_r', dimension: 'confidence_score', filters: { ...request.filters, start_time: 1767312000000, end_time: 1767398399999 } }, baseline: filters, group_key: 'value:2' });
  expect(review).toEqual({ kind: 'pattern', item, metadata: sourceMetadata });
  expect(JSON.stringify({ request, item, sourceMetadata })).toBe(original);
});

it('keeps the exact strategy/version narrowing and the existing diagnosis handoff semantics', () => {
  const identity = diagnosisFixture().identity;
  const item = { ...finding(), dimension: 'strategy_version', observed: { ...finding().observed, identity } };
  const { review: _review, ...machine } = patternSeed(request, item, sourceMetadata);
  expect(_review?.kind).toBe('pattern');
  expect(machine).toEqual(findingSeed(request, 'average_r', 'strategy_version', identity));
  expect(machine.query.filters).toMatchObject({ strategy_ids: [7], strategy_version_ids: [42] });
  const diagnosis = diagnosisSeed({ ...request, filters: { ...request.filters, strategy_version_ids: [99] } }, diagnosisFixture(), sourceMetadata);
  expect(diagnosis.query).toEqual({ metric: 'average_r', dimension: 'all', filters: { ...machine.query.filters, strategy_version_ids: [42] } });
  expect(diagnosis.group_key).toBeNull();
  setup(diagnosis);
  expect(screen.getByRole('region', { name: 'Observation from Review' }).textContent).toContain('Positive results alongside healthy execution');
});

it.each([false, true])('shows actual evidence, readable groups and an empty user-owned action (Korean=%s)', isKo => {
  setup(undefined, isKo);
  const observation = screen.getByRole('region', { name: isKo ? '복기에서 가져온 관찰' : 'Observation from Review' });
  expect(observation.textContent).toContain(isKo ? '확신 점수: 2' : 'Confidence Score: 2');
  expect(observation.textContent).toContain(isKo ? '평균 기록 R' : 'Average recorded R');
  for (const number of ['-0.9 R', '0.26 R', '12/12', '30/36']) expect(observation.textContent).toContain(number);
  expect(observation.textContent).toContain(isKo ? '일부 값이 없거나' : 'Missing or unavailable values');
  expect((screen.getByLabelText(isKo ? '이름' : 'Name') as HTMLInputElement).value).toContain(isKo ? '후속 관찰' : 'follow-up');
  expect((screen.getByLabelText(isKo ? '다음 기간에 무엇을 시도해 보고 싶나요?' : 'What do you want to try during the next period?') as HTMLTextAreaElement).value).toBe('');
  for (const raw of ['value:2', 'average_r', 'confidence_score', 'gte', '1767312000000']) expect(document.body.textContent).not.toContain(raw);
  expect(screen.getByRole('button', { name: isKo ? '고급 측정 설정' : 'Advanced measurement settings' }).getAttribute('aria-expanded')).toBe('false');
  expect(api.createExperiment).not.toHaveBeenCalled(); expect(api.transitionExperiment).not.toHaveBeenCalled(); expect(api.measureExperiment).not.toHaveBeenCalled();
});

it('preserves machine definition exactly through the new presentation and an explicit save', async () => {
  const seed = patternSeed(request, finding(), sourceMetadata), original = JSON.stringify(seed);
  setup(seed);
  const title = (screen.getByLabelText('Name') as HTMLInputElement).value;
  const hypothesis = 'Pause and review the setup again when confidence feels low.';
  fireEvent.change(screen.getByLabelText('What do you want to try during the next period?'), { target: { value: hypothesis } });
  expect(api.createExperiment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(api.createExperiment).toHaveBeenCalledTimes(1));
  expect(api.createExperiment).toHaveBeenCalledWith({ name: title, hypothesis, notes: '', query: canonicalRequest(seed.query), baseline: seed.baseline, group_key: 'value:2', criterion: { basis: 'VALUE', operator: 'gte', target: '0' }, minimum_sample: 5 });
  expect(JSON.stringify(seed)).toBe(original);
  expect(api.transitionExperiment).not.toHaveBeenCalled(); expect(api.measureExperiment).not.toHaveBeenCalled();
  // Saved definitions stand alone: reopening does not require the Review sentence.
  await screen.findByRole('heading', { name: `${title} · DRAFT` });
  expect(screen.queryByRole('region', { name: 'Observation from Review' })).toBeNull();
  expect((screen.getByLabelText('Hypothesis') as HTMLTextAreaElement).value).toBe(hypothesis);
});

it('Advanced is keyboard accessible and edits drive the comparison without rewriting the original observation', async () => {
  setup();
  const advanced = screen.getByRole('button', { name: 'Advanced measurement settings' });
  advanced.focus(); await userEvent.keyboard('{Enter}');
  expect(advanced.getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByLabelText(/^Exact observed group key/) as HTMLInputElement).value).toBe('value:2');
  expect((screen.getByLabelText('Target metric') as HTMLSelectElement).value).toBe('average_r');
  fireEvent.click(screen.getByText('Exact identifiers and original Review evidence'));
  expect(screen.getByText(/"metric": "average_r"/).textContent).toContain('"group_key": "value:2"');
  fireEvent.change(screen.getByLabelText(/^Exact observed group key/), { target: { value: 'value:4' } });
  fireEvent.change(screen.getByLabelText('Criterion basis'), { target: { value: 'DELTA' } });
  fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'lte' } });
  fireEvent.change(screen.getByLabelText('Target'), { target: { value: '-0.25' } });
  fireEvent.change(screen.getByLabelText('Minimum evaluable sample and trades'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('Baseline start (UTC)'), { target: { value: '2025-12-01T00:00:00.123' } });
  const comparison = screen.getByRole('region', { name: 'What will be compared' });
  expect(comparison.textContent).toContain('Group selected in Advanced settings');
  expect(comparison.textContent).toContain('Next result minus baseline result at most -0.25 R');
  expect(comparison.textContent).toContain('9 evaluable samples and 9 trades');
  expect(comparison.textContent).toContain(experimentPeriod(Date.parse('2025-12-01T00:00:00.123Z'), filters.end_time, false));
  expect(screen.getByRole('region', { name: 'Observation from Review' }).textContent).toContain('Confidence Score: 2');
  fireEvent.change(screen.getByLabelText('What do you want to try during the next period?'), { target: { value: 'My own action' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(api.createExperiment).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.createExperiment).mock.calls[0][0]).toMatchObject({ group_key: 'value:4', minimum_sample: 9, criterion: { basis: 'DELTA', operator: 'lte', target: '-0.25' }, baseline: { start_time: Date.parse('2025-12-01T00:00:00.123Z'), end_time: filters.end_time } });
});

it('keeps unavailable and small evidence neutral and retains exact evidence kinds', () => {
  const item = finding(); item.observed.value = null; item.evaluable_trade_sample = 2;
  item.observed.evidence_semantics = 'ESTIMATED_OPPORTUNITY_COST'; item.baseline.evidence_semantics = 'COUNTERFACTUAL_SIMULATION';
  setup(patternSeed(request, item, sourceMetadata));
  const observation = screen.getByRole('region', { name: 'Observation from Review' });
  for (const text of ['Unavailable', 'Small sample', 'Estimated opportunity cost', 'Counterfactual simulation', 'Observed association', 'not a cause or a prediction']) expect(observation.textContent).toContain(text);
  expect(experimentEvidence('NEW_UNKNOWN_EVIDENCE', false)).toBe('Other evidence — inspect Advanced settings');
});

it('formats local dates without changing millisecond boundaries and does not silently roll an old sample forward', () => {
  const seed = patternSeed(request, finding(), sourceMetadata), before = JSON.stringify(seed);
  setup(seed);
  const comparison = screen.getByRole('region', { name: 'What will be compared' });
  expect(comparison.textContent).toContain(experimentPeriod(filters.start_time, filters.end_time, false));
  expect(comparison.textContent).toContain(experimentPeriod(Number(seed.query.filters.start_time), Number(seed.query.filters.end_time), false));
  expect(comparison.textContent).toContain('This observation period has already ended');
  expect(comparison.textContent).toContain('differs from the group-versus-overall');
  expect(JSON.stringify(seed)).toBe(before);
});

it('falls back to the existing manual editor when a fresh mount has no transient Review context', () => {
  setup(findingSeed(request, 'average_r'));
  expect(screen.queryByRole('region', { name: 'Observation from Review' })).toBeNull();
  expect(screen.getByLabelText('Hypothesis')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Advanced measurement settings' }).getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
});

it.each(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const)('opens a saved %s without attributing a different Review observation to it', async status => {
  const record = experimentFixture(1, status);
  vi.mocked(api.listExperiments).mockResolvedValue([record]); vi.mocked(api.getExperiment).mockResolvedValue(record);
  setup(); fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ }));
  await screen.findByRole('heading', { name: `Experiment 1 · ${status}` });
  expect(screen.queryByRole('region', { name: 'Observation from Review' })).toBeNull();
  expect((screen.getByLabelText('Hypothesis') as HTMLTextAreaElement).value).toBe('User hypothesis');
  expect(api.updateExperiment).not.toHaveBeenCalled(); expect(api.transitionExperiment).not.toHaveBeenCalled(); expect(api.measureExperiment).not.toHaveBeenCalled();
});

it('uses the actual current metric and flags changed filters instead of describing a stale cohort', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Advanced measurement settings' }));
  fireEvent.change(screen.getByLabelText('Target metric'), { target: { value: 'trade_count' } });
  fireEvent.change(screen.getByLabelText('symbols'), { target: { value: 'ETH/USDT' } });
  const comparison = screen.getByRole('region', { name: 'What will be compared' });
  expect(comparison.textContent).toContain('Trade count');
  expect(comparison.textContent).toContain('Recorded filters differ');
  expect(within(screen.getByRole('region', { name: 'Observation from Review' })).getByText(/Average recorded R/)).toBeTruthy();
});
