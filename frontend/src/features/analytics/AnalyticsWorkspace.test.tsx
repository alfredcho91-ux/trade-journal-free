// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalyticsMetadata, queryAnalytics } from '../../api/analytics';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import { ApiClientError } from '../../api/config';
import App from '../../App';
import type { AnalyticsResult } from '../../types/analytics';
import AnalyticsWorkspace from './AnalyticsWorkspace';
import AnalyticsResults from './AnalyticsResults';
import { displayAnalyticsValue } from './analyticsDisplay';
import { dimension, group, metadataFixture, resultFixture } from './analyticsTestFixtures';

vi.mock('../../api/analytics', () => ({ getAnalyticsMetadata: vi.fn(), queryAnalytics: vi.fn() }));
vi.mock('../../api/strategies', () => ({ listStrategies: vi.fn(), listStrategyVersions: vi.fn() }));
const clients: QueryClient[] = [];
function setup(element = <AnalyticsWorkspace overview={<p>Existing Trade Analysis overview</p>} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  vi.mocked(getAnalyticsMetadata).mockResolvedValue(metadataFixture());
  vi.mocked(queryAnalytics).mockResolvedValue(resultFixture());
  vi.mocked(listStrategies).mockResolvedValue([]); vi.mocked(listStrategyVersions).mockResolvedValue([]);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); });
async function ready() { await screen.findByRole('combobox', { name: 'Metric' }); }

describe('Analytics workspace behavior', () => {
  it('extends the existing Trade Analysis route and retains Journal/Playbook navigation', async () => {
    await import('../../pages/TradeAnalysisPage');
    window.history.replaceState(null, '', '/trade-analysis');
    setup(<App />);
    await screen.findByRole('heading', { name: 'Analytics Workspace' });
    for (const navigation of screen.getAllByRole('navigation', { name: 'Primary' })) {
      expect(within(navigation).getByRole('button', { name: /매매일지|Journal/ })).toBeTruthy();
      expect(within(navigation).getByRole('button', { name: /플레이북|Playbook/ })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'BTC' })).toBeNull();
  });
  it('discovers server metrics/dimensions, excludes unsupported options and posts selected filters', async () => {
    const user = userEvent.setup(); setup(); await ready();
    expect(screen.getByRole('option', { name: 'Server supplied metric (R)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'new_backend_dimension' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'rule_status' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Dimension'), 'fomo');
    await user.click(screen.getByText('Filters (0 active)'));
    await user.selectOptions(await screen.findByLabelText('fomo'), ['FALSE', 'UNRECORDED']);
    await user.type(screen.getByLabelText('symbols'), 'BTC/USDT, ETH/USDT');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByRole('region', { name: 'Analysis result' });
    expect(queryAnalytics).toHaveBeenCalledWith(expect.objectContaining({ metric: 'server_metric', dimension: 'fomo', filters: expect.objectContaining({ fomo: ['FALSE', 'UNRECORDED'], symbols: ['BTC/USDT', 'ETH/USDT'] }) }), expect.any(AbortSignal));
  });
  it('keeps invalid combination unselected after metric change and does not silently query', async () => {
    const user = userEvent.setup(); setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Metric'), 'server_rules');
    await user.selectOptions(screen.getByLabelText('Dimension'), 'rule_status');
    await user.selectOptions(screen.getByLabelText('Metric'), 'server_metric');
    expect((screen.getByLabelText('Dimension') as HTMLSelectElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByRole('alert')).toBeTruthy(); expect(queryAnalytics).not.toHaveBeenCalled();
  });
  it('surfaces API validation details and retains the configuration', async () => {
    vi.mocked(queryAnalytics).mockRejectedValue(new ApiClientError('Request validation failed', { status: 422, details: { fields: [{ location: ['body', 'filters', 'symbols'], message: 'must contain unique values' }] } }));
    const user = userEvent.setup(); setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Dimension'), 'fomo');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect((await screen.findByRole('alert')).textContent).toContain('must contain unique values');
    expect((screen.getByLabelText('Dimension') as HTMLSelectElement).value).toBe('fomo');
  });
  it('contains metadata network errors and offers retry and existing overview', async () => {
    vi.mocked(getAnalyticsMetadata).mockRejectedValue(new Error('Network offline')); setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Network offline');
    expect(screen.getByRole('button', { name: 'Retry metadata' })).toBeTruthy();
  });
  it('prevents slow A from hydrating B, hides stale result on filter edits, and retains loading selections', async () => {
    let resolveA!: (data: AnalyticsResult) => void;
    let resolveB!: (data: AnalyticsResult) => void;
    vi.mocked(queryAnalytics).mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));
    const user = userEvent.setup(); setup(); await ready();
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByText('Loading analysis…');
    await user.selectOptions(screen.getByLabelText('Dimension'), 'fomo');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledTimes(2));
    await act(async () => { resolveB(resultFixture({ groups: [group('B result')] })); });
    await screen.findByText('B result');
    await act(async () => { resolveA(resultFixture({ groups: [group('A stale result')] })); });
    expect(screen.queryByText('A stale result')).toBeNull();
    expect(screen.getByText('B result')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Start time *'), { target: { value: '2026-01-01T00:00' } });
    expect(screen.queryByText('B result')).toBeNull();
  });
  it('persists builder selections across navigation without replaying the query', async () => {
    const user = userEvent.setup(); const first = setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Dimension'), 'focus_score');
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByText('Existing Trade Analysis overview')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Psychology' }));
    first.unmount(); setup(); await ready();
    expect((screen.getByLabelText('Dimension') as HTMLSelectElement).value).toBe('focus_score');
    expect(queryAnalytics).not.toHaveBeenCalled();
  });
  it('offers archived Strategies and exact retired Version IDs without active substitution', async () => {
    vi.mocked(listStrategies).mockResolvedValue([{ id: 7, name: 'Archived setup', archived_at: '2025-01-01', active_version_id: 99, description: null, created_at: '', updated_at: '' }]);
    vi.mocked(listStrategyVersions).mockResolvedValue([{ id: 42, strategy_id: 7, sequence: 1, version_label: 'Historical v1', is_active: false, retired_at: '2025-01-01', created_at: '', description: null, rules: { schema_version: 1, entry_rules: [], risk_rules: [], exit_rules: [] } }]);
    const user = userEvent.setup(); setup(); await ready(); await user.click(screen.getByText('Filters (0 active)'));
    const option = await screen.findByRole('option', { name: /Historical v1.*Retired.*Archived/ });
    await user.selectOptions(screen.getByLabelText('Add Strategy versions'), option);
    expect((screen.getByLabelText('Strategy versions') as HTMLInputElement).value).toBe('42');
    await user.selectOptions(screen.getByLabelText('Dimension'), 'strategy_version');
    await user.click(screen.getByRole('button', { name: 'Run analysis' }));
    await waitFor(() => expect(queryAnalytics).toHaveBeenCalledWith(expect.objectContaining({ dimension: 'strategy_version', filters: expect.objectContaining({ strategy_version_ids: [42] }) }), expect.anything()));
    expect(listStrategies).toHaveBeenCalledWith(true);
  });
});

