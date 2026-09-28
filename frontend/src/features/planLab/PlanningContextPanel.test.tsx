// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getPlanningContext, type PlanningContext } from '../../api/planningContext';
import { linkPlanToTrade } from '../../api/journal';
import PlanningContextPanel from './PlanningContextPanel';
import { convertedJournalPrices, retrospectiveDraft } from './planningContext';
import { revisionPayload, type PlanDraft } from './pastTradePlan';
import { journalQueryKeys } from '../journal/journalQueryKeys';

vi.mock('../../api/planningContext', () => ({ getPlanningContext: vi.fn() }));
vi.mock('../../api/journal', () => ({ linkPlanToTrade: vi.fn() }));

const base: PlanDraft = { exchange: 'binance', symbol: 'BTC/USDT', side: 'Long', entryMode: 'exact', entryPrice: '', entryMin: '', entryMax: '', stopLoss: '', takeProfit: '', takeProfit2: '', maxHoldHours: '', setup: '', entryNote: '', exitNote: '', memo: '' };
function context(): PlanningContext {
  return { journal_entry_id: 1, journal_notes: { source: 'journal_entries', journal_entry_id: 1, planned_stop_pct: 2, planned_target_pct: 4, planned_entry_reason: 'Support held', plan_recorded_at: '1999-01-01', has_notes: true, timing_verified: false },
    actual_execution: { entry_price: 100, direction: 'Long' }, link_state: 'NO_LINKED_PLAN', linked_plan: null, candidate_plans: [], candidates_truncated: false, issues: [] };
}
function history(): NonNullable<PlanningContext['linked_plan']> {
  const revision = { id: 1, plan_id: 8, version: 1, entry_price: 100, stop_loss: 98, take_profit: 104, received_at: '2026-01-01T08:00:00Z', created_at: '2026-01-01T08:00:00Z' };
  return { plan: { id: 8, exchange: 'binance', symbol: 'BTC/USDT', symbol_key: 'BTCUSDT', side: 'Long', source: 'VERIFIED_PRETRADE', status: 'linked', received_at: revision.received_at, created_at: revision.created_at, updated_at: revision.created_at,
    revisions: [revision, { ...revision, id: 2, version: 2, stop_loss: 97 }], latest_revision: { ...revision, id: 2, version: 2, stop_loss: 97 }, link: { id: 1, plan_id: 8, journal_entry_id: 1, link_status: 'LINKED', linked_at: revision.created_at, updated_at: revision.created_at } },
    entry_time_revision: revision, analysis_revision: revision, analysis_basis: 'VERIFIED_PRETRADE' };
}
function setup(id = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const open = vi.fn(), start = vi.fn();
  const panel = (entryId: number) => <QueryClientProvider client={client}><PlanningContextPanel key={entryId} entryId={entryId} isKo={false} onOpenPlan={open} onStartPlan={start} /></QueryClientProvider>;
  const result = render(panel(id));
  return { ...result, client, open, start, panel };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getPlanningContext).mockResolvedValue(context()); });
afterEach(cleanup);

it('shows journal-only provenance and requires explicit intent and unit confirmation', async () => {
  const { start } = setup();
  expect(await screen.findByText('Planning notes recorded — not saved as a Trade Plan.')).toBeTruthy();
  expect(start).not.toHaveBeenCalled(); expect(linkPlanToTrade).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Start retrospective plan from these notes'));
  expect(start).toHaveBeenLastCalledWith(context(), false);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Start retrospective plan from these notes'));
  expect(start).toHaveBeenLastCalledWith(context(), true);
  expect(linkPlanToTrade).not.toHaveBeenCalled();
});

it.each([['Long', '98', '104'], ['Short', '102', '96']])('converts % for %s only in a draft, leaving source and intended entry unchanged', (direction, stopLoss, takeProfit) => {
  const source = context(); source.actual_execution.direction = direction;
  const before = structuredClone(source);
  expect(convertedJournalPrices(source)).toEqual({ stopLoss, takeProfit });
  const draft = retrospectiveDraft(source, base, true);
  expect(revisionPayload(draft, true)).toMatchObject({ entry_price: null, entry_min: null, entry_max: null, stop_loss: Number(stopLoss), take_profit: Number(takeProfit), take_profit_2: null, setup: null });
  expect(source).toEqual(before);
  expect(retrospectiveDraft(source, base, false).stopLoss).toBe('');
});

