// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalyticsMetadata, queryAnalytics } from '../../api/analytics';
import { useStore } from '../../store/useStore';
import type { AnalyticsMetadata, AnalyticsResult } from '../../types/analytics';
import AnalyticsWorkspace from './AnalyticsWorkspace';
import { GuidedAnswer } from './GuidedAnalytics';
import { dimension, filter, group, metadataFixture, resultFixture } from './analyticsTestFixtures';

vi.mock('../../api/analytics', () => ({ getAnalyticsMetadata: vi.fn(), queryAnalytics: vi.fn() }));
vi.mock('../../api/strategies', () => ({ listStrategies: vi.fn().mockResolvedValue([]), listStrategyVersions: vi.fn().mockResolvedValue([]) }));

function supportedMetadata(): AnalyticsMetadata {
  const metadata = metadataFixture();
  metadata.dimensions.push(dimension('setup'), dimension('symbol'), dimension('direction'));
  metadata.dimensions.find(d => d.id === 'setup')!.multi_membership = true;
  metadata.metrics = [
    ...['average_return_pct', 'average_r', 'win_rate_pct'].map(id => ({ ...metadata.metrics[0], id, label: id, unit: id === 'average_r' ? 'R' : 'percent', supported_dimensions: metadata.dimensions.filter(d => d.category !== 'rule').map(d => d.id) })),
    ...['adherence_pct', 'coverage_pct'].map(id => ({ ...metadata.metrics[1], id, label: id })),
  ];
  metadata.filters.push(filter('directions', { enum_values: ['Long', 'Short'] }), filter('setups', { value_type: 'text', enum_values: [] }));
  return metadata;
}
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><AnalyticsWorkspace overview={<p>Existing overview</p>} /></QueryClientProvider>);
}
function resultFor(metric = 'average_return_pct', dimensionId = 'strategy', overrides: Partial<AnalyticsResult> = {}) {
  const metadata = supportedMetadata();
  return resultFixture({ metric: metadata.metrics.find(m => m.id === metric)!, dimension: metadata.dimensions.find(d => d.id === dimensionId)!, ...overrides });
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); useStore.setState({ language: 'en' });
  vi.mocked(getAnalyticsMetadata).mockResolvedValue(supportedMetadata());
  vi.mocked(queryAnalytics).mockImplementation(async request => resultFor(request.metric, request.dimension));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); });

const cases = [
  ['How did results differ across strategies?', 'average_return_pct', 'strategy'],
  ['How did results differ across setups?', 'average_return_pct', 'setup'],
  ['Did results differ with my confidence?', 'average_return_pct', 'confidence_score'],
  ['How did Long and Short trades differ?', 'average_return_pct', 'direction'],
  ['How did results differ across symbols?', 'average_return_pct', 'symbol'],
  ['How have my weekly results changed?', 'average_return_pct', 'week'],
  ['Did results differ by closing weekday?', 'average_return_pct', 'weekday'],
  ['How consistently did I follow each strategy’s rules?', 'adherence_pct', 'strategy'],
] as const;
async function choose(title: string) {
  const cards = await screen.findByRole('region', { name: 'Analysis questions' });
  const details = within(cards).queryByText('Choose another question · start fresh with 90 days');
  if (details) fireEvent.click(details);
  await userEvent.click(within(cards).getByRole('button', { name: new RegExp(title.replace(/[?]/g, '\\?')) }));
}

describe('Guided analytics query ownership', () => {
  it('starts with guided questions even when an advanced draft is stored', async () => {
    sessionStorage.setItem('analytics-workspace-v1', JSON.stringify({ section: 'Rules', draft: { metric: 'adherence_pct', dimension: 'all', filters: {} } }));
    setup();
    expect((await screen.findByRole('button', { name: 'Guided analytics' })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'What would you like to learn about your trading?' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Metric' })).toBeNull();
    expect(queryAnalytics).not.toHaveBeenCalled();
  });
  it.each(cases)('maps %s to the supported query', async (title, metric, dimensionId) => {
    setup(); await choose(title);
    await screen.findByRole('region', { name: 'Answer summary' });
    const request = vi.mocked(queryAnalytics).mock.calls[0][0];
    expect(request).toEqual({ metric, dimension: dimensionId, filters: { start_time: expect.any(Number), end_time: expect.any(Number) } });
    expect(Number(request.filters.end_time) - Number(request.filters.start_time)).toBe(90 * 86400000);
  });
  it('omits questions if the server does not support the exact combination', async () => {
    const metadata = supportedMetadata();
    metadata.metrics[0].supported_dimensions = ['symbol'];
    metadata.metrics = [metadata.metrics[0]];
    vi.mocked(getAnalyticsMetadata).mockResolvedValue(metadata); setup();
    const region = await screen.findByRole('region', { name: 'Analysis questions' });
    expect(within(region).getAllByRole('button')).toHaveLength(1);
    expect(within(region).getByRole('button', { name: /How did results differ across symbols/ })).toBeTruthy();
  });
  it('keeps filters and submission when opening Advanced, but starts another question fresh', async () => {
    const user = userEvent.setup(); setup(); await choose(cases[0][0]);
    await screen.findByRole('region', { name: 'Answer summary' });
    await user.click(screen.getByText('Adjust period and filters'));
    await user.click(screen.getByText('Optional filters'));
    await user.type(screen.getByLabelText('symbols'), 'ETH/USDT');
    await user.selectOptions(screen.getByLabelText('directions'), 'Short');
    fireEvent.change(screen.getByLabelText('Start time *'), { target: { value: '2026-01-01T00:00' } });
    expect(screen.queryByRole('region', { name: 'Answer summary' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByRole('region', { name: 'Answer summary' });
    expect(queryAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ symbols: ['ETH/USDT'], directions: ['Short'], start_time: Date.parse('2026-01-01T00:00:00Z') }) }), expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Open current query in Advanced' }));
    expect((screen.getByLabelText('Metric') as HTMLSelectElement).value).toBe('average_return_pct');
    expect((screen.getByLabelText('Dimension') as HTMLSelectElement).value).toBe('strategy');
    expect(screen.getByRole('region', { name: 'Analysis result' })).toBeTruthy();
    expect(queryAnalytics).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Guided analytics' }));
    await choose(cases[3][0]);
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledTimes(3));
    expect(vi.mocked(queryAnalytics).mock.calls[2][0].filters).toEqual({ start_time: expect.any(Number), end_time: expect.any(Number) });
  });
  it('does not let an unresolved old question overwrite the newer answer', async () => {
    let resolveA!: (result: AnalyticsResult) => void;
    let resolveB!: (result: AnalyticsResult) => void;
    vi.mocked(queryAnalytics).mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));
    setup(); await choose(cases[0][0]);
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledTimes(1));
    await choose(cases[3][0]);
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledTimes(2));
    expect(vi.mocked(queryAnalytics).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => resolveB(resultFor('average_return_pct', 'direction', { groups: [group('New answer', '0.42')] })));
    expect(await screen.findByRole('heading', { name: 'New answer' })).toBeTruthy();
    await act(async () => resolveA(resultFor('average_return_pct', 'strategy', { groups: [group('Old answer')] })));
    expect(screen.queryByText('Old answer')).toBeNull();
    expect(screen.getByRole('heading', { name: 'New answer' })).toBeTruthy();
  });
  it('resets advanced-only rule filters when choosing a trade question', async () => {
    const user = userEvent.setup(); setup(); await choose(cases[7][0]);
    await screen.findByRole('region', { name: 'Answer summary' });
    await user.click(screen.getByText('Adjust period and filters'));
    await user.click(screen.getByText('More filters and displayed measure'));
    await user.selectOptions(screen.getByLabelText('rule_statuses'), 'NOT_EVALUABLE');
    await choose(cases[1][0]);
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledTimes(2));
    expect(vi.mocked(queryAnalytics).mock.calls[1][0].filters.rule_statuses).toBeUndefined();
  });
});

