// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteJournalStrategyAssignment,
  getJournalStrategyAssignment,
  putJournalStrategyAssignment,
} from '../../api/strategyAssignments';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import type { JournalStrategyAssignment, Strategy, StrategyVersion } from '../../types';
import StrategyAssignmentEditor from './StrategyAssignmentEditor';
import { journalQueryKeys } from './journalQueryKeys';
import { strategyAssignmentQueryKeys } from './strategyAssignmentQueryKeys';

vi.mock('../../api/strategyAssignments', () => ({
  getJournalStrategyAssignment: vi.fn(),
  putJournalStrategyAssignment: vi.fn(),
  deleteJournalStrategyAssignment: vi.fn(),
}));
vi.mock('../../api/strategies', () => ({
  listStrategies: vi.fn(),
  listStrategyVersions: vi.fn(),
}));

const mockedGetAssignment = vi.mocked(getJournalStrategyAssignment);
const mockedPutAssignment = vi.mocked(putJournalStrategyAssignment);
const mockedDeleteAssignment = vi.mocked(deleteJournalStrategyAssignment);
const mockedListStrategies = vi.mocked(listStrategies);
const mockedListVersions = vi.mocked(listStrategyVersions);

function strategy(id: number, overrides: Partial<Strategy> = {}): Strategy {
  return {
    id,
    name: id === 1 ? 'Breakout Momentum' : 'Mean Reversion',
    description: 'Strategy description',
    archived_at: null,
    active_version_id: id * 10,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function version(strategyId: number, id = strategyId * 10, overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  return {
    id,
    strategy_id: strategyId,
    sequence: id,
    version_label: `v${strategyId}.0`,
    description: 'Version description',
    rules: { schema_version: 1, entry_rules: [], risk_rules: [], exit_rules: [] },
    is_active: true,
    retired_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function assignment(entryId: number, overrides: Partial<JournalStrategyAssignment> = {}): JournalStrategyAssignment {
  return {
    journal_entry_id: entryId,
    strategy_version_id: 10,
    strategy_id: 1,
    strategy_name: 'Breakout Momentum',
    strategy_archived_at: null,
    version_sequence: 1,
    version_label: 'v1.0',
    version_description: 'Confirmed breakout continuation',
    version_is_active: true,
    version_retired_at: null,
    assigned_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderEditor(entryId = 101, props: { onDirtyChange?: (dirty: boolean) => void; onViewPlaybook?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <StrategyAssignmentEditor entryId={entryId} isKo={false} {...props} />
  </QueryClientProvider>);
  return { client, ...view };
}

beforeEach(() => {
  mockedGetAssignment.mockResolvedValue(null);
  mockedPutAssignment.mockImplementation(async (entryId, versionId) => assignment(entryId, {
    strategy_version_id: versionId,
    version_label: versionId === 11 ? 'v0.9' : 'v1.0',
  }));
  mockedDeleteAssignment.mockResolvedValue(null);
  mockedListStrategies.mockResolvedValue([strategy(1), strategy(2)]);
  mockedListVersions.mockImplementation(async (strategyId) => strategyId === 1
    ? [
      version(1, 10),
      version(1, 11, { version_label: 'v0.9', is_active: false, retired_at: '2026-08-01T00:00:00Z' }),
    ]
    : [version(2, 20)]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Journal Strategy Assignment frontend', () => {
  it('1. shows Not assigned as a valid state', async () => {
    renderEditor();
    expect(await screen.findByText('Not assigned')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['active', {}, 'ACTIVE'],
    ['inactive', { version_is_active: false }, 'INACTIVE'],
    ['retired', { version_is_active: false, version_retired_at: '2026-08-01T00:00:00Z' }, 'RETIRED'],
  ])('2-4. renders an assigned %s exact version and lifecycle', async (_, overrides, expected) => {
    mockedGetAssignment.mockResolvedValue(assignment(101, overrides));
    renderEditor();
    expect(await screen.findByText('Breakout Momentum')).toBeTruthy();
    expect(screen.getByText('v1.0')).toBeTruthy();
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('5. keeps an archived Strategy assignment readable and valid', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101, { strategy_archived_at: '2026-08-01T00:00:00Z' }));
    renderEditor();
    expect(await screen.findByText('ARCHIVED STRATEGY')).toBeTruthy();
    expect(screen.getByText('Breakout Momentum')).toBeTruthy();
    expect(screen.queryByText(/invalid/i)).toBeNull();
  });

  it('6-9. enters edit mode, loads scoped Versions, preselects active locally, and does not autosave', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(mockedListVersions).toHaveBeenCalledWith(1));
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10');
    expect(mockedPutAssignment).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'v0.9 · RETIRED' })).toBeTruthy();
  });

  it('10, 12-13. selects a retired Version, saves its exact id, and displays the server response', async () => {
    mockedPutAssignment.mockResolvedValue(assignment(101, {
      strategy_version_id: 11,
      version_label: 'v0.9',
      version_is_active: false,
      version_retired_at: '2026-08-01T00:00:00Z',
    }));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.selectOptions(screen.getByLabelText('Select version'), '11');
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    await waitFor(() => expect(mockedPutAssignment).toHaveBeenCalledWith(101, 11));
    expect(await screen.findByText('v0.9')).toBeTruthy();
    expect(screen.getByText('RETIRED')).toBeTruthy();
  });

  it('11. exposes an archived Strategy, saves its historical Version, and renders valid provenance', async () => {
    const archivedVersion = version(3, 30, {
      version_label: 'legacy-v1',
      is_active: false,
      retired_at: '2026-08-15T00:00:00Z',
    });
    mockedListStrategies.mockImplementation(async (includeArchived) => includeArchived
      ? [strategy(1), strategy(3, { name: 'Legacy Scalping', archived_at: '2026-08-01T00:00:00Z' })]
      : [strategy(1)]);
    mockedListVersions.mockImplementation(async (strategyId) => strategyId === 3 ? [archivedVersion] : [version(1, 10)]);
    mockedPutAssignment.mockResolvedValue(assignment(101, {
      strategy_id: 3,
      strategy_name: 'Legacy Scalping',
      strategy_archived_at: '2026-08-01T00:00:00Z',
      strategy_version_id: 30,
      version_label: 'legacy-v1',
      version_is_active: false,
      version_retired_at: '2026-08-15T00:00:00Z',
    }));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    expect(screen.queryByRole('option', { name: /Legacy Scalping/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Show archived strategies' }));
    expect(await screen.findByRole('option', { name: 'Legacy Scalping · ARCHIVED' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Select strategy'), '3');
    await waitFor(() => expect(screen.getByRole('option', { name: 'legacy-v1 · RETIRED' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Select version'), '30');
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    await waitFor(() => expect(mockedPutAssignment).toHaveBeenCalledWith(101, 30));
    expect(await screen.findByText('Legacy Scalping')).toBeTruthy();
    expect(screen.getByText('legacy-v1')).toBeTruthy();
    expect(screen.getByText('RETIRED')).toBeTruthy();
    expect(screen.getByText('ARCHIVED STRATEGY')).toBeTruthy();
    expect(mockedListStrategies).toHaveBeenCalledWith(true);
  });

  it('14. disables Save when the persisted Version is unchanged', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    expect((await screen.findByRole('button', { name: 'Save Strategy' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    expect(mockedPutAssignment).not.toHaveBeenCalled();
  });

  it('15-16. confirms before DELETE and renders Not assigned after success', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101));
    const user = userEvent.setup();
    const { client } = renderEditor();
    client.setQueryData(journalQueryKeys.strategyEvaluation(101), { stable: true });
    await user.click(await screen.findByRole('button', { name: 'Remove Strategy' }));
    expect(mockedDeleteAssignment).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Remove Strategy assignment' });
    expect(within(dialog).getByText(/trade and Playbook Strategy will not be deleted/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockedDeleteAssignment).toHaveBeenCalledWith(101));
    expect(await screen.findByText('Not assigned')).toBeTruthy();
    expect(client.getQueryState(journalQueryKeys.strategyEvaluation(101))?.isInvalidated).toBe(true);
  });

  it('17. keeps a dirty editor open and shows a PUT failure', async () => {
    mockedPutAssignment.mockRejectedValue(new Error('Version no longer exists'));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    expect(await screen.findByText('Version no longer exists')).toBeTruthy();
    expect(screen.getByLabelText('Select version')).toBeTruthy();
  });

  it('18. shows a DELETE failure without removing provenance', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101));
    mockedDeleteAssignment.mockRejectedValue(new Error('Network unavailable'));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Remove Strategy' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Remove Strategy assignment' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Network unavailable')).toBeTruthy();
    expect(screen.getByText('Breakout Momentum')).toBeTruthy();
  });

  it('19. makes a GET failure visible and retryable', async () => {
    mockedGetAssignment.mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    renderEditor();
    expect(await screen.findByText('Server unavailable')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Not assigned')).toBeTruthy();
    expect(mockedGetAssignment).toHaveBeenCalledTimes(2);
  });

  it('20. prevents a stale Trade A GET response from hydrating Trade B', async () => {
    const tradeA = deferred<JournalStrategyAssignment | null>();
    mockedGetAssignment.mockImplementation((entryId) => entryId === 101 ? tradeA.promise : Promise.resolve(assignment(202, { strategy_name: 'Mean Reversion', strategy_id: 2, strategy_version_id: 20, version_label: 'v2.0' })));
    const { rerender, client } = renderEditor(101);
    rerender(<QueryClientProvider client={client}><StrategyAssignmentEditor entryId={202} isKo={false} /></QueryClientProvider>);
    expect(await screen.findByText('Mean Reversion')).toBeTruthy();
    tradeA.resolve(assignment(101));
    await act(async () => undefined);
    expect(screen.getByText('Mean Reversion')).toBeTruthy();
    expect(screen.queryByText('Breakout Momentum')).toBeNull();
  });

  it('21. prevents stale Strategy A Versions from populating Strategy B', async () => {
    const versionsA = deferred<StrategyVersion[]>();
    mockedListVersions.mockImplementation((strategyId) => strategyId === 1 ? versionsA.promise : Promise.resolve([version(2, 20)]));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await user.selectOptions(screen.getByLabelText('Select strategy'), '2');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('20'));
    versionsA.resolve([version(1, 10)]);
    await act(async () => undefined);
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('20');
    expect(screen.queryByRole('option', { name: 'v1.0 · ACTIVE' })).toBeNull();
  });

  it('22. preserves a dirty Version draft through a background assignment refresh', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101));
    const user = userEvent.setup();
    const { client } = renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.selectOptions(screen.getByLabelText('Select version'), '11');
    mockedGetAssignment.mockResolvedValue(assignment(101));
    await act(async () => { await client.refetchQueries({ queryKey: strategyAssignmentQueryKeys.detail(101) }); });
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('11');
  });

  it('23. reports dirty state and prevents silent cancellation', async () => {
    const onDirtyChange = vi.fn();
    const user = userEvent.setup();
    renderEditor(101, { onDirtyChange });
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    expect(screen.getByLabelText('Select version')).toBeTruthy();
  });

  it('24. lets a late Trade A save update only A cache, never selected Trade B', async () => {
    const saveA = deferred<JournalStrategyAssignment>();
    mockedPutAssignment.mockImplementation((entryId) => entryId === 101 ? saveA.promise : Promise.resolve(assignment(entryId)));
    const user = userEvent.setup();
    const { rerender, client } = renderEditor(101);
    client.setQueryData(journalQueryKeys.strategyEvaluation(101), { trade: 'A' });
    client.setQueryData(journalQueryKeys.strategyEvaluation(202), { trade: 'B' });
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    rerender(<QueryClientProvider client={client}><StrategyAssignmentEditor entryId={202} isKo={false} /></QueryClientProvider>);
    expect(await screen.findByText('Not assigned')).toBeTruthy();
    saveA.resolve(assignment(101));
    await act(async () => undefined);
    expect(screen.getByText('Not assigned')).toBeTruthy();
    expect(client.getQueryData(strategyAssignmentQueryKeys.detail(101))).toEqual(assignment(101));
    expect(client.getQueryData(strategyAssignmentQueryKeys.detail(202))).toBeNull();
    expect(client.getQueryState(journalQueryKeys.strategyEvaluation(101))?.isInvalidated).toBe(true);
    expect(client.getQueryState(journalQueryKeys.strategyEvaluation(202))?.isInvalidated).toBe(false);
    expect(client.getQueryData(journalQueryKeys.strategyEvaluation(202))).toEqual({ trade: 'B' });
  });

  it('25. never infers from setup-like text and requires explicit Strategy selection', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    expect(screen.getByLabelText<HTMLSelectElement>('Select strategy').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('');
    expect(mockedPutAssignment).not.toHaveBeenCalled();
  });

  it('26-27. uses a separate mutation and only writes the scoped assignment cache', async () => {
    const user = userEvent.setup();
    const { client } = renderEditor();
    client.setQueryData(['journal-performance'], { stable: true });
    client.setQueryData(['trade-analysis'], { stable: true });
    client.setQueryData(journalQueryKeys.strategyEvaluation(101), { stable: true });
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    await screen.findByText('Breakout Momentum');
    expect(mockedPutAssignment).toHaveBeenCalledWith(101, 10);
    expect(client.getQueryData(['journal-performance'])).toEqual({ stable: true });
    expect(client.getQueryData(['trade-analysis'])).toEqual({ stable: true });
    expect(client.getQueryState(journalQueryKeys.strategyEvaluation(101))?.isInvalidated).toBe(true);
  });

  it('28. opens the assigned Strategy in Playbook through the supplied navigation boundary', async () => {
    mockedGetAssignment.mockResolvedValue(assignment(101));
    const onViewPlaybook = vi.fn();
    const user = userEvent.setup();
    renderEditor(101, { onViewPlaybook });
    await user.click(await screen.findByRole('button', { name: 'View in Playbook' }));
    expect(onViewPlaybook).toHaveBeenCalledOnce();
  });

  it('locks assignment controls while an explicit save is pending', async () => {
    const pendingSave = deferred<JournalStrategyAssignment>();
    mockedPutAssignment.mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'Assign Strategy' }));
    await user.selectOptions(screen.getByLabelText('Select strategy'), '1');
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Select version').value).toBe('10'));
    await user.click(screen.getByRole('button', { name: 'Save Strategy' }));
    expect((screen.getByLabelText('Select strategy') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Select version') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
    pendingSave.resolve(assignment(101));
  });
});
