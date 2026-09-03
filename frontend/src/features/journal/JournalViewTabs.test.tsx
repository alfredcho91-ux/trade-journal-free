// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JournalViewTabs from './JournalViewTabs';

afterEach(cleanup);

describe('JournalViewTabs', () => {
  it('switches to Trades immediately when the daily form is clean', async () => {
    const onChange = vi.fn();
    render(<JournalViewTabs view="daily" dailyDirty={false} isKo={false} onChange={onChange} onDiscardDaily={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Trades' }));
    expect(onChange).toHaveBeenCalledWith('trades');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('guards a dirty Daily Journal and supports keep or discard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDiscard = vi.fn();
    render(<JournalViewTabs view="daily" dailyDirty isKo={false} onChange={onChange} onDiscardDaily={onDiscard} />);

    await user.click(screen.getByRole('tab', { name: 'Trades' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: 'Trades' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('trades');
  });
});
