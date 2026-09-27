import type { QueryClient } from '@tanstack/react-query';

export interface Workspace {
  mode: 'normal' | 'sample'; profile_id: string; first_run: boolean; trade_count: number;
  return_url: string | null; period: { start: string; end: string } | null;
  credential_backend: string | null; fixture_version: number | null;
}
let workspace: Workspace | null = null;
export const currentWorkspace = () => workspace;
export const isSampleWorkspace = () => workspace?.mode === 'sample';
export const samplePeriod = () => isSampleWorkspace() ? workspace?.period : null;
export const setWorkspace = (value: Workspace | null) => { workspace = value; };

export async function loadWorkspace(): Promise<Workspace> {
  const response = await fetch('/api/workspace', { cache: 'no-store' });
  if (!response.ok) throw new Error('The workspace could not be verified. Please retry.');
  const result = await response.json() as { success: boolean; data: Workspace };
  if (!result.success || !result.data.profile_id || !['normal', 'sample'].includes(result.data.mode)
    || (result.data.mode === 'sample' && (result.data.credential_backend !== 'disabled' || !result.data.profile_id.startsWith('sample:')))) {
    throw new Error('The workspace could not be verified. Please retry.');
  }
  setWorkspace(result.data);
  return result.data;
}

// A document navigation creates a new JS heap, QueryClient and origin. Old
// requests cannot target the new client. Unmount first; clear while navigating.
export function createWorkspaceTransition(client: QueryClient, leave: (url: string) => void = url => window.location.assign(url)) {
  let intent = 0;
  return async (destination: Promise<string>) => {
    const mine = ++intent;
    const url = await destination;
    if (mine !== intent) return;
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) {
      throw new Error('Invalid local workspace destination');
    }
    await client.cancelQueries();
    if (mine !== intent) return;
    client.clear();
    leave(url);
  };
}

export async function prepareSample(reset = false): Promise<string> {
  const response = await fetch(`/api/workspace/sample?reset=${reset}`, { method: 'POST' });
  if (!response.ok) throw new Error('The sample workspace could not be prepared. Your data was not changed.');
  const result = await response.json() as { data: { url: string } };
  return result.data.url;
}
