// JWT session (identity ONLY). Role is always re-fetched from DB via resolveActor.
import jwt, { SignOptions } from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import type { SessionPayload } from '@/lib/types';

export const SESSION_COOKIE_NAME = 'wl_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

export function signSessionToken(payload: Pick<SessionPayload, 'userId' | 'email'>): string {
  const opts: SignOptions = { expiresIn: MAX_AGE_SECONDS, algorithm: 'HS256' };
  return jwt.sign(payload, getSecret(), opts);
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;
    const { userId, email, iat, exp } = decoded as jwt.JwtPayload & Partial<SessionPayload>;
    if (!userId || !email) return null;
    return { userId, email, iat, exp };
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}

export function getSessionFromRequest(request: NextRequest): SessionPayload | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
