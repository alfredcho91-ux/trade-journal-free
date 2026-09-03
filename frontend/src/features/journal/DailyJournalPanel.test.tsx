// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDailyJournal, saveDailyJournal } from '../../api/journal';
import type { DailyJournalEntry } from '../../types';
import { journalQueryKeys } from './journalQueryKeys';
import { localToday, shiftLocalDate } from './dailyJournalForm';
import DailyJournalPanel from './DailyJournalPanel';

vi.mock('../../api/journal', () => ({
  getDailyJournal: vi.fn(),
  saveDailyJournal: vi.fn(),
}));

const mockedGet = vi.mocked(getDailyJournal);
const mockedSave = vi.mocked(saveDailyJournal);

function renderPanel(isKo = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><DailyJournalPanel isKo={isKo} /></QueryClientProvider>);
  return { client, ...view };
}

function dailyEntry(overrides: Partial<DailyJournalEntry> = {}): DailyJournalEntry {
  return {
    id: 1,
    trade_date: localToday(),
    market_bias: null,
    session_plan: null,
    max_daily_loss: null,
    max_trade_count: null,
    pre_session_notes: null,
    post_session_notes: null,
    what_went_well: null,
    what_went_wrong: null,
    next_focus: null,
    created_at: 'created',
    updated_at: 'updated',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockedGet.mockReset();
  mockedSave.mockReset();
});