describe('Authoritative result presentation', () => {
  it('preserves small non-zero values and uses one display policy for numbers and decimal strings', () => {
    expect(displayAnalyticsValue(0.000000001)).toBe('1e-9');
    expect(displayAnalyticsValue(-0.000000001)).toBe('-1e-9');
    expect(displayAnalyticsValue('0.000000001')).toBe('1e-9');
    expect(displayAnalyticsValue('0.0000000001234567890123456789')).toBe('1.234567890123456789e-10');
    expect(displayAnalyticsValue(0)).toBe('0');
    expect(displayAnalyticsValue(-0)).toBe('0');
    expect(displayAnalyticsValue(null)).toBe('Unavailable');
    expect(displayAnalyticsValue(12.3456)).toBe('12.3456');
    expect(displayAnalyticsValue(-3.2)).toBe('-3.2');
  });
  it('uses the same non-zero policy in KPI and grouped table values with units', () => {
    const view = setup(<AnalyticsResults data={resultFixture({ groups: [group('tiny', 0.000000001)] })} />);
    expect(document.querySelector('.text-3xl.tabular-nums')?.textContent).toBe('1e-9 R');
    expect(screen.getByText('1e-9 R')).toBeTruthy();
    view.unmount();
    setup(<AnalyticsResults data={resultFixture({ groups: [group('tiny negative', -0.000000001)] })} />);
    expect(document.querySelector('.text-3xl.tabular-nums')?.textContent).toBe('-1e-9 R');
    expect(screen.getByText('-1e-9 R')).toBeTruthy();
  });
  it('renders exact decimal strings, units, samples, unknown reasons and evidence without recalculation', () => {
    setup(<AnalyticsResults data={resultFixture()} />);
    const result = screen.getByRole('region', { name: 'Analysis result' });
    expect(within(result).getAllByText(/1.234567890123456789/).length).toBe(2);
    expect(within(result).getByRole('columnheader', { name: 'Total sample' })).toBeTruthy();
    expect(within(result).getByText('MISSING_OBSERVATION: 3')).toBeTruthy();
    expect(result.textContent).toContain('Limited sample'); expect(result.textContent).toContain('Observed historical association');
    expect(result.textContent).toContain('7'); expect(result.textContent).toContain('3');
  });
  it('preserves false, unrecorded, invalid and unassigned states with null distinct from zero', () => {
    const groups = [group('FALSE', 0), group('UNRECORDED', null), group('INVALID', null), group('UNASSIGNED', null)];
    groups.slice(1).forEach(g => { g.identity.state = g.identity.label; g.evaluable_sample = 0; });
    setup(<AnalyticsResults data={resultFixture({ groups, dimension: dimension('fomo', 'psychology') })} />);
    expect(screen.getByText('FALSE')).toBeTruthy(); expect(screen.getByText('0 R')).toBeTruthy();
    expect(screen.getByText(/Invalid historical data/)).toBeTruthy(); expect(screen.getAllByRole('cell', { name: 'Unavailable' }).length).toBe(3);
    expect(screen.getAllByText('No evaluable samples').length).toBe(3);
  });
  it('displays FOLLOWED, VIOLATED and neutral NOT_EVALUABLE with backend adherence/coverage values', () => {
    for (const name of ['Adherence', 'Coverage']) {
      const view = setup(<AnalyticsResults data={resultFixture({ metric: { ...metadataFixture().metrics[1], label: name }, groups: ['FOLLOWED', 'VIOLATED', 'NOT_EVALUABLE'].map(label => group(label, '71.123456789')) })} />);
      expect(screen.getByText('NOT_EVALUABLE').className).not.toContain('bear');
      expect(screen.getAllByText('71.123456789 percent').length).toBe(3);
      view.unmount();
    }
  });
  it('preserves exact historical strategy and version identity', () => {
    const g = group('Archived / Retired v1'); g.identity.strategy_id = 7; g.identity.strategy_version_id = 42;
    setup(<AnalyticsResults data={resultFixture({ groups: [g] })} />);
    expect(screen.getByText('Strategy #7 Version #42')).toBeTruthy(); expect(screen.getByText('Archived / Retired v1')).toBeTruthy();
  });
  it.each(['day', 'week', 'month'])('renders %s series using close-time UTC buckets and null gaps', async id => {
    const user = userEvent.setup(); setup(<AnalyticsResults data={resultFixture({ dimension: dimension(id, 'time'), groups: [group('2026-01-01', 1), group('2026-01-02', null), group('2026-01-03', 2)] })} />);
    await user.click(screen.getByRole('button', { name: 'Time series' }));
    const chart = screen.getByLabelText('Close-time series');
    expect(chart.querySelectorAll('line').length).toBe(0);
    expect(screen.getByText(/Close \/ exit time · UTC/)).toBeTruthy();
  });
  it.each(['weekday', 'hour'])('labels %s as close time and offers a bar comparison', async id => {
    const user = userEvent.setup(); setup(<AnalyticsResults data={resultFixture({ dimension: dimension(id, 'time') })} />);
    expect(screen.getByText(new RegExp(`Close ${id} ·`))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Bar comparison' }));
    expect(screen.getByLabelText('Grouped bar comparison')).toBeTruthy();
  });
  it('shows empty results and empty sample explicitly', () => {
    const view = setup(<AnalyticsResults data={resultFixture({ groups: [] })} />);
    expect(screen.getByText('No results in the selected sample.')).toBeTruthy(); view.unmount();
    setup(<AnalyticsResults data={resultFixture({ groups: [group('all', null, { total_sample: 0, evaluable_sample: 0, unavailable_sample: 0, trade_sample: 0 })] })} />);
    expect(screen.getByText('Empty sample')).toBeTruthy();
  });
});
