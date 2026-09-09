// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  addPlanRevision,
  addInTradePlanRevision,
  createInTradePlan,
  createPlan,
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

const livePosition = {
  exchange: 'deepcoin' as const,
  position_id: 'live-1',
  symbol: 'BTC/USDT',
  direction: 'Long' as const,
  size: 1,
  average_price: 100,
  last_price: 101,
  unrealized_pnl: 1,
  opened_at: '2026-09-08T00:00:00Z',
  lifecycle_available: true,
};

function savedPlan(journalId: number, stopLoss = 98, takeProfit = 104): TradingPlan {
  const revision = { id: journalId, plan_id: journalId, version: 1, entry_price: null, entry_min: null, entry_max: null, stop_loss: stopLoss, take_profit: takeProfit, take_profit_2: null, received_at: '2026-09-05T00:00:00Z', created_at: '2026-09-05T00:00:00Z' };
  return { id: journalId, exchange: 'deepcoin', symbol: trades[journalId - 1].symbol!, symbol_key: trades[journalId - 1].symbol!.replace('/', ''), side: 'Long', status: 'linked', source: 'RETROSPECTIVE', received_at: revision.received_at, created_at: revision.created_at, updated_at: revision.created_at, revisions: [revision], latest_revision: revision,
    link: { id: journalId, plan_id: journalId, journal_entry_id: journalId, link_status: 'LINKED', linked_at: revision.created_at, updated_at: revision.created_at } };
}

function revisedPlan(previous: TradingPlan, stopLoss: number, version = 2): TradingPlan {
  const revision = {
    ...previous.latest_revision,
    id: version,
    version,
    stop_loss: stopLoss,
    created_at: `2026-09-05T00:0${version}:00Z`,
  };
  return { ...previous, updated_at: revision.created_at, revisions: [...previous.revisions, revision], latest_revision: revision };
}

function pretradePlan(stopLoss: number, version = 1, previous: TradingPlan | null = null): TradingPlan {
  const revision = {
    id: version, plan_id: 200, version, entry_price: 100, entry_min: null, entry_max: null,
    stop_loss: stopLoss, take_profit: 104, take_profit_2: null, max_hold_hours: null,
    setup: null, entry_note: null, exit_note: null, memo: null,
    received_at: `2026-09-08T01:0${version}:00Z`, created_at: `2026-09-08T01:0${version}:00Z`,
  };
  const revisions = [...(previous?.revisions ?? []), revision];
  return {
    id: 200, exchange: 'deepcoin', symbol: 'BTC/USDT', symbol_key: 'BTCUSDT', side: 'Long',
    status: 'active', source: 'VERIFIED_PRETRADE', received_at: revisions[0].received_at,
    created_at: revisions[0].created_at, updated_at: revision.created_at,
    revisions, latest_revision: revision, link: null,
  };
}

