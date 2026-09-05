import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse } from 'axios';
import { api, ApiClientError } from './config';
import { getAnalyticsMetadata, queryAnalytics } from './analytics';
import { metadataFixture, resultFixture } from '../features/analytics/analyticsTestFixtures';

afterEach(() => vi.restoreAllMocks());
describe('Analytics transport', () => {
  it('uses the official GET/POST routes and forwards request and abort signal', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: metadataFixture() } } as AxiosResponse);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: resultFixture() } } as AxiosResponse);
    const controller = new AbortController();
    const payload = { metric: 'server_metric', dimension: 'all', filters: { start_time: 1, end_time: 2 } };
    expect(await getAnalyticsMetadata(controller.signal)).toEqual(metadataFixture());
    expect(await queryAnalytics(payload, controller.signal)).toEqual(resultFixture());
    expect(get).toHaveBeenCalledWith('/analytics/metadata', { signal: controller.signal });
    expect(post).toHaveBeenCalledWith('/analytics/query', payload, { signal: controller.signal });
  });
  it('keeps backend validation details and rejects unsuccessful envelopes', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ isAxiosError: true, response: { status: 422, data: { error: 'Unsupported selection', details: { fields: [{ message: 'Invalid dimension' }] } } } });
    await expect(queryAnalytics({ metric: 'x', dimension: 'y', filters: {} })).rejects.toMatchObject({ status: 422, message: 'Unsupported selection', details: { fields: [{ message: 'Invalid dimension' }] } });
    vi.spyOn(api, 'get').mockResolvedValue({ status: 200, data: { success: false, error: 'Definitions unavailable' } } as AxiosResponse);
    await expect(getAnalyticsMetadata()).rejects.toBeInstanceOf(ApiClientError);
  });
});
