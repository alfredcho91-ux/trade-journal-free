// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserRouter } from '../../router';
import { useStore } from '../../store/useStore';
import WorkspaceExperience from './WorkspaceExperience';
import { createWorkspaceTransition, loadWorkspace, setWorkspace, type Workspace } from './workspaceSession';
import * as session from './workspaceSession';

const normal: Workspace = { mode: 'normal', profile_id: 'test-normal', first_run: true, trade_count: 0, return_url: null, period: null, credential_backend: null, fixture_version: null };
const sample: Workspace = { ...normal, mode: 'sample', profile_id: 'sample:test', first_run: false, trade_count: 36, return_url: 'http://127.0.0.1:18767/journal', period: { start: '2026-01-01', end: '2026-01-31' }, credential_backend: 'disabled', fixture_version: 1 };
const clients: QueryClient[] = [];
const client = () => { const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(value); return value; };
function setup(state: Workspace) {
  setWorkspace(state);
  return render(<QueryClientProvider client={client()}><BrowserRouter><WorkspaceExperience><p>Existing Journal page</p></WorkspaceExperience></BrowserRouter></QueryClientProvider>);
}
beforeEach(() => { useStore.setState({ language: 'en' }); window.history.replaceState(null, '', '/journal'); });
afterEach(() => { cleanup(); setWorkspace(null); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shows value and three choices before mounting exchange or trading pages', () => {
  setup(normal);
  expect(screen.getByRole('heading', { name: /Understand how you trade/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Explore with sample data' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use my own trading data' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
  expect(screen.queryByText('Existing Journal page')).toBeNull();
  expect(screen.getByText(/No exchange connection or API key/)).toBeTruthy();
});

it.each(['Skip for now', 'Use my own trading data'])('%s acknowledges locally and reaches the real Journal', async label => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ...normal, first_run: false } }) });
  vi.stubGlobal('fetch', fetcher);
  setup(normal);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByText('Existing Journal page');
  expect(fetcher).toHaveBeenCalledWith('/api/workspace/acknowledge', { method: 'POST' });
  expect(screen.getByRole('button', { name: 'Explore sample workspace' })).toBeTruthy();
});

it('returning users see their page and can reopen sample', () => {
  setup({ ...normal, first_run: false, trade_count: 20 });
  expect(screen.getByText('Existing Journal page')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Understand how you trade/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Explore sample workspace' })).toBeTruthy();
});

it('sample entry waits for the verified local destination before replacing the normal screen', async () => {
  const destinations: string[] = [];
  vi.spyOn(session, 'createWorkspaceTransition').mockReturnValue(async destination => { destinations.push(await destination); });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { url: 'http://127.0.0.1:18768/journal' } }) }));
  setup(normal);
  fireEvent.click(screen.getByRole('button', { name: 'Explore with sample data' }));
  await waitFor(() => expect(destinations).toEqual(['http://127.0.0.1:18768/journal']));
  expect(screen.queryByText('Existing Journal page')).toBeNull();
});

it.each([['Use my own data', ''], ['Reset sample', '?sample=reset']])('%s leaves the old page before navigating to the normal bootstrap', async (label, suffix) => {
  const destinations: string[] = [];
  vi.spyOn(session, 'createWorkspaceTransition').mockReturnValue(async destination => { destinations.push(await destination); });
  setup(sample);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(destinations).toEqual([sample.return_url + suffix]));
  expect(screen.queryByText('Existing Journal page')).toBeNull();
});

it('sample provenance, Journal/Guided/Review steps, exit and reset remain visible', () => {
  setup(sample);
  expect(screen.getByRole('region', { name: 'Sample workspace' })).toBeTruthy();
  expect(screen.getByText(/Synthetic trades/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '1 · Open a sample trade' }));
  expect(window.location.search).toBe('?sampleTrade=1');
  fireEvent.click(screen.getByRole('button', { name: '2 · Guided analytics' }));
  expect(window.location.search).toBe('?sampleStep=guided');
  fireEvent.click(screen.getByRole('button', { name: '3 · Review' }));
  expect(window.location.search).toBe('?sampleStep=review');
  fireEvent.click(screen.getByRole('button', { name: '4 · See the product loop' }));
  expect(screen.getByText(/Journal → Analyze → Review → Plan → Experiment → Measure/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Use my own data' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset sample' })).toBeTruthy();
});

it('unmounts the normal page while preparing sample and safely recovers a failed entry', async () => {
  let reject!: (reason: Error) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })));
  setup({ ...normal, first_run: false });
  fireEvent.click(screen.getByRole('button', { name: 'Explore sample workspace' }));
  expect(screen.queryByText('Existing Journal page')).toBeNull();
  reject(new Error('Isolated startup failed'));
  await screen.findByRole('alert');
  expect(screen.getByText('Existing Journal page')).toBeTruthy();
});

it('rejects a sample metadata response without a disabled backend', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { ...sample, credential_backend: 'keyring' } }) }));
  await expect(loadWorkspace()).rejects.toThrow('could not be verified');
});

it.each([['normal', 'sample'], ['sample', 'normal']])('late %s data cannot populate the new %s QueryClient', async (from, to) => {
  const oldClient = client(), nextClient = client();
  oldClient.setQueryData(['journal'], [from]);
  let resolve!: (rows: string[]) => void;
  const late = oldClient.fetchQuery({ queryKey: ['journal'], queryFn: () => new Promise<string[]>(done => { resolve = done; }), staleTime: 0 }).catch(() => undefined);
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  const navigation = vi.fn(() => { nextClient.setQueryData(['journal'], to === 'sample' ? ['synthetic'] : []); });
  await createWorkspaceTransition(oldClient, navigation)(Promise.resolve('http://127.0.0.1:18768/journal'));
  resolve([from]); await late;
  expect(oldClient.getQueryData(['journal'])).toBeUndefined();
  expect(nextClient.getQueryData(['journal'])).toEqual(to === 'sample' ? ['synthetic'] : []);
  expect(navigation).toHaveBeenCalledOnce();
});

it('newer workspace intent wins when an older preparation resolves last', async () => {
  const navigation = vi.fn();
  const transition = createWorkspaceTransition(client(), navigation);
  let resolve!: (url: string) => void;
  const older = transition(new Promise<string>(done => { resolve = done; }));
  await transition(Promise.resolve('http://127.0.0.1:18767/journal'));
  resolve('http://127.0.0.1:18768/journal'); await older;
  expect(navigation).toHaveBeenCalledOnce();
  expect(navigation).toHaveBeenCalledWith('http://127.0.0.1:18767/journal');
});
