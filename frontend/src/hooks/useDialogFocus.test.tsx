// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDialogFocus } from './useDialogFocus';
import UnsavedChangesDialog from '../features/journal/UnsavedChangesDialog';
import ExchangeConnectionModal from '../features/journal/ExchangeConnectionModal';
import type { ExchangeStatus } from '../types';

function Editor({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogFocus(onClose);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Editor">
    <input data-dialog-initial-focus aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <button disabled>Unavailable</button>
    <button hidden>Hidden action</button>
    <button onClick={() => setConfirming(true)}>Confirm</button>
    <button onClick={onClose}>Close editor</button>
    {confirming && <UnsavedChangesDialog isKo={false} onKeepEditing={() => setConfirming(false)} onDiscard={onClose} />}
  </div>;
}

function Workspace() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open editor</button>
    <button>Background action</button>
    {open && <Editor onClose={() => setOpen(false)} />}
  </>;
}

function ResponsiveEditor({ onClose, onNarrow }: { onClose: () => void; onNarrow: () => void }) {
  const ref = useDialogFocus(onClose);
  const [confirming, setConfirming] = useState(false);
  return <div ref={ref} tabIndex={-1} role="dialog" aria-label="Responsive editor">
    <button onClick={onNarrow}>Narrow viewport</button>
    <button onClick={() => setConfirming(true)}>Confirm responsive exit</button>
    {confirming && <UnsavedChangesDialog isKo={false} onKeepEditing={() => setConfirming(false)} onDiscard={onClose} />}
  </div>;
}

function ResponsiveWorkspace() {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  return <>
    <button hidden={narrow} data-dialog-opener="record-1" onClick={() => setOpen(true)}>Desktop record</button>
    <button hidden={!narrow} data-dialog-opener="record-1" onClick={() => setOpen(true)}>Narrow record</button>
    {open && <ResponsiveEditor onClose={() => setOpen(false)} onNarrow={() => setNarrow(true)} />}
  </>;
}

beforeEach(() => {
  // JSDOM has no layout. Supply rectangles for the visible controls only.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [new DOMRect(0, 0, 32, 32)]) as unknown as DOMRectList;
  });
  document.body.style.overflow = 'auto';
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('dialog keyboard interaction', () => {
  it.each(['Escape', 'nested discard'])('restores the same visible record after its opener becomes hidden: %s', async (exit) => {
    const user = userEvent.setup();
    render(<ResponsiveWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Desktop record' }));
    await user.click(screen.getByRole('button', { name: 'Narrow viewport' }));
    if (exit === 'Escape') await user.keyboard('{Escape}');
    else {
      await user.click(screen.getByRole('button', { name: 'Confirm responsive exit' }));
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    }
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Narrow record' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('initially focuses the field, traps both Tab directions and excludes unavailable controls', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    expect(document.activeElement).toBe(draft);
    expect(document.body.style.overflow).toBe('hidden');
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close editor' }));
    await user.tab();
    expect(document.activeElement).toBe(draft);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
    screen.getByRole('button', { name: 'Background action' }).focus();
    expect(document.activeElement).toBe(draft);
  });

  it('restores the opener and prior scrolling state after Escape', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const opener = screen.getByRole('button', { name: 'Open editor' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('Escape dismisses only the nested confirmation, retaining the parent draft and restoring focus', async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    await user.type(screen.getByRole('textbox', { name: 'Draft' }), 'Keep this draft');
    const confirmationOpener = screen.getByRole('button', { name: 'Confirm' });
    await user.click(confirmationOpener);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard changes' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement).value).toBe('Keep this draft');
    await waitFor(() => expect(document.activeElement).toBe(confirmationOpener));
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(confirmationOpener);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open editor' })));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps a busy connection dialog open and uses the latest close policy without refocusing on rerender', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const exchange: ExchangeStatus = { id: 'binance', name: 'Binance', configured: false, mode: 'read_only',
      instrument_types: ['SWAP', 'SPOT'], requires_passphrase: false, connector: 'ccxt', credential_source: 'none' };
    const props = { exchange, isKo: false, isSaving: true, isDeleting: false, error: null,
      onClose, onSave: vi.fn(), onDelete: vi.fn() };
    const view = render(<ExchangeConnectionModal {...props} />);
    expect(document.activeElement).toBe(screen.getByLabelText('API Key'));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    await user.tab();
    const currentFocus = document.activeElement;
    view.rerender(<ExchangeConnectionModal {...props} isSaving={false} />);
    expect(document.activeElement).toBe(currentFocus);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});
