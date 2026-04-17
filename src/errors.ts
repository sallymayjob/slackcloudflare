import type { Err } from './types';

export function err(code: string, message: string, opts: { retryable?: boolean; correlationId?: string } = {}): Err {
  return {
    ok: false,
    code,
    message,
    retryable: !!opts.retryable,
    correlationId: opts.correlationId,
  };
}

export function ok<T extends Record<string, unknown>>(code: string, extras: T = {} as T) {
  return { ok: true as const, code, ...extras };
}