describe('DailyJournalPanel', () => {
  it('shows a loading state and then an empty bilingual form', async () => {
    let resolveLoad: ((value: null) => void) | undefined;
    mockedGet.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    renderPanel();
    expect(screen.getByText('Loading daily journal...')).toBeTruthy();
    resolveLoad?.(null);
    await screen.findByLabelText('Market bias');
    cleanup();

    mockedGet.mockResolvedValue(null);
    renderPanel(true);
    await screen.findByLabelText('시장 관점');
    expect(screen.getByRole('heading', { name: '세션 전' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '세션 후' })).toBeTruthy();
  });

  it('loads an existing journal and explicitly clears a recorded field', async () => {
    const today = localToday();
    const existing = {
      id: 2,
      trade_date: today,
      market_bias: 'Bearish',
      session_plan: 'Wait for resistance',
      max_daily_loss: 75,
      max_trade_count: 2,
      pre_session_notes: null,
      post_session_notes: null,
      what_went_well: null,
      what_went_wrong: null,
      next_focus: null,
      created_at: 'created',
      updated_at: 'updated',
    };
    mockedGet.mockResolvedValue(existing);
    mockedSave.mockResolvedValue({ ...existing, session_plan: null });
    const user = userEvent.setup();
    renderPanel();
    expect((await screen.findByLabelText('Market bias') as HTMLInputElement).value).toBe('Bearish');
    const plan = screen.getByLabelText('Session plan');
    await user.clear(plan);
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    expect(mockedSave).toHaveBeenCalledWith(today, { session_plan: null });
    await screen.findByText('Saved');
  });

  it('guards date navigation and never autosaves dirty input', async () => {
    mockedGet.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByLabelText('Market bias');
    const dateInput = screen.getByLabelText('Journal date') as HTMLInputElement;
    const today = localToday();
    expect(dateInput.value).toBe(today);

    await user.type(screen.getByLabelText('Market bias'), 'Bullish');
    await user.click(screen.getByRole('button', { name: 'Next date' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(dateInput.value).toBe(today);
    expect(mockedSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Next date' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(dateInput.value).toBe(shiftLocalDate(today, 1)));
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('saves the same date record with only edited fields', async () => {
    mockedGet.mockResolvedValue(null);
    const today = localToday();
    mockedSave.mockResolvedValue({
      id: 1,
      trade_date: today,
      market_bias: 'Neutral',
      session_plan: null,
      max_daily_loss: null,
      max_trade_count: null,
      pre_session_notes: null,
      post_session_notes: null,
      what_went_well: null,
      what_went_wrong: null,
      next_focus: null,
      created_at: 'created',
      updated_at: 'updated',
    });
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText('Market bias'), 'Neutral');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));

    expect(mockedSave).toHaveBeenCalledWith(today, { market_bias: 'Neutral' });
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  });

  it('keeps dirty input when refreshed data arrives for the same date', async () => {
    const today = localToday();
    mockedGet.mockResolvedValue(dailyEntry({ market_bias: 'Initial server value' }));
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.clear(bias);
    await user.type(bias, 'Unsaved local value');

    act(() => {
      client.setQueryData(
        journalQueryKeys.dailyDate(today),
        dailyEntry({ market_bias: 'Refreshed server value' }),
      );
    });

    expect((screen.getByLabelText('Market bias') as HTMLInputElement).value).toBe('Unsaved local value');
  });

  it('hydrates refreshed data for the same date while the form is clean', async () => {
    const today = localToday();
    mockedGet.mockResolvedValue(dailyEntry({ market_bias: 'Initial server value' }));
    const { client } = renderPanel();
    expect((await screen.findByLabelText('Market bias') as HTMLInputElement).value).toBe('Initial server value');

    act(() => {
      client.setQueryData(
        journalQueryKeys.dailyDate(today),
        dailyEntry({ market_bias: 'Refreshed server value' }),
      );
    });

    await waitFor(() => expect((screen.getByLabelText('Market bias') as HTMLInputElement).value).toBe('Refreshed server value'));
  });

  it('preserves edits made after a save request starts', async () => {
    mockedGet.mockResolvedValue(null);
    let resolveSave: ((value: DailyJournalEntry) => void) | undefined;
    mockedSave.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText('Market bias'), 'Bullish');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await user.type(screen.getByLabelText('Session plan'), 'Wait for confirmation');

    await act(async () => {
      resolveSave?.(dailyEntry({ market_bias: 'Bullish' }));
    });

    expect((screen.getByLabelText('Session plan') as HTMLTextAreaElement).value).toBe('Wait for confirmation');
    expect((screen.getByRole('button', { name: 'Save daily journal' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('treats save success as canonical over query data deferred while dirty', async () => {
    const today = localToday();
    const savedRecord = dailyEntry({ market_bias: 'Saved canonical value' });
    mockedGet.mockResolvedValue(dailyEntry({ market_bias: 'Server D0' }));
    mockedSave.mockResolvedValue(savedRecord);
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.clear(bias);
    await user.type(bias, 'Draft to save');

    act(() => {
      client.setQueryData(
        journalQueryKeys.dailyDate(today),
        dailyEntry({ market_bias: 'Deferred server D1' }),
      );
    });
    expect((bias as HTMLInputElement).value).toBe('Draft to save');

    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await waitFor(() => expect((bias as HTMLInputElement).value).toBe('Saved canonical value'));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Saved')).toBeTruthy();
    expect((bias as HTMLInputElement).value).toBe('Saved canonical value');
    expect(client.getQueryData(journalQueryKeys.dailyDate(today))).toEqual(savedRecord);
  });

  it('cancels a stale GET that resolves after save and keeps the saved cache state', async () => {
    const today = localToday();
    const savedRecord = dailyEntry({ market_bias: 'Saved S' });
    let resolveOldGet: ((value: DailyJournalEntry) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    mockedGet
      .mockResolvedValueOnce(dailyEntry({ market_bias: 'Server D0' }))
      .mockImplementationOnce((_tradeDate, signal) => {
        oldSignal = signal;
        return new Promise((resolve) => { resolveOldGet = resolve; });
      });
    mockedSave.mockResolvedValue(savedRecord);
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');

    let refetchPromise: Promise<void> | undefined;
    act(() => {
      refetchPromise = client.refetchQueries({ queryKey: journalQueryKeys.dailyDate(today), exact: true });
    });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await user.clear(bias);
    await user.type(bias, 'Draft to save');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await waitFor(() => expect((bias as HTMLInputElement).value).toBe('Saved S'));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      resolveOldGet?.(dailyEntry({ market_bias: 'Stale D1' }));
      await refetchPromise;
    });

    expect((bias as HTMLInputElement).value).toBe('Saved S');
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(client.getQueryData(journalQueryKeys.dailyDate(today))).toEqual(savedRecord);
  });

  it('cancels a GET started while PUT is pending before accepting the save response', async () => {
    const today = localToday();
    const savedRecord = dailyEntry({ market_bias: 'Saved S' });
    let resolveSave: ((value: DailyJournalEntry) => void) | undefined;
    let resolveOldGet: ((value: DailyJournalEntry) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    mockedGet
      .mockResolvedValueOnce(dailyEntry({ market_bias: 'Server D0' }))
      .mockImplementationOnce((_tradeDate, signal) => {
        oldSignal = signal;
        return new Promise((resolve) => { resolveOldGet = resolve; });
      });
    mockedSave.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.clear(bias);
    await user.type(bias, 'Draft to save');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));

    let refetchPromise: Promise<void> | undefined;
    act(() => {
      refetchPromise = client.refetchQueries({ queryKey: journalQueryKeys.dailyDate(today), exact: true });
    });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(false);

    await act(async () => {
      resolveSave?.(savedRecord);
    });
    await waitFor(() => expect((bias as HTMLInputElement).value).toBe('Saved S'));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      resolveOldGet?.(dailyEntry({ market_bias: 'Stale D1' }));
      await refetchPromise;
    });

    expect((bias as HTMLInputElement).value).toBe('Saved S');
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(client.getQueryData(journalQueryKeys.dailyDate(today))).toEqual(savedRecord);
  });

  it('allows a genuinely later refresh to hydrate a clean post-save form', async () => {
    const today = localToday();
    mockedGet.mockResolvedValueOnce(dailyEntry({ market_bias: 'Server D0' }));
    mockedSave.mockResolvedValue(dailyEntry({ market_bias: 'Saved S' }));
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.clear(bias);
    await user.type(bias, 'Draft to save');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await screen.findByText('Saved');

    mockedGet.mockResolvedValueOnce(dailyEntry({ market_bias: 'Future server D2' }));
    await act(async () => {
      await client.refetchQueries({ queryKey: journalQueryKeys.dailyDate(today), exact: true });
    });

    await waitFor(() => expect((bias as HTMLInputElement).value).toBe('Future server D2'));
  });

  it('keeps a new dirty edit when a post-save refresh arrives', async () => {
    const today = localToday();
    mockedGet.mockResolvedValueOnce(dailyEntry({ market_bias: 'Server D0' }));
    mockedSave.mockResolvedValue(dailyEntry({ market_bias: 'Saved S' }));
    const user = userEvent.setup();
    const { client } = renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.clear(bias);
    await user.type(bias, 'Draft to save');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await screen.findByText('Saved');
    await user.type(screen.getByLabelText('Session plan'), 'New post-save edit N');

    mockedGet.mockResolvedValueOnce(dailyEntry({ market_bias: 'Future server D2' }));
    await act(async () => {
      await client.refetchQueries({ queryKey: journalQueryKeys.dailyDate(today), exact: true });
    });

    expect((bias as HTMLInputElement).value).toBe('Saved S');
    expect((screen.getByLabelText('Session plan') as HTMLTextAreaElement).value).toBe('New post-save edit N');
    expect((screen.getByRole('button', { name: 'Save daily journal' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('never applies a completed save response to a newly selected date', async () => {
    const today = localToday();
    const tomorrow = shiftLocalDate(today, 1);
    expect(tomorrow).not.toBeNull();
    mockedGet.mockImplementation(async (tradeDate) => (
      tradeDate === tomorrow ? dailyEntry({ trade_date: tomorrow!, market_bias: 'Date B' }) : null
    ));
    let resolveSave: ((value: DailyJournalEntry) => void) | undefined;
    mockedSave.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByLabelText('Market bias'), 'Date A edit');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    await user.click(screen.getByRole('button', { name: 'Next date' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect((screen.getByLabelText('Market bias') as HTMLInputElement).value).toBe('Date B'));

    await act(async () => {
      resolveSave?.(dailyEntry({ trade_date: today, market_bias: 'Saved Date A' }));
    });

    expect((screen.getByLabelText('Journal date') as HTMLInputElement).value).toBe(tomorrow);
    expect((screen.getByLabelText('Market bias') as HTMLInputElement).value).toBe('Date B');
  });

  it('rejects an empty date without issuing an API request or breaking navigation', async () => {
    const today = localToday();
    mockedGet.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPanel();
    const dateInput = await screen.findByLabelText('Journal date') as HTMLInputElement;
    expect(mockedGet).toHaveBeenCalledTimes(1);

    fireEvent.change(dateInput, { target: { value: '' } });
    expect(dateInput.value).toBe(today);
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Previous date' }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(mockedGet).toHaveBeenLastCalledWith(shiftLocalDate(today, -1), expect.anything());
  });

  it('shows saving and failure states while preserving input', async () => {
    mockedGet.mockResolvedValue(null);
    let rejectSave: ((reason?: unknown) => void) | undefined;
    mockedSave.mockReturnValue(new Promise((_resolve, reject) => { rejectSave = reject; }));
    const user = userEvent.setup();
    renderPanel();
    const bias = await screen.findByLabelText('Market bias');
    await user.type(bias, 'Bullish');
    await user.click(screen.getByRole('button', { name: 'Save daily journal' }));
    expect(screen.getByText('Saving')).toBeTruthy();
    rejectSave?.(new Error('offline'));
    await screen.findByText('Could not save. Your edits are still here.');
    expect((screen.getByLabelText('Market bias') as HTMLInputElement).value).toBe('Bullish');
  });

  it('shows an API load failure with retry control', async () => {
    mockedGet.mockRejectedValue(new Error('offline'));
    renderPanel();
    expect(await screen.findByText('Could not load the daily journal.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