it.each([null, 0, -1, Infinity, '100'])('refuses invalid entry %s', entry => {
  const source = context(); source.actual_execution.entry_price = entry as number;
  expect(convertedJournalPrices(source)).toBeNull();
});
it.each([0, -1, '2', Infinity, 101])('refuses invalid stop %s', stop => {
  const source = context(); source.journal_notes.planned_stop_pct = stop;
  expect(convertedJournalPrices(source)).toBeNull();
});
it('does not invent missing targets, infer direction, or create nonpositive short prices', () => {
  const source = context(); source.journal_notes.planned_target_pct = null;
  expect(convertedJournalPrices(source)).toEqual({ stopLoss: '98', takeProfit: '' });
  source.actual_execution.direction = 'unknown'; expect(convertedJournalPrices(source)).toBeNull();
  source.actual_execution.direction = 'Short'; source.journal_notes.planned_target_pct = 150;
  expect(convertedJournalPrices(source)).toBeNull();
});

it('shows conflicting sources side by side and latest vs entry-time revision; opens the same Plan', async () => {
  const source = context(); source.link_state = 'LINKED'; source.linked_plan = history();
  vi.mocked(getPlanningContext).mockResolvedValue(source);
  const { open, start } = setup();
  expect(await screen.findByText('Current plan revision · v2')).toBeTruthy();
  expect(screen.getByText('At trade entry · recorded before entry · v1')).toBeTruthy();
  expect(screen.getByText(/Both sources are shown unchanged/)).toBeTruthy();
  expect(screen.queryByText('Start retrospective plan from these notes')).toBeNull();
  fireEvent.click(screen.getByText('Open plan')); expect(open).toHaveBeenCalledWith(source.linked_plan.plan);
  expect(start).not.toHaveBeenCalled();
});

it('supports plan-only context without fabricating Journal notes', async () => {
  const source = context(); source.journal_notes.has_notes = false; source.link_state = 'LINKED'; source.linked_plan = history();
  vi.mocked(getPlanningContext).mockResolvedValue(source); setup();
  await screen.findByText('Open plan');
  expect(screen.queryByText('Journal planning notes · timing not verified')).toBeNull();
});

it('requires an explicit candidate selection and refreshes context after linking', async () => {
  const source = context(); source.link_state = 'CANDIDATES'; source.candidate_plans = [history().plan, { ...history().plan, id: 9 }];
  vi.mocked(getPlanningContext).mockResolvedValue(source);
  vi.mocked(linkPlanToTrade).mockResolvedValue(history().plan);
  setup();
  const button = await screen.findByText('Link selected plan');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '9' } });
  fireEvent.click(button);
  await waitFor(() => expect(linkPlanToTrade).toHaveBeenCalledWith(9, 1));
  await waitFor(() => expect(getPlanningContext).toHaveBeenCalledTimes(2));
});

it('shows error distinctly from empty and disables invalid conversion', async () => {
  vi.mocked(getPlanningContext).mockRejectedValue(new Error('offline')); const result = setup();
  await screen.findByText('Unable to load planning context');
  expect(screen.queryByText('No linked Trade Plan or planning notes.')).toBeNull();
  const source = context(); source.journal_notes.has_notes = false;
  vi.mocked(getPlanningContext).mockResolvedValue(source);
  fireEvent.click(screen.getByText('Retry'));
  await screen.findByText('No linked Trade Plan or planning notes.'); result.unmount();
  source.journal_notes.has_notes = true; source.actual_execution.entry_price = null; setup();
  await screen.findByText(/Price conversion unavailable/);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
});

it('keeps ambiguous links distinct from absence and never offers a new Plan', async () => {
  vi.mocked(getPlanningContext).mockResolvedValue({ ...context(), link_state: 'AMBIGUOUS' }); setup();
  await screen.findByText(/Plan link needs review/);
  expect(screen.queryByText('Start retrospective plan from these notes')).toBeNull();
});

it('does not let a stale response for another trade replace current intent', async () => {
  let resolve!: (data: PlanningContext) => void;
  vi.mocked(getPlanningContext).mockImplementation(id => id === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve({ ...context(), journal_entry_id: 2, journal_notes: { ...context().journal_notes, planned_entry_reason: 'Second trade' } }));
  const result = setup(); expect(screen.getByText('Loading planning context…')).toBeTruthy();
  result.rerender(result.panel(2)); await screen.findByText('Second trade');
  await act(async () => resolve(context()));
  expect(screen.queryByText('Support held')).toBeNull();
});

it('requires fresh price-move confirmation when source values change', async () => {
  const { client, start } = setup();
  await screen.findByText('Start retrospective plan from these notes');
  fireEvent.click(screen.getByRole('checkbox'));
  const changed = context(); changed.journal_notes.planned_stop_pct = 3;
  act(() => { client.setQueryData(journalQueryKeys.planningContext(1), changed); });
  await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false));
  fireEvent.click(screen.getByText('Start retrospective plan from these notes'));
  expect(start).toHaveBeenLastCalledWith(changed, false);
});
