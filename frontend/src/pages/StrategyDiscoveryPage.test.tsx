// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as discovery from '../api/strategyDiscovery';
import { getRuleEngineMetadata } from '../api/ruleEngine';
import { BrowserRouter } from '../router';
import { useNavigate } from '../router-context';
import { useStore } from '../store/useStore';
import { setWorkspace } from '../features/onboarding/workspaceSession';
import type { AnalyticsGroup } from '../types/analytics';
import type { RuleEngineMetadata } from '../types';
import type { CandidateAdoption, DiscoveryMetadata, DiscoveryRunDetail, DiscoverySegment, StrategyCandidate } from '../types/strategyDiscovery';
import StrategyDiscoveryPage from './StrategyDiscoveryPage';

vi.mock('../api/strategyDiscovery', () => ({ getDiscoveryMetadata: vi.fn(), listDiscoveryRuns: vi.fn(), getDiscoveryRun: vi.fn(),
  getDiscoveryCandidate: vi.fn(), getDiscoveryEvidence: vi.fn(), createDiscoveryRun: vi.fn(), adoptDiscoveryCandidate: vi.fn() }));
vi.mock('../api/ruleEngine', () => ({ getRuleEngineMetadata: vi.fn() }));

const metadata: DiscoveryMetadata = { engine_version: 1, policy_version: 1, features: ['symbol', 'direction'],
  primary_metrics: ['average_return_pct', 'average_r'], metrics: ['average_return_pct', 'average_r', 'win_rate_pct', 'profit_factor'],
  discovery_pct: 70, minimum_sample_per_segment: 5, minimum_coverage_pct: 80, max_trades: 2000, max_symbols: 32,
  max_candidates: 64, max_conditions: 2, time_basis: 'UTC', evidence_semantics: 'OBSERVED_ASSOCIATION',
  profit_factor_reason: 'PNL_CURRENCY_UNVERIFIED', ranking_basis: 'Discovery only' };
const rules: RuleEngineMetadata = { registry_version: 1, metrics: [{ metric_id: 'trade.symbol', label: 'Symbol', value_type: 'string', unit: null,
  lifecycle: 'ENTRY', allowed_operators: ['eq', 'in'], constraints: { enum_values: [], minimum: null, maximum: null,
    max_in_values: 50, max_string_length: 80, string_format: 'uppercase_alphanumeric' } },
  { metric_id: 'trade.direction', label: 'Direction', value_type: 'enum', unit: null, lifecycle: 'ENTRY',
    allowed_operators: ['eq', 'in'], constraints: { enum_values: ['Long', 'Short'], minimum: null, maximum: null,
      max_in_values: 2, max_string_length: null, string_format: null } }] };
