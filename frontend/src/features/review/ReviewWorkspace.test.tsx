// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as api from '../../api/review';
import { getAnalyticsMetadata } from '../../api/analytics';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import type { Classification, Experiment, Measurement, TradingReview } from '../../types/review';
import AnalyticsWorkspace from '../analytics/AnalyticsWorkspace';
import { group } from '../analytics/analyticsTestFixtures';
import { BrowserRouter } from '../../router';
import { useNavigate } from '../../router-context';
import { DiagnosisCards, PatternFindings, ReviewSections } from './ReviewEvidence';
import ReviewWorkspace from './ReviewWorkspace';
import ExperimentsWorkspace, { MeasurementView } from './ExperimentsWorkspace';
import { diagnosisFixture, experimentFixture, filters, patternFixture, reviewDiscovery, tradingFixture } from './reviewFixtures';
import { findingSeed } from './reviewHandoff';

vi.mock('../../api/review', () => ({ getReview: vi.fn(), getPatterns: vi.fn(), getDiagnoses: vi.fn(), listExperiments: vi.fn(), getExperiment: vi.fn(), createExperiment: vi.fn(), updateExperiment: vi.fn(), transitionExperiment: vi.fn(), measureExperiment: vi.fn() }));
vi.mock('../../api/analytics', () => ({ getAnalyticsMetadata: vi.fn(), queryAnalytics: vi.fn() }));
vi.mock('../../api/strategies', () => ({ listStrategies: vi.fn(), listStrategyVersions: vi.fn() }));
const clients: QueryClient[] = [];
function setup(element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return { ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>), client };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void; return { promise: new Promise<T>((r, j) => { resolve = r; reject = j; }), resolve: (value: T) => resolve(value), reject: (reason?: unknown) => reject(reason) }; }
const measurement = (state: Measurement['criterion_status'] = 'MET'): Measurement => ({ experiment_id: 1, definition_revision: 1, current: group('Current', '0.000000001'), baseline: group('Baseline', null), delta: null, criterion_status: state,
  reasons: ['BASELINE_UNAVAILABLE'], query: experimentFixture().definition.query, baseline_query: experimentFixture().definition.query, evidence_semantics: 'OBSERVED_ASSOCIATION', evaluation_basis: 'CURRENT_RECONSTRUCTED', warnings: ['User-defined criterion, not a causal conclusion.'] });
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(getAnalyticsMetadata).mockResolvedValue(reviewDiscovery());
  vi.mocked(listStrategies).mockResolvedValue([]); vi.mocked(listStrategyVersions).mockResolvedValue([]);
  vi.mocked(api.getReview).mockResolvedValue(tradingFixture()); vi.mocked(api.getPatterns).mockResolvedValue(tradingFixture().patterns); vi.mocked(api.getDiagnoses).mockResolvedValue(tradingFixture().strategy_execution);
  vi.mocked(api.listExperiments).mockResolvedValue([experimentFixture(1), experimentFixture(2)]);
  vi.mocked(api.getExperiment).mockImplementation(async id => experimentFixture(id));
  vi.mocked(api.measureExperiment).mockResolvedValue(measurement());
});
afterEach(() => { onlineManager.setOnline(true); cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

it('renders populated Review sections, comparison, sample quality and separate unavailable market evidence', () => {
  setup(<ReviewSections data={tradingFixture()} />);
  for (const label of ['Performance','Strategy','Psychology — recorded states','Evidence quality','Previous equal-length period']) expect(screen.getByRole('heading', { name: label })).toBeTruthy();
  expect(screen.getByText('Current 2 · Previous 1 · Delta 1')).toBeTruthy();
  expect(screen.getAllByText(/7 evaluable · 3 unavailable/).length).toBeGreaterThan(0);
  for (const metric of ['mfe_capture_efficiency','plan_exit_adherence','post_exit_opportunity']) expect(screen.getByRole('heading', { name: metric })).toBeTruthy();
  expect(screen.getAllByText(/MARKET_PATH_NOT_IN_SNAPSHOT/).length).toBe(3);
});
it('renders an empty Review period neutrally', () => { setup(<ReviewSections data={{ ...tradingFixture(), state: 'EMPTY_PERIOD' }} />); expect(screen.getByRole('status').textContent).toContain('Empty period'); });
it.each(['ELIGIBLE','INSUFFICIENT_EVIDENCE'] as const)('shows backend pattern state %s, order, baseline/delta without a confidence score', status => {
  const second = { ...patternFixture(status), metric: 'net_return_pct' }; setup(<PatternFindings items={[patternFixture(status), second]} onExperiment={vi.fn()} />);
  expect(screen.getAllByRole('article')[0].textContent).toContain('average_r');
  expect(screen.getAllByText(/Observed 1e-9 · Baseline 1 · Delta -0.999999999/)).toHaveLength(2);
  expect(screen.queryByText(/confidence|statistically significant|proven edge/i)).toBeNull();
  expect(screen.getAllByText(status === 'ELIGIBLE' ? 'Eligible evidence' : 'Insufficient evidence')).toHaveLength(2);
});
it.each(['STRATEGY_POSITIVE_EXECUTION_HEALTHY','STRATEGY_POSITIVE_EXECUTION_DRAG','STRATEGY_WEAK_EXECUTION_HEALTHY','STRATEGY_WEAK_EXECUTION_DRAG','INCONCLUSIVE'] as Classification[])('shows %s with separate axes and only backend execution subset', classification => {
  setup(<DiagnosisCards items={[diagnosisFixture(classification)]} onExperiment={vi.fn()} />);
  const execution = screen.getByRole('region', { name: 'Execution axis' });
  expect(execution.textContent).toContain('Diagnosis execution-rule adherence: 100%');
  expect(execution.textContent).toContain('10 eligible · 8 evaluable · 10 excluded / 20 total');
  expect(within(execution).queryByText('R outcomes')).toBeNull();
  expect(screen.getByRole('region', { name: 'Strategy axis' }).textContent).toContain('R outcomes');
  if (classification === 'INCONCLUSIVE') expect(screen.getByText(/Inconclusive —/)).toBeTruthy();
});
it('keeps global adherence distinct from execution-rule evidence', () => {
  setup(<><ReviewSections data={tradingFixture()} /><DiagnosisCards items={[diagnosisFixture()]} onExperiment={vi.fn()} /></>);
  expect(screen.getByText('Global adherence (percent)')).toBeTruthy(); expect(screen.getByText('50')).toBeTruthy();
  expect(screen.getByText(/Diagnosis execution-rule adherence: 100%/)).toBeTruthy();
});
it('queries all official Review endpoints and excludes comparison on dedicated endpoints through API client contract', async () => {
  setup(<ReviewWorkspace metadata={reviewDiscovery()} onExperiment={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Compare immediately preceding equal-length period')); fireEvent.click(screen.getByText('Run review'));
  await screen.findByRole('region', { name: 'Pattern findings' });
  expect(api.getReview).toHaveBeenCalledWith(expect.objectContaining({ compare_previous: true }), expect.any(AbortSignal));
  expect(api.getPatterns).toHaveBeenCalledTimes(1); expect(api.getDiagnoses).toHaveBeenCalledTimes(1);
});
it('period A resolving after B cannot replace newer Review', async () => {
  const a = deferred<TradingReview>(); vi.mocked(api.getReview).mockReturnValueOnce(a.promise).mockResolvedValueOnce({ ...tradingFixture(), state: 'EMPTY_PERIOD' });
  setup(<ReviewWorkspace metadata={reviewDiscovery()} onExperiment={vi.fn()} />);
  fireEvent.click(screen.getByText('Run review')); await screen.findByRole('region', { name: 'Pattern findings' });
  fireEvent.change(screen.getByLabelText('End time *'), { target: { value: '2026-01-31T23:59:59.999' } });
  fireEvent.change(screen.getByLabelText('Start time *'), { target: { value: '2026-01-01T00:00:00.000' } });
  fireEvent.click(screen.getByText('Run review')); await screen.findByText(/Empty period —/);
  await act(async () => a.resolve(tradingFixture())); expect(screen.getByText(/Empty period —/)).toBeTruthy();
});
it('Review finding handoff prefills factual context without saving or creating a recommendation', async () => {
  setup(<AnalyticsWorkspace overview={<p>Overview</p>} />); fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByText('Run review')); fireEvent.click(await screen.findByText('Create experiment from finding'));
  expect(await screen.findByRole('heading', { name: 'New experiment draft' })).toBeTruthy();
  expect((screen.getByLabelText('Measurement dimension') as HTMLSelectElement).value).toBe('fomo');
  expect((screen.getByLabelText('Hypothesis') as HTMLInputElement).value).toBe(''); expect(api.createExperiment).not.toHaveBeenCalled();
});
it('handoff preserves exact strategy/version IDs and never edits the original filters', () => {
  const request = { filters, compare_previous: false }; const seed = findingSeed(request, 'average_r', 'strategy_version', diagnosisFixture().identity);
  expect(seed.query.filters.strategy_version_ids).toEqual([42]); expect(seed.query.filters.strategy_ids).toEqual([7]);
  expect(seed.baseline).toEqual(filters); expect(request.filters).toEqual(filters);
});
it('creates a draft only on explicit save and sends bounded official definition', async () => {
  vi.mocked(api.createExperiment).mockResolvedValue(experimentFixture());
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} seed={experimentFixture().definition} onDirtyChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test experiment' } }); fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'Observe recorded differences' } });
  expect(api.createExperiment).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Create draft'));
  await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  expect(api.createExperiment).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test experiment', query: expect.objectContaining({ metric: 'average_r' }) }));
});
it('same-item reselection is a no-op and preserves the parent dirty guard', async () => {
  const confirm = vi.mocked(window.confirm).mockReturnValue(false);
  setup(<AnalyticsWorkspace overview={<p>Overview</p>} />); fireEvent.click(await screen.findByRole('button', { name: 'Experiments' }));
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: /Experiment 1/ }));
  expect(confirm).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Unsaved draft');
  expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(1); expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(2); expect(await screen.findByRole('heading', { name: 'Trading Review 2.0' })).toBeTruthy();
});
it('dirty A keeps editing on cancel, but switches cleanly to B after discard confirmation', async () => {
  const confirm = vi.mocked(window.confirm).mockReturnValue(false);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A local draft' } });
  fireEvent.click(screen.getByRole('button', { name: /Experiment 2/ }));
  expect(confirm).toHaveBeenCalledTimes(1); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('A local draft');
  expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: /Experiment 2/ }));
  expect(await screen.findByRole('heading', { name: 'Experiment 2 · DRAFT' })).toBeTruthy();
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Experiment 2');
  expect(screen.queryByText('Unsaved experiment changes')).toBeNull();
});
it('clean same-item reselection is harmless and save outcomes retain correct dirty state', async () => {
  const confirm = vi.mocked(window.confirm);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: /Experiment 1/ })); expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Failed save draft' } });
  vi.mocked(api.updateExperiment).mockRejectedValueOnce(new Error('Save failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); await screen.findByRole('alert');
  expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  const saved = { ...experimentFixture(), revision: 2, definition: { ...experimentFixture().definition, name: 'Saved draft' } };
  vi.mocked(api.updateExperiment).mockResolvedValueOnce(saved);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByRole('heading', { name: 'Saved draft · DRAFT' }); expect(screen.queryByText('Unsaved experiment changes')).toBeNull();
});
it('paused and failed Reload keep the exact draft and navigation guard, while a successful Reload synchronizes the revision', async () => {
  const confirm = vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true);
  setup(<AnalyticsWorkspace overview={<p>Overview</p>} />); fireEvent.click(await screen.findByRole('button', { name: 'Experiments' }));
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Offline draft' } }); onlineManager.setOnline(false);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
  await waitFor(() => {
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Offline draft');
    expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Offline draft again' } }); fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(2); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Offline draft again');
  onlineManager.setOnline(true); vi.mocked(api.getExperiment).mockRejectedValueOnce(new Error('Reload failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' })); await screen.findByRole('alert');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Offline draft again'); expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(4); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Offline draft again');
  const saved = { ...experimentFixture(), revision: 2, definition: { ...experimentFixture().definition, name: 'Reloaded saved draft' } };
  vi.mocked(api.getExperiment).mockResolvedValueOnce(saved); fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
  await screen.findByRole('heading', { name: 'Reloaded saved draft · DRAFT' }); await waitFor(() => expect(screen.queryByText('Unsaved experiment changes')).toBeNull());
  const confirmationsBeforeNavigation = confirm.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Review' })); expect(confirm).toHaveBeenCalledTimes(confirmationsBeforeNavigation); expect(await screen.findByRole('heading', { name: 'Trading Review 2.0' })).toBeTruthy();
});
it('delayed Reload failure preserves the latest draft, error, revision, and navigation guard', async () => {
  let rejectReload!: (reason?: unknown) => void;
  const reload = new Promise<Experiment>((_resolve, reject) => { rejectReload = reject; });
  const confirm = vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValue(false);
  vi.mocked(api.getExperiment).mockImplementationOnce(async () => experimentFixture(1)).mockImplementationOnce(() => reload);
  setup(<AnalyticsWorkspace overview={<p>Overview</p>} />); fireEvent.click(await screen.findByRole('button', { name: 'Experiments' }));
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft before failure' } }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
  await screen.findByText('Loading selected experiment…'); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Latest draft after pending edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(2); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Latest draft after pending edit');
  await act(async () => rejectReload(new Error('Delayed Reload failed'))); await screen.findByRole('alert');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Latest draft after pending edit'); expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(confirm).toHaveBeenCalledTimes(3); expect(screen.queryByRole('heading', { name: 'Trading Review 2.0' })).toBeNull();
});
it('successful Reload intentionally replaces edits made while pending with the authoritative revision', async () => {
  const reload = deferred<Experiment>();
  vi.mocked(api.getExperiment).mockImplementationOnce(async () => experimentFixture(1)).mockImplementationOnce(() => reload.promise);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft before pending Reload' } }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
  await screen.findByText('Loading selected experiment…'); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edit made while Reload pending' } });
  await act(async () => reload.resolve({ ...experimentFixture(1), revision: 2, definition: { ...experimentFixture(1).definition, name: 'Authoritative revision 2' } }));
  await screen.findByRole('heading', { name: 'Authoritative revision 2 · DRAFT' });
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Authoritative revision 2'); await waitFor(() => expect(screen.queryByText('Unsaved experiment changes')).toBeNull());
});
it('a successful Save keeps its cache and editor revision when an older Reload later succeeds or fails', async () => {
  for (const outcome of ['success', 'failure'] as const) {
    const reload = deferred<Experiment>();
    vi.mocked(api.getExperiment).mockImplementationOnce(async () => experimentFixture(1)).mockImplementationOnce(() => reload.promise);
    const saved = { ...experimentFixture(1), revision: 2, definition: { ...experimentFixture(1).definition, name: `Saved revision 2 ${outcome}` } };
    vi.mocked(api.updateExperiment).mockResolvedValueOnce(saved);
    const view = setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: saved.definition.name } }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
    await screen.findByText('Loading selected experiment…'); fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('heading', { name: `${saved.definition.name} · DRAFT` });
    if (outcome === 'success') await act(async () => reload.resolve(experimentFixture(1))); else await act(async () => reload.reject(new Error('Older Reload failed')));
    await waitFor(() => expect((view.client.getQueryData(['experiments', 'detail', 1]) as Experiment).revision).toBe(2));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(saved.definition.name); expect(screen.queryByText('Unsaved experiment changes')).toBeNull();
    view.unmount();
  }
});
it('a Save started after Reload wins even when the old Reload settles first', async () => {
  const reload = deferred<Experiment>(), save = deferred<Experiment>();
  vi.mocked(api.getExperiment).mockImplementationOnce(async () => experimentFixture(1)).mockImplementationOnce(() => reload.promise);
  const saved = { ...experimentFixture(1), revision: 2, definition: { ...experimentFixture(1).definition, name: 'Save settled last' } };
  vi.mocked(api.updateExperiment).mockImplementationOnce(() => save.promise);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: saved.definition.name } }); fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' }));
  await screen.findByText('Loading selected experiment…'); fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await act(async () => reload.resolve(experimentFixture(1))); expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(saved.definition.name);
  await act(async () => save.resolve(saved)); await screen.findByRole('heading', { name: 'Save settled last · DRAFT' });
  expect(screen.queryByText('Unsaved experiment changes')).toBeNull();
});
it('a lifecycle mutation keeps its newer revision when an older Reload settles later', async () => {
  const reload = deferred<Experiment>();
  vi.mocked(api.getExperiment).mockImplementationOnce(async () => experimentFixture(1)).mockImplementationOnce(() => reload.promise);
  const active = { ...experimentFixture(1, 'ACTIVE'), revision: 2 };
  vi.mocked(api.transitionExperiment).mockResolvedValueOnce(active);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' })); await screen.findByText('Loading selected experiment…'); fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }));
  await screen.findByRole('heading', { name: 'Experiment 1 · ACTIVE' }); await act(async () => reload.resolve(experimentFixture(1)));
  expect(screen.getByRole('heading', { name: 'Experiment 1 · ACTIVE' })).toBeTruthy();
});
it('a late Reload response for A cannot reset selected or dirty B', async () => {
  const reload = deferred<Experiment>();
  let aRequests = 0;
  vi.mocked(api.getExperiment).mockImplementation(async id => id === 1 ? (aRequests++ === 0 ? experimentFixture(1) : reload.promise) : experimentFixture(2));
  const confirm = vi.mocked(window.confirm).mockReturnValue(false);
  setup(<AnalyticsWorkspace overview={<p>Overview</p>} />); fireEvent.click(await screen.findByRole('button', { name: 'Experiments' }));
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' })); await screen.findByText('Loading selected experiment…'); fireEvent.click(screen.getByRole('button', { name: /Experiment 2/ }));
  await screen.findByRole('heading', { name: 'Experiment 2 · DRAFT' }); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dirty B draft' } });
  await act(async () => reload.resolve({ ...experimentFixture(1), revision: 2, definition: { ...experimentFixture(1).definition, name: 'Late A' } }));
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dirty B draft'); expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review' })); expect(confirm).toHaveBeenCalledTimes(1);
});
it('a pending Save and older Reload for A cannot affect B after a confirmed switch', async () => {
  const reload = deferred<Experiment>(), save = deferred<Experiment>();
  let aRequests = 0;
  vi.mocked(api.getExperiment).mockImplementation(async id => id === 1 ? (aRequests++ === 0 ? experimentFixture(1) : reload.promise) : experimentFixture(2));
  vi.mocked(api.updateExperiment).mockImplementationOnce(() => save.promise);
  vi.mocked(window.confirm).mockReturnValue(true);
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); await screen.findByRole('heading', { name: 'Experiment 1 · DRAFT' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved experiment' })); await screen.findByText('Loading selected experiment…');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Save A while Reload pending' } }); fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.click(screen.getByRole('button', { name: /Experiment 2/ })); await screen.findByRole('heading', { name: 'Experiment 2 · DRAFT' });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dirty B remains selected' } });
  await act(async () => { save.resolve({ ...experimentFixture(1), revision: 2, definition: { ...experimentFixture(1).definition, name: 'Saved A' } }); reload.resolve(experimentFixture(1)); });
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dirty B remains selected'); expect(screen.getByText('Unsaved experiment changes')).toBeTruthy();
});
it('experiment A response resolving after B never hydrates B', async () => {
  const a = deferred<Experiment>(); vi.mocked(api.getExperiment).mockImplementation(id => id === 1 ? a.promise : Promise.resolve(experimentFixture(2)));
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ })); fireEvent.click(screen.getByRole('button', { name: /Experiment 2/ }));
  await screen.findByRole('heading', { name: 'Experiment 2 · DRAFT' }); await act(async () => a.resolve(experimentFixture(1)));
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Experiment 2');
});
it.each([['DRAFT','Start experiment','ACTIVE'],['ACTIVE','Complete experiment','COMPLETED'],['ACTIVE','Cancel experiment','CANCELLED']] as const)('transitions %s through explicit %s action', async (status, label, next) => {
  vi.mocked(api.getExperiment).mockResolvedValue(experimentFixture(1,status)); vi.mocked(api.transitionExperiment).mockResolvedValue({ ...experimentFixture(1,next), revision: 2 });
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ }));
  fireEvent.click(await screen.findByText(label)); await screen.findByRole('heading', { name: `Experiment 1 · ${next}` });
  expect(api.transitionExperiment).toHaveBeenCalledWith(1,1,next);
});
it.each(['MET','NOT_MET','NOT_EVALUABLE'] as const)('renders server criterion %s and unavailable evidence without calculating locally', state => {
  setup(<MeasurementView data={measurement(state)} />); expect(screen.getByText(/Current 1e-9 · Baseline Unavailable · Observed delta Unavailable/)).toBeTruthy();
  expect(screen.getByText(/BASELINE_UNAVAILABLE/)).toBeTruthy();
});
it('Measure is explicit and selected experiment response stays isolated', async () => {
  vi.mocked(api.getExperiment).mockResolvedValue(experimentFixture(1,'ACTIVE'));
  setup(<ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: /Experiment 1/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Measure' })); await screen.findByRole('region', { name: 'Experiment measurement' });
  expect(api.measureExperiment).toHaveBeenCalledWith(1, expect.any(AbortSignal));
});
function NavigateAway() { const navigate = useNavigate(); return <button onClick={() => navigate('/journal')}>Leave route</button>; }
it('router obeys dirty experiment navigation veto', async () => {
  window.history.replaceState(null, '', '/trade-analysis'); vi.mocked(window.confirm).mockReturnValue(false);
  setup(<BrowserRouter><NavigateAway /><ExperimentsWorkspace metadata={reviewDiscovery()} onDirtyChange={vi.fn()} /></BrowserRouter>);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } }); fireEvent.click(screen.getByText('Leave route'));
  expect(window.location.pathname).toBe('/trade-analysis');
});
