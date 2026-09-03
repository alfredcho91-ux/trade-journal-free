// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { ApiClientError } from '../api/config';
import {
  activateStrategyVersion,
  archiveStrategy,
  createStrategy,
  createStrategyVersion,
  getStrategy,
  listStrategies,
  listStrategyVersions,
  restoreStrategy,
  retireStrategyVersion,
  updateStrategy,
} from '../api/strategies';
import { cloneRules, newRule } from '../features/playbook/strategyDraft';
import { strategyQueryKeys } from '../features/playbook/strategyQueryKeys';
import { useStore } from '../store/useStore';
import type { Strategy, StrategyRuleDocument, StrategyVersion } from '../types';
import PlaybookPage from './PlaybookPage';

vi.mock('../api/strategies', () => ({
  listStrategies: vi.fn(), getStrategy: vi.fn(), createStrategy: vi.fn(), updateStrategy: vi.fn(),
  archiveStrategy: vi.fn(), restoreStrategy: vi.fn(), listStrategyVersions: vi.fn(), getStrategyVersion: vi.fn(),
  createStrategyVersion: vi.fn(), activateStrategyVersion: vi.fn(), retireStrategyVersion: vi.fn(),
}));

const mockedList = vi.mocked(listStrategies);
const mockedGet = vi.mocked(getStrategy);
const mockedVersions = vi.mocked(listStrategyVersions);
const mockedCreate = vi.mocked(createStrategy);
const mockedUpdate = vi.mocked(updateStrategy);
const mockedArchive = vi.mocked(archiveStrategy);
const mockedRestore = vi.mocked(restoreStrategy);
const mockedCreateVersion = vi.mocked(createStrategyVersion);
const mockedActivate = vi.mocked(activateStrategyVersion);
const mockedRetire = vi.mocked(retireStrategyVersion);

const rules: StrategyRuleDocument = {
  schema_version: 1,
  entry_rules: [{ id: 'entry-breakout', text: 'Confirm resistance breakout' }],
  risk_rules: [{ id: 'risk-one-percent', text: 'Risk no more than one percent' }],
  exit_rules: [{ id: 'exit-structure', text: 'Exit on structural invalidation' }],
};

function strategy(id: number, overrides: Partial<Strategy> = {}): Strategy {
  return { id, name: id === 1 ? 'Breakout Momentum' : 'Mean Reversion', description: id === 1 ? 'Confirmed breakout continuation' : 'Fade market extension', archived_at: null, active_version_id: id * 10, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...overrides };
}

function version(strategyId: number, id = strategyId * 10, overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  return { id, strategy_id: strategyId, sequence: id, version_label: `v${strategyId}.0`, description: 'Current version', rules: cloneRules(rules), is_active: true, retired_at: null, created_at: '2026-09-03T00:00:00Z', ...overrides };
}

