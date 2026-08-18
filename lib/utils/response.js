import { NextResponse } from 'next/server';

export function ok(data, init = {}) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status, message, extra = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function handleServiceError(err) {
  const status = err?.status || 500;
  const message = err?.publicMessage || err?.message || 'Internal server error';
  if (status >= 500) console.error('[wavehub] service error:', err);
  return fail(status, message);
}
