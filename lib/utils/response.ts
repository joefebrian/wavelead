import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/rbac';

export function ok<T>(data: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

// SEC-003: never leak raw `err.message` (which may include Mongo/driver/provider/
// filesystem/env text) to the client on unexpected 5xx errors.
// - HttpError -> uses its curated publicMessage/message (safe API contract).
// - status < 500 with an explicit publicMessage -> returned as-is (safe 4xx contract).
// - status >= 500 -> ALWAYS respond with a generic string, and log full detail
//   server-side only.
export function handleServiceError(err: unknown): NextResponse {
  if (err instanceof HttpError) return fail(err.status, err.publicMessage || err.message);
  const anyErr = err as { status?: number; publicMessage?: string; message?: string };
  const status = anyErr?.status || 500;
  if (status >= 500) {
    console.error('[wavelead] service error:', err);
    return fail(status, 'Internal server error');
  }
  const message = anyErr?.publicMessage || anyErr?.message || 'Request failed';
  return fail(status, message);
}
