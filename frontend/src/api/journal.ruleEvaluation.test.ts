import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './config';
import { getJournalStrategyEvaluation } from './journal';

vi.mock('./config', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ensureApiSuccess: vi.fn((response) => response.data),
  unwrapApiResponse: vi.fn((response) => response.data.data),
  toApiClientError: vi.fn((error) => error),
}));

const mockedGet = vi.mocked(api.get);

beforeEach(() => mockedGet.mockReset());

describe('Journal Strategy evaluation API', () => {
  it('uses only the journal strategy-evaluation GET endpoint for the selected entry', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: null } });

    await expect(getJournalStrategyEvaluation(77)).resolves.toBeNull();

    expect(mockedGet).toHaveBeenCalledOnce();
    expect(mockedGet).toHaveBeenCalledWith('/journal/77/strategy-evaluation');
  });
});
