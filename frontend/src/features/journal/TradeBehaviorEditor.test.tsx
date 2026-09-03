// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateJournalBehavior } from '../../api/journal';
import type { JournalEntry } from '../../types';
import TradeBehaviorEditor from './TradeBehaviorEditor';

vi.mock('../../api/journal', () => ({
  updateJournalBehavior: vi.fn(),
}));

const mockedUpdate = vi.mocked(updateJournalBehavior);
const entry: JournalEntry = { id: 7, planned_stop_pct: 1.5, fomo: null, notes: 'original' };

function renderEditor(isKo = false) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <TradeBehaviorEditor entry={entry} isKo={isKo} />
  </QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  mockedUpdate.mockReset();
});

describe('TradeBehaviorEditor', () => {
  it('shows the four compact sections and bilingual labels', () => {
    renderEditor(false);
    expect(screen.getByText('PLAN')).toBeTruthy();
    expect(screen.getByText('PSYCHOLOGY')).toBeTruthy();
    expect(screen.getByText('BEHAVIOR')).toBeTruthy();
    expect(screen.getByText('NOTES')).toBeTruthy();
    cleanup();
    renderEditor(true);
    expect(screen.getByText('계획')).toBeTruthy();
    expect(screen.getByText('심리')).toBeTruthy();
    expect(screen.getByText('행동')).toBeTruthy();
    expect(screen.getByText('메모')).toBeTruthy();
  });

  it('uses semantic plan-recorded wording instead of last-saved wording', () => {
    const client = new QueryClient();
    const timedEntry = { ...entry, plan_recorded_at: '2026-09-03T01:00:00Z' };
    const { rerender } = render(<QueryClientProvider client={client}><TradeBehaviorEditor entry={timedEntry} isKo={false} /></QueryClientProvider>);
    expect(screen.getByText(/Plan recorded/)).toBeTruthy();
    expect(screen.queryByText(/Last saved/)).toBeNull();
    rerender(<QueryClientProvider client={client}><TradeBehaviorEditor entry={timedEntry} isKo /></QueryClientProvider>);
    expect(screen.getByText(/계획 기록 시각/)).toBeTruthy();
  });

  it('saves only changed fields and exposes saving then saved state', async () => {
    let resolveSave: ((value: JournalEntry) => void) | undefined;
    mockedUpdate.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    renderEditor(false);

    await user.click(screen.getByText('PSYCHOLOGY'));
    await user.type(screen.getByLabelText('Before entry'), 'Calm');
    await user.click(screen.getByRole('button', { name: 'Save behavior journal' }));

    expect(screen.getByText('Saving')).toBeTruthy();
    expect(mockedUpdate).toHaveBeenCalledWith(7, { emotion_before: 'Calm' });
    resolveSave?.({ ...entry, emotion_before: 'Calm' });
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  });

  it('shows a localized error and keeps the edited draft after failure', async () => {
    mockedUpdate.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderEditor(true);

    await user.click(screen.getByText('메모'));
    const notes = screen.getByLabelText('거래 메모');
    await user.clear(notes);
    await user.type(notes, '수정 메모');
    await user.click(screen.getByRole('button', { name: '행동 기록 저장' }));

    await waitFor(() => expect(screen.getByText('저장하지 못했습니다. 다시 시도해 주세요.')).toBeTruthy());
    expect((screen.getByLabelText('거래 메모') as HTMLTextAreaElement).value).toBe('수정 메모');
  });

  it('preserves edits made after a save request starts', async () => {
    let resolveSave: ((value: JournalEntry) => void) | undefined;
    mockedUpdate.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    renderEditor(false);

    await user.click(screen.getByText('PSYCHOLOGY'));
    await user.type(screen.getByLabelText('Before entry'), 'Calm');
    await user.click(screen.getByRole('button', { name: 'Save behavior journal' }));
    await user.click(screen.getByText('NOTES'));
    const notes = screen.getByLabelText('Trade notes');
    await user.clear(notes);
    await user.type(notes, 'Newer local note');

    await act(async () => {
      resolveSave?.({ ...entry, emotion_before: 'Calm' });
    });

    expect((screen.getByLabelText('Trade notes') as HTMLTextAreaElement).value).toBe('Newer local note');
    expect((screen.getByRole('button', { name: 'Save behavior journal' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('shows a validation error and cannot save an invalid plan number', async () => {
    const user = userEvent.setup();
    renderEditor(false);
    const stop = screen.getByLabelText('Planned stop percentage');
    await user.clear(stop);
    await user.type(stop, '0');

    expect(screen.getByText('Enter a number greater than 0 and at most 100.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save behavior journal' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('reports dirty state and clears it after a successful Behavior save', async () => {
    mockedUpdate.mockResolvedValue({ ...entry, planned_stop_pct: 2 });
    const onDirtyChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}>
      <TradeBehaviorEditor entry={entry} isKo={false} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>);

    const stop = screen.getByLabelText('Planned stop percentage');
    await user.clear(stop);
    await user.type(stop, '2');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole('button', { name: 'Save behavior journal' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('clears parent-visible dirty state when a clean trade replaces the current trade', async () => {
    const onDirtyChange = vi.fn();
    const client = new QueryClient();
    const user = userEvent.setup();
    const { rerender } = render(<QueryClientProvider client={client}>
      <TradeBehaviorEditor entry={entry} isKo={false} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>);
    await user.clear(screen.getByLabelText('Planned stop percentage'));
    await user.type(screen.getByLabelText('Planned stop percentage'), '2');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    rerender(<QueryClientProvider client={client}>
      <TradeBehaviorEditor entry={{ ...entry, id: 8, planned_stop_pct: 3 }} isKo={false} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText<HTMLInputElement>('Planned stop percentage').value).toBe('3');
  });
});
