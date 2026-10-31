// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DesktopLifecycle from './DesktopLifecycle';
import { closeNativeWindow } from './nativeWindow';
import { useBeforeUnloadGuard } from '../../hooks/useBeforeUnloadGuard';

function DirtyForm({ dirty }: { dirty: boolean }) {
  useBeforeUnloadGuard(dirty);
  return null;
}

const canClose = () => window.dispatchEvent(new Event('app-desktop-close-check', { cancelable: true }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.pywebview; });

describe('native desktop lifecycle', () => {
  it('leaves the browser shutdown path available and uses the bridge in a native window', async () => {
    expect(await closeNativeWindow()).toBe(false);
    const requestClose = vi.fn().mockResolvedValue(undefined);
    window.pywebview = { api: { request_close: requestClose } };
    expect(await closeNativeWindow()).toBe(true);
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('allows clean close and protects dirty forms until discard is confirmed', () => {
    const queryClient = new QueryClient();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = (dirty: boolean) => <QueryClientProvider client={queryClient}><DesktopLifecycle /><DirtyForm dirty={dirty} /></QueryClientProvider>;
    const result = render(view(false));
    expect(canClose()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    result.rerender(view(true));
    expect(canClose()).toBe(false);
    confirm.mockReturnValue(true);
    expect(canClose()).toBe(true);
    result.rerender(view(false));
    expect(canClose()).toBe(true);
  });

  it('blocks shutdown while a mutation is pending, then permits it', async () => {
    const queryClient = new QueryClient();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<QueryClientProvider client={queryClient}><DesktopLifecycle /></QueryClientProvider>);
    let finish!: () => void;
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: () => new Promise<void>((resolve) => { finish = resolve; }) });
    let completion!: Promise<void>;
    act(() => { completion = mutation.execute(undefined); });
    await waitFor(() => expect(canClose()).toBe(false));
    expect(alert).toHaveBeenCalled();
    await act(async () => { finish(); await completion; });
    await waitFor(() => expect(canClose()).toBe(true));
  });
});
