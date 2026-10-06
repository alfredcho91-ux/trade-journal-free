// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJournalStrategyEvaluation, updateJournalBehavior } from '../../api/journal';
import {
  deleteJournalStrategyAssignment,
  getJournalStrategyAssignment,
  putJournalStrategyAssignment,
} from '../../api/strategyAssignments';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import { RouterContext } from '../../router-context';
import type { JournalEntry, JournalStrategyAssignment, Strategy, StrategyVersion } from '../../types';
import TradeReportModal from './TradeReportModal';
import { journalQueryKeys } from './journalQueryKeys';
import { getPlanningContext } from '../../api/planningContext';
import * as clientApi from '../../api/client';
import { setWorkspace } from '../onboarding/workspaceSession';

vi.mock('../../api/planningContext', () => ({ getPlanningContext: vi.fn(async (id: number) => ({
  journal_entry_id: id, journal_notes: { source: 'journal_entries', journal_entry_id: id, planned_stop_pct: null, planned_target_pct: null, planned_entry_reason: null, plan_recorded_at: null, has_notes: false, timing_verified: false },
  actual_execution: {}, link_state: 'NO_LINKED_PLAN', linked_plan: null, candidate_plans: [], candidates_truncated: false, issues: [],
})) }));

vi.mock('../../api/journal', () => ({
  getDeepcoinTradeMarkers: vi.fn(),
  getExchangeExecutions: vi.fn(),
  getJournalStrategyEvaluation: vi.fn().mockResolvedValue(null),
  updateJournalBehavior: vi.fn(),
}));
vi.mock('../../api/strategyAssignments', () => ({
  getJournalStrategyAssignment: vi.fn(),
  putJournalStrategyAssignment: vi.fn(),
  deleteJournalStrategyAssignment: vi.fn(),
}));
vi.mock('../../api/strategies', () => ({
  listStrategies: vi.fn(),
  listStrategyVersions: vi.fn(),
}));
vi.mock('../../components/PositionReviewChart', () => ({ default: () => null }));
vi.mock('../../components/TradeIndicatorCharts', () => ({ default: () => null }));
vi.mock('../../components/TradeReferenceSummary', () => ({ default: () => null }));
vi.mock('../tradeAnalysis/TradeExitReviewPanel', () => ({ default: () => null }));

const mockedBehaviorUpdate = vi.mocked(updateJournalBehavior);
const mockedEvaluationGet = vi.mocked(getJournalStrategyEvaluation);
const mockedAssignmentGet = vi.mocked(getJournalStrategyAssignment);
const mockedAssignmentPut = vi.mocked(putJournalStrategyAssignment);
const mockedAssignmentDelete = vi.mocked(deleteJournalStrategyAssignment);
const mockedStrategies = vi.mocked(listStrategies);
const mockedVersions = vi.mocked(listStrategyVersions);

const strategy: Strategy = {
  id: 1,
  name: 'Breakout Momentum',
  description: 'Confirmed breakout continuation',
  archived_at: null,
  active_version_id: 10,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};
const version: StrategyVersion = {
  id: 10,
  strategy_id: 1,
  sequence: 1,
  version_label: 'v1.0',
  description: 'Current version',
  rules: { schema_version: 1, entry_rules: [], risk_rules: [], exit_rules: [] },
  is_active: true,
  retired_at: null,
  created_at: '2026-09-01T00:00:00Z',
};

function trade(id = 101, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    source: 'deepcoin_position',
    direction: 'Long',
    entry_price: 100,
    exit_price: 102,
    planned_stop_pct: null,
    setup_tags: [],
    ...overrides,
  };
}

