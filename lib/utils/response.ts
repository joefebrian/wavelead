import { NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth/rbac';

export function ok<T>(data: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function handleServiceError(err: unknown): NextResponse {
  if (err instanceof HttpError) return fail(err.status, err.publicMessage || err.message);
  const anyErr = err as { status?: number; publicMessage?: string; message?: string };
  const status = anyErr?.status || 500;
  const message = anyErr?.publicMessage || anyErr?.message || 'Internal server error';
  if (status >= 500) console.error('[wavelead] service error:', err);
  return fail(status, message);
}
