// M19.2 correction — Support guest cookie.
//
// Anonymous support tickets are authenticated by a server-managed HttpOnly
// cookie. The token itself is never exposed to page JS, page URLs, logs or
// analytics. Only one active guest thread per browser is supported — that
// matches the widget's UX and keeps cookie footprint minimal.
//
// Cookie value shape: `${ticket_id}|${access_token}` (both opaque UUIDs).
import type { NextRequest, NextResponse } from 'next/server';

export const SUPPORT_COOKIE_NAME = 'wl_support_thread';
const SUPPORT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SupportGuestCookie {
  ticketId: string;
  token: string;
}

export function readSupportGuestCookie(request: NextRequest): SupportGuestCookie | null {
  const raw = request.cookies.get(SUPPORT_COOKIE_NAME)?.value;
  if (!raw) return null;
  const idx = raw.indexOf('|');
  if (idx <= 0 || idx === raw.length - 1) return null;
  const ticketId = raw.slice(0, idx);
  const token = raw.slice(idx + 1);
  // Cheap sanity: both look like non-empty opaque strings.
  if (ticketId.length < 8 || token.length < 8) return null;
  return { ticketId, token };
}

export function setSupportGuestCookie(response: NextResponse, ticketId: string, token: string): NextResponse {
  response.cookies.set({
    name: SUPPORT_COOKIE_NAME,
    value: `${ticketId}|${token}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SUPPORT_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSupportGuestCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SUPPORT_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
