// Strict CORS policy for WaveLead. Never reflect `*` with credentials.
// Allowlist comes from CORS_ORIGINS (comma-separated) OR NEXT_PUBLIC_BASE_URL.
import { NextResponse } from 'next/server';

export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || '';
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (base && !list.includes(base)) list.push(base);
  return list;
}

export function applyCors(response: NextResponse, request: Request): NextResponse {
  const origin = request.headers.get('origin');
  const list = allowedOrigins();
  // Same-origin requests have no Origin header — nothing to add.
  if (origin && list.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
}
