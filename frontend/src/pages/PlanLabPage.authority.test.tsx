// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  createRetrospectivePlan,
  getExchangeOpenPositions,
  getExchangeStatuses,
  getJournal,
  getPlanLab,
  getPlans,
} from '../api/client';
import { useStore } from '../store/useStore';
import type { JournalEntry, PlanLabData, TradingPlan } from '../types';
import PlanLabPage from './PlanLabPage';

vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(),
  addPlanRevision: vi.fn(), addInTradePlanRevision: vi.fn(), createInTradePlan: vi.fn(), createPlan: vi.fn(),
  createRetrospectivePlan: vi.fn(), getExchangeStatuses: vi.fn(), getExchangeOpenPositions: vi.fn(),
  getJournal: vi.fn(), getPlanLab: vi.fn(), getPlans: vi.fn(), linkPlanToTrade: vi.fn(), syncExchange: vi.fn(), updatePlanStatus: vi.fn(),
}));

const trades: JournalEntry[] = [
  { id: 1, external_id: 'A', source: 'deepcoin_position', exchange: 'deepcoin', symbol: 'BTC/USDT', direction: 'Long', entry_datetime: '2026-09-01T10:00:00Z', datetime: '2026-09-02T10:00:00Z', entry_price: 100, exit_price: 103, realized_pnl: 30 },
  { id: 2, external_id: 'B', source: 'deepcoin_position', exchange: 'deepcoin', symbol: 'ETH/USDT', direction: 'Long', entry_datetime: '2026-09-03T10:00:00Z', datetime: '2026-09-04T10:00:00Z', entry_price: 200, exit_price: 206, realized_pnl: 60 },
];

function savedPlan(journalId: number): TradingPlan {
  const revision = { id: journalId, plan_id: journalId, version: 1, entry_price: null, entry_min: null, entry_max: null, stop_loss: 98, take_profit: 104, take_profit_2: null, received_at: '2026-09-05T00:00:00Z', created_at: '2026-09-05T00:00:00Z' };
  return { id: journalId, exchange: 'deepcoin', symbol: trades[journalId - 1].symbol!, symbol_key: trades[journalId - 1].symbol!.replace('/', ''), side: 'Long', status: 'linked', source: 'RETROSPECTIVE', received_at: revision.received_at, created_at: revision.created_at, updated_at: revision.created_at, revisions: [revision], latest_revision: revision,
    link: { id: journalId, plan_id: journalId, journal_entry_id: journalId, link_status: 'LINKED', linked_at: revision.created_at, updated_at: revision.created_at } };
}

const emptyAnalysis: PlanLabData = {
  methodology: { official_revision: 'entry', path_interval: '1m', same_candle_policy: 'stop_first', official_r_basis: 'risk', adherence_weights: { entry: 1, stop: 1, exit: 1 }, adherence_threshold: 0.8, fees_funding: 'excluded', verified_pretrade: 'eligible', retrospective: 'observed', simulation_mode: 'historical', default_horizon: 'trade', setup_identity: 'recorded' },
  summary: { trade_count: 0, official_r_count: 0, closed_trade_count: 0, plan_recorded_count: 0, actual: { trade_count: 0, total_r: 0, sample_confidence: 'low' }, plan: { trade_count: 0, total_r: 0, sample_confidence: 'low' } },
  diagnosis: 'insufficient_data',
  coverage: { closed_trades: 0, plan_recorded: 0, official_r: 0, price_r_only: 0, r_unavailable: 0, ambiguous_links: 0, ambiguous: 0, not_evaluable: 0, verified_pretrade: 0, retrospective: 0 },
  cumulative_curve: [], primary_attribution: [], secondary_observations: [], early_exit_analysis: [], stop_behavior_analysis: [], delta_distribution: [], matrix: [], behavior_costs: [], setup_stats: [], side_stats: [], regime_stats: [],
  optimizer: { split: 'chronological_70_30', variants: [] }, target_calibration: { sample_count: 0 }, evaluations: [], plans: [], warnings: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return { promise: new Promise<T>((res, rej) => { resolve = res; reject = rej; }), resolve, reject };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><PlanLabPage /></QueryClientProvider>) };
}

