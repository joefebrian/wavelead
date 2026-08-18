// JWT session management via HttpOnly cookie. Server-side only.
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'wh_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

export function signSessionToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: MAX_AGE_SECONDS, algorithm: 'HS256' });
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// Attach the auth cookie to a NextResponse.
export function setSessionCookie(response, token) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}

// Read session from the incoming request cookies (works in API routes).
export function getSessionFromRequest(request) {
  const token = request.cookies?.get?.(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// For server components: read from next/headers cookie store.
export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