function group(value: number | null): AnalyticsGroup {
  return { identity: { key: 'all', label: 'All', state: 'ALL', strategy_id: null, strategy_version_id: null, rule_id: null, rule_category: null },
    value, total_sample: 10, evaluable_sample: value === null ? 0 : 10, unavailable_sample: value === null ? 10 : 0,
    trade_sample: 10, unassigned_trade_count: 10, assigned_without_rules_count: 0, unavailable_reason: value === null ? 'NO_EVALUABLE_SAMPLE' : null,
    unavailable_reasons: {}, profit_factor_infinite: false, evidence_semantics: 'OBSERVED_ASSOCIATION' };
}
function segment(): DiscoverySegment {
  const metrics = { average_return_pct: group(4), average_r: group(null), win_rate_pct: group(70), profit_factor: group(null) };
  return { sample: 10, metrics, baseline: metrics, primary_delta: '2', trade_ids: [1, 2] };
}
function candidate(id = 1): StrategyCandidate {
  return { id, run_id: id, rank: 1, name: 'BTCUSDT', conditions: [{ field: 'symbol', value: 'BTCUSDT' }],
    rules: { schema_version: 2, entry_rules: [{ id: 'discovery-symbol', text: 'Symbol = BTCUSDT', evaluation: { metric_id: 'trade.symbol', operator: 'eq', expected: 'BTCUSDT' } }], risk_rules: [], exit_rules: [] },
    discovery: segment(), validation: segment(), validation_state: 'CONSISTENT',
    reasons: ['PNL_CURRENCY_UNVERIFIED', 'RISK_AND_EXIT_RULES_NOT_GENERATED'], adoption: null };
}
function run(id = 1): DiscoveryRunDetail {
  return { id, request: { start_time: 1767225600000, end_time: 1769903999999, symbols: null, directions: null, primary_metric: 'average_return_pct' },
    engine_version: 1, policy_version: 1, input_fingerprint: 'frozen-hash', created_at: '2026-10-26T00:00:00Z',
    summary: { selected_trades: 30, discovery_trades: 20, validation_trades: 10, excluded: { CROSSES_SPLIT: 1 },
      split_time: 1769100479999, searched_conditions: 8, shortlisted_candidates: 1, candidate_count: 1, state: 'AVAILABLE',
      baseline_discovery: segment().metrics, baseline_validation: segment().metrics }, candidates: [candidate(id)] };
}
const adopted: CandidateAdoption = { strategy_id: 42, version_id: 420, rules_modified: false,
  evidence_applies_to_saved_rules: true, saved_rules_fingerprint: 'rules-hash', created_at: '2026-10-26T00:00:00Z' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/strategy-discovery?run=2&candidate=2')}>Switch run</button>;
}
const clients: QueryClient[] = [];
function setup(path = '/strategy-discovery') {
  window.history.replaceState(null, '', path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return { client, ...render(<QueryClientProvider client={client}><BrowserRouter><Navigation /><StrategyDiscoveryPage /></BrowserRouter></QueryClientProvider>) };
}
beforeEach(() => {
  vi.resetAllMocks();
  useStore.setState({ language: 'en' }); setWorkspace(null);
  vi.mocked(discovery.getDiscoveryMetadata).mockResolvedValue(metadata);
  vi.mocked(discovery.listDiscoveryRuns).mockResolvedValue({ items: [run()], offset: 0, has_more: false });
  vi.mocked(discovery.getDiscoveryRun).mockImplementation(async id => run(id));
  vi.mocked(discovery.getDiscoveryCandidate).mockImplementation(async id => candidate(id));
  vi.mocked(discovery.createDiscoveryRun).mockResolvedValue(run());
  vi.mocked(discovery.getDiscoveryEvidence).mockResolvedValue({ items: [{ journal_id: 1, external_id: 'source-1',
    symbol: 'BTCUSDT', direction: 'Long', datetime: '2026-01-02T01:00:00Z', entry_datetime: '2026-01-02T00:00:00Z',
    average_return_pct: -123456789.12345, realized_r: null, segment: 'DISCOVERY' }], offset: 0, has_more: false });
  vi.mocked(getRuleEngineMetadata).mockResolvedValue(rules);
  vi.mocked(discovery.adoptDiscoveryCandidate).mockResolvedValue(adopted);
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; setWorkspace(null); vi.restoreAllMocks(); });

it('loads settings and history without starting analysis; supports KO and recorded sample dates', async () => {
  useStore.setState({ language: 'ko' });
  setWorkspace({ mode: 'sample', profile_id: 'sample:test', first_run: false, trade_count: 36, return_url: null,
    period: { start: '2026-01-01', end: '2026-01-31' }, credential_backend: 'disabled', fixture_version: 1 });
  setup();
  expect(await screen.findByRole('button', { name: '전략 후보 찾기' })).toBeTruthy();
  expect((screen.getByLabelText('시작일 · UTC') as HTMLInputElement).value).toBe('2026-01-01');
  expect(discovery.createDiscoveryRun).not.toHaveBeenCalled();
  expect(discovery.getDiscoveryRun).not.toHaveBeenCalled();
});

it('runs only on explicit submit, persists URL selection and loads frozen evidence lazily', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Find strategy candidates' }));
  await screen.findByRole('button', { name: 'Review draft' });
  expect(discovery.createDiscoveryRun).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('?run=1&candidate=1');
  expect(discovery.getDiscoveryEvidence).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View evidence trades' }));
  expect(await screen.findByText('-123456789.12%')).toBeTruthy();
  expect(screen.getByText(/Values frozen at analysis time/)).toBeTruthy();
});

it('reuses the idempotency key after response loss and rejects invalid period locally', async () => {
  vi.mocked(discovery.createDiscoveryRun).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce(run());
  setup();
  const button = await screen.findByRole('button', { name: 'Find strategy candidates' });
  fireEvent.click(button);
  await screen.findByText(/The analysis request did not complete/);
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Review draft' });
  const calls = vi.mocked(discovery.createDiscoveryRun).mock.calls;
  expect(calls[0][1]).toBe(calls[1][1]);
  fireEvent.change(screen.getByLabelText('From · UTC'), { target: { value: '2099-01-01' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Discovery filters' }));
  expect(await screen.findByText('Check the start and end dates.')).toBeTruthy();
  expect(discovery.createDiscoveryRun).toHaveBeenCalledTimes(2);
});

it('does not replace a newer selection when an older analysis finishes', async () => {
  const pending = deferred<DiscoveryRunDetail>();
  vi.mocked(discovery.createDiscoveryRun).mockReturnValue(pending.promise);
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Find strategy candidates' }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch run' }));
  await screen.findByRole('button', { name: 'Review draft' });
  await act(async () => pending.resolve(run(1)));
  await waitFor(() => expect(window.location.search).toBe('?run=2&candidate=2'));
});

