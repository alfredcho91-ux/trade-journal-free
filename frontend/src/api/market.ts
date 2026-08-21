import {
  api,
  ApiClientError,
  type ApiResponse,
  toApiClientError,
  unwrapApiResponse,
} from './config';
import type { TradeReportData } from '../types';
import { isOHLCV } from '../utils/ohlcv';

export async function getTradeReport(
  coin: string,
  interval: string,
  options: {
    limit?: number;
    end_time?: number;
    as_of?: number;
    profile_candles?: number;
  },
): Promise<TradeReportData> {
  try {
    const response = await api.get<ApiResponse<TradeReportData>>(
      `/indicators/trade-report/${coin}/${interval}`,
      { params: options, timeout: 30_000 },
    );
    const payload = unwrapApiResponse(response, 'Failed to load the trade report.');
    if (!Array.isArray(payload.candles) || !payload.candles.every(isOHLCV)) {
      throw new ApiClientError('Trade report response contains invalid candle data.');
    }
    return payload;
  } catch (error: unknown) {
    throw toApiClientError(error, 'Failed to load the trade report.');
  }
}