function assignment(entryId: number): JournalStrategyAssignment {
  return {
    journal_entry_id: entryId,
    strategy_version_id: 10,
    strategy_id: 1,
    strategy_name: 'Breakout Momentum',
    strategy_archived_at: null,
    version_sequence: 1,
    version_label: 'v1.0',
    version_description: 'Current version',
    version_is_active: true,
    version_retired_at: null,
    assigned_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

function renderModal(entry = trade()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  const navigate = vi.fn();
  const view = render(<QueryClientProvider client={client}>
    <RouterContext.Provider value={{ pathname: '/journal', search: '', navigate, setSearchParams: vi.fn() }}>
      <TradeReportModal entry={entry} allEntries={[]} isKo={false} onClose={onClose} />
    </RouterContext.Provider>
  </QueryClientProvider>);
  return { client, navigate, onClose, ...view };
}

async function makeBehaviorDirty(user: ReturnType<typeof userEvent.setup>, value = '2') {
  const stop = screen.getByLabelText<HTMLInputElement>('Planned stop percentage');
  await user.clear(stop);
  await user.type(stop, value);
  return stop;
}

async function makeAssignmentDirty(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
  await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
}

beforeEach(() => {
  vi.mocked(getPlanningContext).mockImplementation(async id => ({ journal_entry_id: id,
    journal_notes: { source: 'journal_entries', journal_entry_id: id, planned_stop_pct: null, planned_target_pct: null, planned_entry_reason: null, plan_recorded_at: null, has_notes: false, timing_verified: false },
    actual_execution: {}, link_state: 'NO_LINKED_PLAN', linked_plan: null, candidate_plans: [], candidates_truncated: false, issues: [],
  }));
  mockedEvaluationGet.mockResolvedValue(null);
  mockedAssignmentGet.mockResolvedValue(null);
  mockedAssignmentPut.mockImplementation(async (entryId) => assignment(entryId));
  mockedAssignmentDelete.mockResolvedValue(null);
  mockedStrategies.mockResolvedValue([strategy]);
  mockedVersions.mockResolvedValue([version]);
  mockedBehaviorUpdate.mockImplementation(async (entryId, payload) => ({ ...trade(entryId), ...payload }));
});

afterEach(() => {
  cleanup();
  setWorkspace(null);
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('sample Journal keeps strategy, behavior and planning panels without requesting a live chart', async () => {
  setWorkspace({ mode: 'sample', profile_id: 'sample:test', first_run: false, trade_count: 36, return_url: null, period: { start: '2026-01-01', end: '2026-01-31' }, credential_backend: 'disabled', fixture_version: 1 });
  const report = vi.spyOn(clientApi, 'getTradeReport');
  renderModal(trade(1, { symbol: 'BTC/USDT', entry_datetime: '2026-01-02T09:00:00Z', datetime: '2026-01-02T11:00:00Z', confidence_score: 4, notes: 'Synthetic reflection' }));
  await screen.findByText('No Strategy Version assigned');
  expect(screen.getByText(/This is a synthetic sample trade/)).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Trade planning context' })).toBeTruthy();
  expect(report).not.toHaveBeenCalled();
});

it('shows Journal planning notes and navigates to the shared retrospective editor without writing', async () => {
  vi.mocked(getPlanningContext).mockResolvedValue({ journal_entry_id: 101,
    journal_notes: { source: 'journal_entries', journal_entry_id: 101, planned_stop_pct: 2, planned_target_pct: 4, planned_entry_reason: 'Support held', plan_recorded_at: null, has_notes: true, timing_verified: false },
    actual_execution: { entry_price: 100, direction: 'Long' }, link_state: 'NO_LINKED_PLAN', linked_plan: null, candidate_plans: [], candidates_truncated: false, issues: [],
  });
  const { navigate } = renderModal(); const user = userEvent.setup();
  await screen.findByText('Planning notes recorded — not saved as a Trade Plan.');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByText('Start retrospective plan from these notes'));
  expect(navigate).toHaveBeenCalledWith('/plan-lab?journalId=101&prefill=1&pricePercent=1');
  expect(mockedBehaviorUpdate).not.toHaveBeenCalled();
});

describe('Trade Report combined unsaved-change boundary', () => {
  it('keeps the report open while removal confirmation traps focus and handles Escape', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
    mockedAssignmentGet.mockResolvedValue(assignment(101));
    const user = userEvent.setup();
    const { onClose } = renderModal();
    const opener = await screen.findByRole('button', { name: 'Remove Strategy' });
    await user.click(opener);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove' }));
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Remove Strategy assignment' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Trade report' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockedAssignmentDelete).not.toHaveBeenCalled();
  });

  it('does not let Escape dismiss the report or removal confirmation while removal is pending', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
    mockedAssignmentGet.mockResolvedValue(assignment(101));
    let finish!: (value: null) => void;
    mockedAssignmentDelete.mockReturnValue(new Promise<null>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(await screen.findByRole('button', { name: 'Remove Strategy' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Removing...' }).disabled).toBe(true));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Remove Strategy assignment' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Trade report' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockedAssignmentDelete).toHaveBeenCalledExactlyOnceWith(101);
    await act(async () => { finish(null); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Strategy assignment' })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not refetch or preview evaluation for an unsaved Assignment draft', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('No Strategy Version assigned');
    mockedEvaluationGet.mockClear();

    await makeAssignmentDirty(user);

    expect(screen.getByText('No Strategy Version assigned')).toBeTruthy();
    expect(mockedEvaluationGet).not.toHaveBeenCalled();
  });

  it('refetches the exact trade evaluation after Assignment save and delete', async () => {
    const user = userEvent.setup();
    const { unmount } = renderModal();
    await screen.findByText('No Strategy Version assigned');
    mockedEvaluationGet.mockClear();
    await makeAssignmentDirty(user);
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    await waitFor(() => expect(mockedEvaluationGet).toHaveBeenCalledWith(101));

    unmount();
    mockedAssignmentGet.mockResolvedValue(assignment(101));
    renderModal();
    await screen.findByText('No Strategy Version assigned');
    mockedEvaluationGet.mockClear();
    await user.click(await screen.findByRole('button', { name: 'Remove Strategy' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockedEvaluationGet).toHaveBeenCalledWith(101));
  });

  it('refetches the exact trade evaluation after a Behavior save', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('No Strategy Version assigned');
    mockedEvaluationGet.mockClear();
    await makeBehaviorDirty(user, '2.25');
    await user.click(screen.getByRole('button', { name: 'Save behavior journal' }));
    await waitFor(() => expect(mockedEvaluationGet).toHaveBeenCalledWith(101));
  });

  it('keeps Behavior and Assignment drafts dirty across an evaluation refetch', async () => {
    const user = userEvent.setup();
    const { client, onClose } = renderModal();
    await makeBehaviorDirty(user, '2.75');
    await makeAssignmentDirty(user);

    await act(async () => {
      await client.invalidateQueries({ queryKey: journalQueryKeys.strategyEvaluation(101) });
    });

    expect(screen.getByLabelText<HTMLInputElement>('Planned stop percentage').value).toBe('2.75');
    expect(screen.getByLabelText<HTMLSelectElement>('Select strategy').value).toBe('1');
    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
  });

  it('blocks Behavior-only close and Keep Editing preserves the actual Behavior draft', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await screen.findByText('Not assigned');
    await makeBehaviorDirty(user, '2.5');

    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText<HTMLInputElement>('Planned stop percentage').value).toBe('2.5');

    await user.click(screen.getByTitle('Close'));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('blocks Assignment-only close and Keep Editing preserves the actual Assignment draft', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await makeAssignmentDirty(user);

    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Select strategy').value).toBe('1');
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10');
  });

  it('uses one confirmation for both dirty sections and preserves both drafts on Keep Editing', async () => {
    const user = userEvent.setup();
    renderModal();
    await makeBehaviorDirty(user, '3');
    await makeAssignmentDirty(user);

    await user.click(screen.getByTitle('Close'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText<HTMLInputElement>('Planned stop percentage').value).toBe('3');
    expect(screen.getByLabelText<HTMLSelectElement>('Select strategy').value).toBe('1');
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10');
  });

  it('keeps the Behavior close guard after Assignment is discarded locally', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await makeBehaviorDirty(user, '4');
    await makeAssignmentDirty(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Not assigned')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Planned stop percentage').value).toBe('4');

    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
  });

  it('saving Assignment only leaves the dirty Behavior close guard active', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await makeBehaviorDirty(user, '5');
    await makeAssignmentDirty(user);
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    await waitFor(() => expect(mockedAssignmentPut).toHaveBeenCalledWith(101, 10));
    expect(mockedBehaviorUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
  });

  it('saving Behavior only leaves the dirty Assignment close guard active', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await makeBehaviorDirty(user, '6');
    await makeAssignmentDirty(user);
    await user.click(screen.getByRole('button', { name: 'Save behavior journal' }));
    await screen.findByText('Saved');
    expect(mockedAssignmentPut).not.toHaveBeenCalled();

    await user.click(screen.getByTitle('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
  });

  it('closes a clean Trade Report without an unnecessary prompt', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await screen.findByText('Not assigned');
    await user.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
  });

  it('does not leak a discarded Trade A dirty flag into a later clean Trade B modal', async () => {
    const user = userEvent.setup();
    const first = renderModal(trade(101));
    await screen.findByText('Not assigned');
    await makeBehaviorDirty(user, '7');
    await user.click(screen.getByTitle('Close'));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(first.onClose).toHaveBeenCalledOnce();
    first.unmount();

    const second = renderModal(trade(202));
    await screen.findByText('Not assigned');
    await user.click(screen.getByTitle('Close'));
    expect(second.onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
  });

  it('does not infer Assignment from a representative setup_tags value', async () => {
    const user = userEvent.setup();
    renderModal(trade(101, { setup_tags: ['Breakout'] }));
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Select strategy').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('');
    expect(mockedAssignmentPut).not.toHaveBeenCalled();
    expect(mockedAssignmentGet).toHaveBeenCalledWith(101);
  });
});
