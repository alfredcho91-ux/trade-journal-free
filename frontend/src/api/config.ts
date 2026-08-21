// API 공통 설정

import axios from 'axios';
import type { AxiosResponse } from 'axios';

export const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  error_code?: string | null;
  details?: unknown;
}

interface ApiSuccessPayload {
  success: boolean;
  error?: string;
  error_code?: string | null;
  details?: unknown;
}

interface ApiClientErrorOptions {
  status?: number;
  code?: string | null;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly status?: number;
  readonly code?: string | null;
  readonly details?: unknown;

  constructor(message: string, options: ApiClientErrorOptions = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function unwrapApiResponse<T>(
  response: AxiosResponse<ApiResponse<T>>,
  fallbackMessage: string
): T {
  const payload = response.data;
  if (payload.success && payload.data !== undefined) {
    return payload.data;
  }
  throw new ApiClientError(payload.error || fallbackMessage, {
    status: response.status,
    code: payload.error_code,
    details: payload.details,
  });
}

export function ensureApiSuccess<T extends ApiSuccessPayload>(
  response: AxiosResponse<T>,
  fallbackMessage: string
): T {
  const payload = response.data;
  if (payload.success) {
    return payload;
  }
  throw new ApiClientError(payload.error || fallbackMessage, {
    status: response.status,
    code: payload.error_code,
    details: payload.details,
  });
}

export function toApiClientError(error: unknown, fallbackMessage: string): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }

  if (axios.isAxiosError<ApiResponse<unknown>>(error)) {
    return new ApiClientError(
      error.response?.data?.error || error.message || fallbackMessage,
      {
        status: error.response?.status,
        code: error.response?.data?.error_code,
        details: error.response?.data?.details,
      }
    );
  }

  if (error instanceof Error) {
    return new ApiClientError(error.message || fallbackMessage);
  }

  return new ApiClientError(fallbackMessage);
}