function inTradePlan(stopLoss: number, version = 1, previous: TradingPlan | null = null): TradingPlan {
  const revision = {
    id: version, plan_id: 100, version, entry_price: null, entry_min: null, entry_max: null,
    stop_loss: stopLoss, take_profit: 104, take_profit_2: null, max_hold_hours: null,
    setup: null, entry_note: null, exit_note: null, memo: null,
    received_at: `2026-09-08T00:0${version}:00Z`, created_at: `2026-09-08T00:0${version}:00Z`,
  };
  const revisions = [...(previous?.revisions ?? []), revision];
  return {
    id: 100, exchange: 'deepcoin', symbol: 'BTC/USDT', symbol_key: 'BTCUSDT', side: 'Long',
    status: 'active', source: 'IN_TRADE', live_position_id: livePosition.position_id,
    live_entry_at: livePosition.opened_at, received_at: revisions[0].received_at,
    created_at: revisions[0].created_at, updated_at: revision.created_at,
    revisions, latest_revision: revision, link: null,
  };
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

async function waitForMutationStart(client: QueryClient, calls: () => number, expectedCalls = 1, pendingMutations = expectedCalls) {
  await waitFor(() => {
    expect(calls()).toBe(expectedCalls);
    expect(client.isMutating()).toBe(pendingMutations);
  });
}

async function resolveMutation<T>(
  client: QueryClient,
  pending: ReturnType<typeof deferred<T>>,
  value: T,
  remainingMutations = 0,
) {
  await act(async () => { pending.resolve(value); await pending.promise; });
  await waitFor(() => expect(client.isMutating()).toBe(remainingMutations));
}

async function rejectMutation<T>(
  client: QueryClient,
  pending: ReturnType<typeof deferred<T>>,
  error: Error,
) {
  await act(async () => {
    pending.reject(error);
    try { await pending.promise; } catch { /* mutation error is asserted by the caller */ }
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
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

async function openInTradePlan() {
  fireEvent.click(await screen.findByRole('button', { name: /Enter plan|Edit plan/ }));
  await screen.findByRole('heading', { name: /Enter in-trade plan|Edit in-trade plan/ });
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
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  await resolveMutation(client, save, savedPlan(1));
  expect(await screen.findByText('Retrospective plan saved.')).toBeTruthy();
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(true);
});

it('preserves a newer Plan draft, dirty guard, and submitted snapshot after success', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  expect(vi.mocked(createRetrospectivePlan).mock.calls[0][1]).toMatchObject({ stop_loss: 98, take_profit: 104 });
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  await resolveMutation(client, save, savedPlan(1));
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  expect(screen.queryByText('Retrospective plan saved.')).toBeNull();
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('preserves the exact newer Plan draft and navigation protection after failure', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '96' } });
  await rejectMutation(client, save, new Error('offline'));
  expect(await screen.findByText('offline', {}, { timeout: 3_000 })).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('96');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('keeps B untouched when the older save for A succeeds', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  await openTrade('ETH/USDT');
  expect(screen.getByText('ETH/USDT · LONG')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('');
  await resolveMutation(client, save, savedPlan(1));
  expect(screen.getByText('ETH/USDT · LONG')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('Retrospective plan saved.')).toBeNull();
});

it('isolates a late A success across A to B to A and keeps the newer A generation dirty', async () => {
  const save = deferred<TradingPlan>(); vi.mocked(createRetrospectivePlan).mockReturnValue(save.promise);
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  await openTrade('ETH/USDT'); await openTrade('BTC/USDT'); fillPlan('95', '106');
  await resolveMutation(client, save, savedPlan(1));
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
  const { client } = setup(); await openTrade('BTC/USDT'); fillPlan(); fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length);
  await openTrade('ETH/USDT'); await openTrade('BTC/USDT'); fillPlan('95', '106');
  const secondSave = screen.getByRole('button', { name: 'Save plan' }) as HTMLButtonElement;
  expect(secondSave.disabled).toBe(false);
  fireEvent.click(secondSave);
  await waitForMutationStart(client, () => vi.mocked(createRetrospectivePlan).mock.calls.length, 2, 2);
  await resolveMutation(client, second, savedPlan(1, 95, 106), 1);
  expect(await screen.findByText('Retrospective plan saved.')).toBeTruthy();
  await resolveMutation(client, first, savedPlan(1));
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('95');
  expect((screen.getByLabelText(/^TP1 ·/) as HTMLInputElement).value).toBe('106');
  expect(screen.getByText('Retrospective plan saved.')).toBeTruthy();
  expect(vi.mocked(createRetrospectivePlan).mock.calls[0][1]).toMatchObject({ stop_loss: 98, take_profit: 104 });
  expect(vi.mocked(createRetrospectivePlan).mock.calls[1][1]).toMatchObject({ stop_loss: 95, take_profit: 106 });
});

it('keeps historical trade identity while adding a revision', async () => {
  const existing = savedPlan(1);
  vi.mocked(getPlans).mockResolvedValue([existing]);
  vi.mocked(addPlanRevision).mockResolvedValue(revisedPlan(existing, 97));

  setup();
  const matches = await screen.findAllByText('BTC/USDT');
  const row = matches.find((element) => element.tagName === 'TD')?.closest('tr');
  if (!row) throw new Error('Missing historical trade row');
  fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
  fireEvent.click(await screen.findByRole('button', { name: /Add plan revision/ }));
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

  await waitFor(() => expect(addPlanRevision).toHaveBeenCalledTimes(1));
  expect(vi.mocked(addPlanRevision).mock.calls[0][0]).toBe(existing.id);
  expect(vi.mocked(addPlanRevision).mock.calls[0][1]).toMatchObject({ stop_loss: 97, take_profit: 104 });
  expect(createRetrospectivePlan).not.toHaveBeenCalled();
  expect(await screen.findByText('Retrospective plan saved.')).toBeTruthy();
});

it('promotes a pending pre-trade create to revision authority without overwriting D2', async () => {
  const create = deferred<TradingPlan>();
  const created = pretradePlan(98);
  vi.mocked(createPlan).mockReturnValue(create.promise);
  vi.mocked(addPlanRevision).mockResolvedValue(pretradePlan(97, 2, created));

  const { client } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Record pre-trade' }));
  fireEvent.change(screen.getByLabelText('Plan Entry'), { target: { value: '100' } });
  fillPlan();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createPlan).mock.calls.length);
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  await resolveMutation(client, create, created);

  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(addPlanRevision).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(vi.mocked(addPlanRevision).mock.calls[0][0]).toBe(created.id);
  expect(vi.mocked(addPlanRevision).mock.calls[0][1]).toMatchObject({ stop_loss: 97, take_profit: 104 });
  expect(createPlan).toHaveBeenCalledTimes(1);
});