function setupDefault(items = [strategy(1), strategy(2)]) {
  mockedList.mockResolvedValue(items);
  mockedGet.mockImplementation(async (id) => items.find((item) => item.id === id) ?? strategy(id));
  mockedVersions.mockImplementation(async (id) => [version(id)]);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><PlaybookPage /></QueryClientProvider>);
  return { client, ...view };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useStore.setState({ language: 'en' });
  window.history.replaceState(null, '', '/playbook');
  setupDefault();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Playbook frontend acceptance', () => {
  it('1. renders the /playbook route and navigation item', async () => {
    mockedList.mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Playbook' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Playbook' }).length).toBeGreaterThan(0);
  });

  it('2. renders the Strategy library', async () => {
    renderPage();
    expect(await screen.findByText('Breakout Momentum')).toBeTruthy();
    expect(screen.getByText('Mean Reversion')).toBeTruthy();
  });

  it('3. loads the selected Strategy detail', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Mean Reversion/ }));
    expect((await screen.findAllByText('Fade market extension')).length).toBeGreaterThan(0);
    expect(mockedGet).toHaveBeenCalledWith(2);
  });

  it('4. prevents a stale A response from hydrating B', async () => {
    const aDetail = deferred<Strategy>();
    const aVersions = deferred<StrategyVersion[]>();
    mockedGet.mockImplementation((id) => id === 1 ? aDetail.promise : Promise.resolve(strategy(2)));
    mockedVersions.mockImplementation((id) => id === 1 ? aVersions.promise : Promise.resolve([version(2, 20, { rules: { ...cloneRules(rules), entry_rules: [{ id: 'b-rule', text: 'B selected rule' }] } })]));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Mean Reversion/ }));
    expect((await screen.findAllByText('Fade market extension')).length).toBeGreaterThan(0);
    aDetail.resolve(strategy(1));
    aVersions.resolve([version(1)]);
    await act(async () => undefined);
    expect(screen.getAllByText('Fade market extension').length).toBeGreaterThan(0);
    expect(screen.getByText('B selected rule')).toBeTruthy();
    expect(screen.queryByText('Confirm resistance breakout')).toBeNull();
  });

  it('5. creates a Strategy with its initial Version', async () => {
    const created = strategy(3, { name: 'Trend Following' });
    mockedList.mockResolvedValueOnce([strategy(1), strategy(2)]).mockResolvedValue([strategy(1), strategy(2), created]);
    mockedCreate.mockResolvedValue(created);
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'New Strategy' }))[0]);
    await user.type(screen.getByLabelText('Strategy name'), 'Trend Following');
    await user.type(screen.getByLabelText('Initial version label'), 'v1.0');
    await user.click(screen.getByRole('button', { name: 'Create Strategy' }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
    expect(mockedCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'Trend Following', initial_version: expect.objectContaining({ version_label: 'v1.0', rules: expect.objectContaining({ schema_version: 1 }) }) }));
  });

  it('6. surfaces a duplicate-name 409 message', async () => {
    mockedCreate.mockRejectedValue(new Error('Strategy name already exists'));
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'New Strategy' }))[0]);
    await user.type(screen.getByLabelText('Strategy name'), 'Breakout Momentum');
    await user.type(screen.getByLabelText('Initial version label'), 'v2');
    await user.click(screen.getByRole('button', { name: 'Create Strategy' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Strategy name already exists');
  });

  it('7. updates Strategy metadata only', async () => {
    mockedUpdate.mockResolvedValue(strategy(1, { name: 'Breakout Pro' }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Strategy' }));
    const name = screen.getByLabelText('Strategy name');
    await user.clear(name); await user.type(name, 'Breakout Pro');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith(1, { name: 'Breakout Pro', description: 'Confirmed breakout continuation' }));
  });

  it('8. archives without deleting history', async () => {
    mockedArchive.mockResolvedValue(strategy(1, { archived_at: '2026-09-03T00:00:00Z', active_version_id: null }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(screen.getByText(/does not delete anything/)).toBeTruthy();
    await user.click(within(screen.getByRole('dialog', { name: 'Archive Strategy' })).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(mockedArchive).toHaveBeenCalledWith(1));
  });

  it('9. restores without choosing an active Version', async () => {
    const archived = strategy(1, { archived_at: '2026-09-01T00:00:00Z', active_version_id: null });
    setupDefault([archived]); mockedRestore.mockResolvedValue(strategy(1, { active_version_id: null }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Restore Strategy' })).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mockedRestore).toHaveBeenCalledWith(1));
  });

  it('10. supports a no-active-Version state', async () => {
    setupDefault([strategy(1, { active_version_id: null })]); mockedVersions.mockResolvedValue([version(1, 11, { is_active: false })]);
    renderPage();
    expect((await screen.findAllByText('No active version')).length).toBeGreaterThan(0);
    expect(await screen.findByText('v1.0')).toBeTruthy();
  });

  it('11. orders Version history by sequence descending', async () => {
    mockedVersions.mockResolvedValue([version(1, 11, { sequence: 1, version_label: 'v1.0', is_active: false }), version(1, 12, { sequence: 2, version_label: 'v1.1' })]);
    renderPage();
    await screen.findAllByText('v1.1');
    const rows = await screen.findAllByRole('button');
    const versionRows = rows.filter((row) => row.textContent?.includes('v1.'));
    expect(versionRows[0].textContent).toContain('v1.1');
  });

  it('12. displays rules for the selected Version', async () => {
    const user = userEvent.setup();
    mockedVersions.mockResolvedValue([version(1, 12, { version_label: 'v1.1', rules: { ...cloneRules(rules), entry_rules: [{ id: 'new', text: 'New selected rule' }] } }), version(1, 11, { version_label: 'v1.0', is_active: false })]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /v1.0/ }));
    expect(await screen.findByText('Confirm resistance breakout')).toBeTruthy();
  });

  it('13. makes persisted Version definitions explicitly read-only', async () => {
    renderPage();
    expect(await screen.findByText('READ ONLY')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit Version/i })).toBeNull();
  });

  it('14. creates a new Version', async () => {
    mockedCreateVersion.mockResolvedValue(version(1, 12, { version_label: 'v1.1', is_active: false }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    await user.type(screen.getByLabelText('Version label'), 'v1.1');
    await user.click(screen.getByRole('button', { name: 'Create Version' }));
    await waitFor(() => expect(mockedCreateVersion).toHaveBeenCalledWith(1, expect.objectContaining({ version_label: 'v1.1' })));
  });

  it('15. clone preserves existing rule IDs', () => {
    const cloned = cloneRules(rules);
    cloned.entry_rules[0].text = 'Edited text';
    expect(cloned.entry_rules[0].id).toBe('entry-breakout');
  });

  it('16. a new rule receives a new stable ID', () => {
    const added = newRule('entry_rules', rules.entry_rules);
    expect(added.id).toMatch(/^entry-/);
    expect(added.id).not.toBe('entry-breakout');
  });

  it('17. cloning and editing leaves the source Version untouched', () => {
    const source = cloneRules(rules); const cloned = cloneRules(source);
    cloned.entry_rules[0].text = 'Changed'; cloned.risk_rules.splice(0, 1);
    expect(source).toEqual(rules);
  });

  it('18. activates a Version through its lifecycle endpoint', async () => {
    mockedVersions.mockResolvedValue([version(1, 11, { is_active: false })]); mockedActivate.mockResolvedValue(version(1, 11));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Activate' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Activate Version' })).getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(mockedActivate).toHaveBeenCalledWith(1, 11));
  });

  it('19. retires a Version through its lifecycle endpoint', async () => {
    mockedRetire.mockResolvedValue(version(1, 10, { is_active: false, retired_at: 'now' }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Retire Version' })).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(mockedRetire).toHaveBeenCalledWith(1, 10));
  });

  it('20. disables conflicting lifecycle controls while a mutation is pending', async () => {
    const pending = deferred<StrategyVersion>(); mockedRetire.mockReturnValue(pending.promise);
    mockedVersions.mockResolvedValue([version(1, 11, { is_active: false })]);
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Retire Version' })).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Activate' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Retire' }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve(version(1, 11, { retired_at: 'now', is_active: false }));
  });

  it('21. keeps a dirty New Version draft through a background refresh', async () => {
    const user = userEvent.setup(); const { client } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    await user.type(screen.getByLabelText('Version label'), 'v-local');
    const entry = screen.getByLabelText('Entry rules 1'); await user.clear(entry); await user.type(entry, 'Unsaved local rule');
    act(() => client.setQueryData(strategyQueryKeys.versions(1), [version(1, 99, { version_label: 'remote' })]));
    expect((screen.getByLabelText('Version label') as HTMLInputElement).value).toBe('v-local');
    expect((screen.getByLabelText('Entry rules 1') as HTMLInputElement).value).toBe('Unsaved local rule');
  });

  it('22. requires confirmation before switching Strategy with unsaved changes', async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    await user.type(screen.getByLabelText('Version label'), 'dirty');
    await user.click(screen.getByRole('button', { name: /Mean Reversion/ }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'New Version' })).toBeTruthy();
  });

  it('23. renders a loading state', () => {
    mockedList.mockReturnValue(new Promise(() => undefined)); renderPage();
    expect(screen.getByText('Loading strategies...')).toBeTruthy();
  });

  it('24. renders the empty state and creation action', async () => {
    mockedList.mockResolvedValue([]); renderPage();
    expect(await screen.findByText('No strategies yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Strategy' })).toBeTruthy();
  });

  it('25. renders an API error state with retry', async () => {
    mockedList.mockRejectedValue(new Error('Network unavailable')); renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('exposes archived Strategies when the active-only repository is empty', async () => {
    const archived = strategy(1, { archived_at: '2026-09-01T00:00:00Z', active_version_id: null });
    mockedList.mockImplementation(async (includeArchived) => includeArchived ? [archived] : []);
    mockedGet.mockResolvedValue(archived);
    mockedVersions.mockResolvedValue([version(1, 10, { is_active: false })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Show archived' }));
    const archivedRow = await screen.findByRole('button', { name: /Breakout Momentum.*ARCHIVED/ });
    expect(archivedRow).toBeTruthy();
    await user.click(archivedRow);
    expect(await screen.findByRole('heading', { name: 'Breakout Momentum' })).toBeTruthy();
    expect(mockedList).toHaveBeenCalledWith(true);
  });

  function versionBases() {
    const current = version(1, 13, { sequence: 3, version_label: 'v1.3', description: 'Current base', is_active: true });
    const older = version(1, 12, {
      sequence: 2,
      version_label: 'v1.2',
      description: 'Older base',
      is_active: false,
      rules: { ...cloneRules(rules), entry_rules: [{ id: 'older-entry', text: 'Older base entry rule' }] },
    });
    setupDefault([strategy(1, { active_version_id: current.id })]);
    mockedVersions.mockResolvedValue([current, older]);
    return { current, older };
  }

  it('asks for confirmation before a dirty base-Version switch', async () => {
    versionBases();
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    await user.clear(screen.getByLabelText('Version description'));
    await user.type(screen.getByLabelText('Version description'), 'Unsaved description');
    await user.selectOptions(screen.getByLabelText('Based on'), '12');

    expect(screen.getByRole('dialog', { name: 'Change base version' })).toBeTruthy();
  });

  it('keeps the original base and draft when Keep Editing is chosen', async () => {
    versionBases();
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    const description = screen.getByLabelText('Version description');
    await user.clear(description); await user.type(description, 'Unsaved description');
    await user.selectOptions(screen.getByLabelText('Based on'), '12');
    await user.click(screen.getByRole('button', { name: 'Keep Editing' }));

    expect((screen.getByLabelText('Based on') as HTMLSelectElement).value).toBe('13');
    expect((screen.getByLabelText('Version description') as HTMLTextAreaElement).value).toBe('Unsaved description');
    expect((screen.getByLabelText('Entry rules 1') as HTMLInputElement).value).toBe('Confirm resistance breakout');
  });

  it('replaces the draft from the chosen base after Discard and Switch', async () => {
    versionBases();
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'New Version' }));
    await user.clear(screen.getByLabelText('Entry rules 1'));
    await user.type(screen.getByLabelText('Entry rules 1'), 'Unsaved entry rule');
    await user.selectOptions(screen.getByLabelText('Based on'), '12');
    await user.click(screen.getByRole('button', { name: 'Discard and Switch' }));

    expect((screen.getByLabelText('Based on') as HTMLSelectElement).value).toBe('12');
    expect((screen.getByLabelText('Version description') as HTMLTextAreaElement).value).toBe('Older base');
    expect((screen.getByLabelText('Entry rules 1') as HTMLInputElement).value).toBe('Older base entry rule');
  });

  it('shows a contextual Strategy lifecycle 409 failure', async () => {
    mockedArchive.mockRejectedValue(new ApiClientError('Strategy cannot be archived now', { status: 409 }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Archive Strategy' })).getByRole('button', { name: 'Archive' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Archive Strategy failed · Breakout Momentum');
    expect(alert.textContent).toContain('Strategy cannot be archived now');
  });

  it('shows a contextual Version lifecycle 422 failure', async () => {
    mockedVersions.mockResolvedValue([version(1, 11, { is_active: false })]);
    mockedActivate.mockRejectedValue(new ApiClientError('Version cannot be activated', { status: 422 }));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Activate' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Activate Version' })).getByRole('button', { name: 'Activate' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Activate Version failed · v1.0');
    expect(alert.textContent).toContain('Version cannot be activated');
  });

  it('shows a network failure without pretending retirement succeeded', async () => {
    mockedRetire.mockRejectedValue(new Error('Network unavailable'));
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Retire Version' })).getByRole('button', { name: 'Retire' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
    expect(await screen.findByText('READ ONLY')).toBeTruthy();
    expect(mockedVersions).toHaveBeenCalled();
  });

  it('selects the returned first Strategy before its list refetch resolves', async () => {
    const created = strategy(7, { name: 'First Strategy', description: 'First reusable strategy', active_version_id: 70 });
    const refetch = deferred<Strategy[]>();
    mockedList.mockResolvedValueOnce([]).mockReturnValueOnce(refetch.promise);
    mockedCreate.mockResolvedValue(created);
    mockedGet.mockResolvedValue(created);
    mockedVersions.mockResolvedValue([version(7, 70)]);
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create Strategy' }));
    await user.type(screen.getByLabelText('Strategy name'), 'First Strategy');
    await user.type(screen.getByLabelText('Initial version label'), 'v1.0');
    await user.click(within(screen.getByRole('dialog', { name: 'New Strategy' })).getByRole('button', { name: 'Create Strategy' }));

    expect(await screen.findByRole('heading', { name: 'First Strategy' })).toBeTruthy();
    refetch.resolve([created]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'First Strategy' })).toBeTruthy());
  });

  it('deterministically selects a newly created Strategy while another is selected', async () => {
    const first = strategy(1);
    const created = strategy(2, { name: 'Strategy B', description: 'Second reusable strategy' });
    mockedList.mockResolvedValueOnce([first]).mockResolvedValue([first, created]);
    mockedCreate.mockResolvedValue(created);
    mockedGet.mockImplementation(async (id) => id === created.id ? created : first);
    const user = userEvent.setup(); renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'New Strategy' }))[0]);
    await user.type(screen.getByLabelText('Strategy name'), 'Strategy B');
    await user.type(screen.getByLabelText('Initial version label'), 'v1.0');
    await user.click(screen.getByRole('button', { name: 'Create Strategy' }));

    expect(await screen.findByRole('heading', { name: 'Strategy B' })).toBeTruthy();
  });

  it('keeps Strategy B selected when a mutation for A resolves late', async () => {
    const update = deferred<Strategy>(); mockedUpdate.mockReturnValue(update.promise);
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Strategy' }));
    await user.type(screen.getByLabelText('Strategy description'), ' pending');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await user.click(screen.getByRole('button', { name: /Mean Reversion/ }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    update.resolve(strategy(1, { description: 'updated A' }));
    await waitFor(() => expect(screen.getAllByText('Fade market extension').length).toBeGreaterThan(0));
  });
});