it('preserves editable draft after save failure and registers once with the same retry key', async () => {
  vi.mocked(discovery.getDiscoveryCandidate).mockResolvedValueOnce(candidate()).mockResolvedValue({ ...candidate(), adoption: adopted });
  vi.mocked(discovery.adoptDiscoveryCandidate).mockRejectedValueOnce(new Error('Registration response lost')).mockResolvedValueOnce(adopted);
  setup('/strategy-discovery?run=1&candidate=1');
  fireEvent.click(await screen.findByRole('button', { name: 'Review draft' }));
  const dialog = await screen.findByRole('dialog', { name: 'Review and register candidate' });
  const name = within(dialog).getByLabelText('Strategy name') as HTMLInputElement;
  expect(name.value).toBe('BTCUSDT');
  fireEvent.change(name, { target: { value: 'Reviewed BTC' } });
  const save = within(dialog).getByRole('button', { name: 'Register in Playbook' });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await screen.findByText('Registration response lost');
  expect(name.value).toBe('Reviewed BTC');
  fireEvent.click(save);
  await screen.findByText('Registered in Playbook with the original evaluated rules.');
  expect(discovery.adoptDiscoveryCandidate).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(discovery.adoptDiscoveryCandidate).mock.calls;
  expect(calls[0][2]).toBe(calls[1][2]);
  expect(calls[1][1].initial_version.rules.entry_rules[0].evaluation?.metric_id).toBe('trade.symbol');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Playbook' }));
  expect(window.location.pathname + window.location.search).toBe('/playbook?strategy=42');
});

it('keeps the editor on dirty navigation rejection and clears it after an approved switch', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  setup('/strategy-discovery?run=1&candidate=1');
  fireEvent.click(await screen.findByRole('button', { name: 'Review draft' }));
  fireEvent.change(await screen.findByLabelText('Strategy name'), { target: { value: 'Unsaved candidate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Switch run' }));
  expect(confirm).toHaveBeenCalled();
  expect(window.location.search).toBe('?run=1&candidate=1');
  expect(screen.getByRole('dialog')).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Switch run' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((screen.getByRole('button', { name: 'Find strategy candidates' }) as HTMLButtonElement).disabled).toBe(false);
});

it('blocks Escape, navigation and duplicate registration while saving', async () => {
  const pending = deferred<CandidateAdoption>();
  vi.mocked(discovery.adoptDiscoveryCandidate).mockReturnValue(pending.promise);
  setup('/strategy-discovery?run=1&candidate=1');
  fireEvent.click(await screen.findByRole('button', { name: 'Review draft' }));
  const save = await screen.findByRole('button', { name: 'Register in Playbook' });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(screen.getByLabelText('Strategy name').matches(':disabled')).toBe(true));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Switch run' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(window.location.search).toBe('?run=1&candidate=1');
  expect(discovery.adoptDiscoveryCandidate).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(adopted));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows empty or insufficient results without inventing candidates or adopting anything', async () => {
  const empty = run(); empty.candidates = []; empty.summary.candidate_count = 0; empty.summary.state = 'INSUFFICIENT_EVIDENCE';
  vi.mocked(discovery.getDiscoveryRun).mockResolvedValue(empty);
  setup('/strategy-discovery?run=1');
  expect(await screen.findByText(/Insufficient discovery sample/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Review draft' })).toBeNull();
  expect(discovery.adoptDiscoveryCandidate).not.toHaveBeenCalled();
});

it('does not display a candidate outside the selected run and provides settings retry', async () => {
  vi.mocked(discovery.getDiscoveryMetadata).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(metadata);
  setup('/strategy-discovery?run=1&candidate=999');
  expect(await screen.findByText(/does not belong to this run/)).toBeTruthy();
  expect(discovery.getDiscoveryCandidate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Find strategy candidates' })).toBeTruthy();
});

it('preserves analysis-scope membership and discovered direction through the shared editor', async () => {
  const scoped = candidate();
  scoped.conditions = [{ field: 'symbol', operator: 'in', value: ['BTCUSDT', 'ETHUSDT'] }, { field: 'direction', operator: 'eq', value: 'Long' }];
  scoped.rules.entry_rules[0].evaluation = { metric_id: 'trade.symbol', operator: 'in', expected: ['BTCUSDT', 'ETHUSDT'] };
  scoped.rules.entry_rules.push({ id: 'discovery-direction', text: 'Direction eq Long', evaluation: { metric_id: 'trade.direction', operator: 'eq', expected: 'Long' } });
  vi.mocked(discovery.getDiscoveryCandidate).mockResolvedValue(scoped);
  setup('/strategy-discovery?run=1&candidate=1');
  fireEvent.click(await screen.findByText('Generated entry rules'));
  expect(screen.getByText('Symbol in: BTCUSDT, ETHUSDT')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));
  const expected = await screen.findByLabelText('Entry rules 1 expected values');
  expect((expected as HTMLInputElement).value).toBe('BTCUSDT, ETHUSDT');
  const save = screen.getByRole('button', { name: 'Register in Playbook' });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(discovery.adoptDiscoveryCandidate).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(discovery.adoptDiscoveryCandidate).mock.calls[0][1].initial_version.rules.entry_rules;
  expect(saved.map(rule => rule.evaluation?.expected)).toEqual([['BTCUSDT', 'ETHUSDT'], 'Long']);
});