it('keeps the created in-trade Plan as the target and persists the second save as revision 2', async () => {
  const server = { authoritative: null as TradingPlan | null };
  vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [livePosition], unavailable_exchanges: [] });
  vi.mocked(getPlans).mockImplementation(async () => server.authoritative ? [server.authoritative] : []);
  vi.mocked(createInTradePlan).mockImplementation(async () => {
    server.authoritative = inTradePlan(98);
    return server.authoritative;
  });
  vi.mocked(addInTradePlanRevision).mockImplementation(async (_id, revision) => {
    server.authoritative = inTradePlan(revision.stop_loss, 2, server.authoritative);
    return server.authoritative;
  });

  setup(); await openInTradePlan(); fillPlan();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(createInTradePlan).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save plan' })).toBeTruthy());

  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(addInTradePlanRevision).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save plan' })).toBeTruthy());

  expect(createInTradePlan).toHaveBeenCalledTimes(1);
  expect(vi.mocked(addInTradePlanRevision).mock.calls[0][1]).toMatchObject({ stop_loss: 97, take_profit: 104 });
  expect(server.authoritative?.latest_revision.stop_loss).toBe(97);
  expect(server.authoritative?.revisions).toHaveLength(2);
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit in-trade plan' })).toBeNull());
  await openInTradePlan();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
});

it('keeps a submitted draft dirty when idempotent create returns a different existing Plan', async () => {
  const existing = inTradePlan(98);
  vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [livePosition], unavailable_exchanges: [] });
  vi.mocked(createInTradePlan).mockResolvedValue(existing);
  vi.mocked(addInTradePlanRevision).mockResolvedValue(inTradePlan(97, 2, existing));
  setup(); await openInTradePlan(); fillPlan('97', '104');
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

  expect(await screen.findByText('The saved Plan differs from your submission. Your current input remains unsaved.')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
  expect(window.confirm).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(addInTradePlanRevision).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText('The saved Plan differs from your submission. Your current input remains unsaved.')).toBeNull());
  expect(createInTradePlan).toHaveBeenCalledTimes(1);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(true);
});

it('preserves D2 as dirty when in-trade create D1 succeeds later', async () => {
  const create = deferred<TradingPlan>();
  vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [livePosition], unavailable_exchanges: [] });
  vi.mocked(createInTradePlan).mockReturnValue(create.promise);
  const { client } = setup(); await openInTradePlan(); fillPlan();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(createInTradePlan).mock.calls.length);
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  await resolveMutation(client, create, inTradePlan(98));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save plan' })).toBeTruthy());

  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it('preserves D2 as dirty when in-trade revision D1 succeeds later', async () => {
  const first = inTradePlan(98);
  const revise = deferred<TradingPlan>();
  vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [livePosition], unavailable_exchanges: [] });
  vi.mocked(getPlans).mockResolvedValue([first]);
  vi.mocked(addInTradePlanRevision).mockReturnValue(revise.promise);
  const { client } = setup(); await openInTradePlan();
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '97' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitForMutationStart(client, () => vi.mocked(addInTradePlanRevision).mock.calls.length);
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '96' } });
  await resolveMutation(client, revise, inTradePlan(97, 2, first));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save plan' })).toBeTruthy());

  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('96');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});

it.each([
  ['create', null],
  ['revision', inTradePlan(98)],
] as const)('preserves the draft and dirty guard after an in-trade %s failure', async (_operation, existing) => {
  vi.mocked(getExchangeOpenPositions).mockResolvedValue({ positions: [livePosition], unavailable_exchanges: [] });
  vi.mocked(getPlans).mockResolvedValue(existing ? [existing] : []);
  if (existing) vi.mocked(addInTradePlanRevision).mockRejectedValue(new Error('revision failed'));
  else vi.mocked(createInTradePlan).mockRejectedValue(new Error('create failed'));
  setup(); await openInTradePlan(); fillPlan('97', '104');
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

  expect(await screen.findByText(existing ? 'revision failed' : 'create failed')).toBeTruthy();
  expect((screen.getByLabelText('Stop Loss') as HTMLInputElement).value).toBe('97');
  vi.mocked(window.confirm).mockReturnValue(false);
  expect(window.dispatchEvent(new Event('app-before-navigate', { cancelable: true }))).toBe(false);
});