async function openTrade(symbol: string) {
  const matches = await screen.findAllByText(symbol);
  const row = matches.find((element) => element.tagName === 'TD')?.closest('tr');
  if (!row) throw new Error(`Missing row for ${symbol}`);
  fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
}

function fillPlan(stop = '98', target = '104') {
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: stop } });
  fireEvent.change(screen.getByLabelText(/^TP1 ·/), { target: { value: target } });
}

beforeEach(() => {
  vi.clearAllMocks(); useStore.setState({ language: 'en' }); window.history.replaceState(null, '', '/plan-lab');
  vi.spyOn(window, 'confirm').mockReturnValue(true); vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(getJournal).mockResolvedValue(trades); vi.mocked(getPlans).mockResolvedValue([]);
  vi.mocked(getPlanLab).mockResolvedValue(emptyAnalysis);
  vi.mocked(getExchangeStatuses).mockResolvedValue([]); vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [], unavailable_exchanges: [] });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('applies an unchanged submitted Plan snapshot as clean authoritative state', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await act(async () => save.resolve(savedPlan(1)));
  expect(await screen.findByText('Retrospective plan saved.')).toBeTruthy();
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(true);
});

it('preserves a newer Plan draft, dirty guard, and submitted snapshot after success', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  expect((screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  await act(async () => save.resolve(savedPlan(1)));
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  expect(screen.queryByText('Retrospective plan saved.')).toBeNull();
  expect(vi.mocked(createRetrospectivePlan).mock.calls[0][1]).toMatchObject({ stop_loss: 98, take_profit: 104 });
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('preserves the exact newer Plan draft and navigation protection after failure', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '96' } });
  await act(async () => save.reject(new Error('offline')));
  expect(await screen.findByText('offline', {}, { timeout: 3_000 })).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('96');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('keeps B untouched when the older save for A succeeds', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await openTrade('ETH/USDT');
  expect(screen.getByText('ETH/USDT · LONG')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('');
  await act(async () => save.resolve(savedPlan(1)));
  expect(screen.getByText('ETH/USDT · LONG')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('Retrospective plan saved.')).toBeNull();
});

it('isolates a late A success across A to B to A and keeps the newer A generation dirty', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await openTrade('ETH/USDT'); await openTrade('BTC/USDT'); fillPlan('95', '106');
  await act(async () => save.resolve(savedPlan(1)));
  await waitFor(() => expect(getPlans).toHaveBeenCalledTimes(2));
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('95');
  expect((screen.getByLabelText(/^TP1 ·/) as HTMLInputElement).value).toBe('106');
  expect(screen.queryByText('Retrospective plan saved.')).toBeNull();
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('lets a new A session save again and prevents the older overlapping save from becoming UI authority', async () => {
  const first = deferred<TradingPlan>(); const second = deferred<TradingPlan>();
  vi.mocked(createRetrospectivePlan).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await openTrade('ETH/USDT'); await openTrade('BTC/USDT'); fillPlan('95', '106');
  const secondSave = screen.getByRole('button', { name: 'Save plan' }) as HTMLButtonElement;
  expect(secondSave.disabled).toBe(false);
  fireEvent.click(secondSave);
  await act(async () => second.resolve(savedPlan(1)));
  expect(await screen.findByText('Retrospective plan saved.')).toBeTruthy();
  await act(async () => first.resolve(savedPlan(1)));
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('95');
  expect((screen.getByLabelText(/^TP1 ·/) as HTMLInputElement).value).toBe('106');
  expect(screen.getByText('Retrospective plan saved.')).toBeTruthy();
  expect(vi.mocked(createRetrospectivePlan).mock.calls[0][1]).toMatchObject({ stop_loss: 98, take_profit: 104 });
  expect(vi.mocked(createRetrospectivePlan).mock.calls[1][1]).toMatchObject({ stop_loss: 95, take_profit: 106 });
});