describe('Guided evidence presentation', () => {
  it('summarises rounded server values and exact samples without zero-filling unknown groups', () => {
    render(<GuidedAnswer isKo={false} data={resultFor('average_return_pct', 'setup', { groups: [group('Breakout', '0.420000000000000001'), group('Missing', null)] })} />);
    expect(screen.getByText('0.42%')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getAllByText('10 trades · 7/10 evaluable trades · 3 unavailable')).toHaveLength(2);
    expect(screen.getAllByText(/Small sample/)).toHaveLength(2);
    expect(screen.getByText(/Do not add group trade counts/)).toBeTruthy();
  });
  it('explains zero trades and incomplete grouping records', () => {
    const view = render(<GuidedAnswer isKo={false} data={resultFor('average_return_pct', 'strategy', { groups: [], selected_trade_count: 0 })} />);
    expect(screen.getByRole('status').textContent).toContain('sync closed trades');
    view.rerender(<GuidedAnswer isKo={false} data={resultFor('average_return_pct', 'strategy', { groups: [group('UNASSIGNED', 0, { identity: { ...group().identity, label: 'UNASSIGNED', state: 'UNASSIGNED' } })] })} />);
    expect(screen.getByRole('status').textContent).toContain('strategy version');
    expect(screen.getByText('0%')).toBeTruthy();
  });
  it('keeps NOT_EVALUABLE neutral and explains missing rule inputs', () => {
    render(<GuidedAnswer isKo={false} data={resultFor('adherence_pct', 'strategy', { groups: [group('NOT_EVALUABLE', null, { evaluable_sample: 0, unavailable_sample: 10 })] })} />);
    expect(screen.getByRole('heading', { name: 'NOT_EVALUABLE' }).className).not.toContain('bear');
    expect(screen.getByRole('status').textContent).toContain('Plan or observation');
    expect(screen.getByText(/NOT_EVALUABLE is neither a violation nor part of this denominator/)).toBeTruthy();
    expect(screen.getByText('10 trades · 0/10 evaluable rule evaluations · 10 unavailable')).toBeTruthy();
  });
  it('queries adherence and coverage separately and displays each returned value without recalculation', async () => {
    vi.mocked(queryAnalytics).mockImplementation(async request => resultFor(request.metric, request.dimension, { groups: [group('Strategy A', request.metric === 'adherence_pct' ? '71.123456789' : '40.5')] }));
    const user = userEvent.setup(); setup(); await choose(cases[7][0]);
    const answer = await screen.findByRole('region', { name: 'Answer summary' });
    expect(within(answer).getByText('71.12%')).toBeTruthy();
    expect(within(answer).getByText(/FOLLOWED \/ \(FOLLOWED \+ VIOLATED\)/)).toBeTruthy();
    await user.click(screen.getByText('Adjust period and filters'));
    await user.click(screen.getByText('More filters and displayed measure'));
    await user.selectOptions(screen.getByLabelText('Value to compare'), 'coverage_pct');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    const coverage = await screen.findByRole('region', { name: 'Answer summary' });
    expect(within(coverage).getByText('40.5%')).toBeTruthy();
    expect(within(coverage).queryByText('71.12%')).toBeNull();
    expect(within(coverage).getByText(/includes NOT_EVALUABLE in the total/)).toBeTruthy();
    expect(vi.mocked(queryAnalytics).mock.calls.map(([r]) => r.metric)).toEqual(['adherence_pct', 'coverage_pct']);
  });
});
