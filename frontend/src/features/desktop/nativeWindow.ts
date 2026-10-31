declare global {
  interface Window {
    pywebview?: { api?: { request_close?: () => Promise<void> } };
  }
}

export async function closeNativeWindow(): Promise<boolean> {
  const close = window.pywebview?.api?.request_close;
  if (!close) return false;
  await close();
  return true;
}
