// M05.1 signed attribution token. HMAC-SHA256 over a compact JSON payload.
// TTL: 15 minutes. Bound to the current anonymous session so a stolen token
// cannot be replayed from a different session for paid attribution.
import crypto from 'node:crypto';
import type { SponsoredPlacement, AcquisitionSource } from '@/lib/types';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export interface AttributionPayload {
  campaign_id: string;
  channel_id: string;
  source: AcquisitionSource;
  placement: SponsoredPlacement;
  traffic_type: 'sponsored';
  session_binding: string;
  iat: number;
  exp: number;
  jti: string;
}

function signingSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function deriveSessionBinding(anonymous_session_id: string | null | undefined): string {
  const s = String(anonymous_session_id || 'anon');
  return crypto.createHmac('sha256', signingSecret()).update(`sb:${s}`).digest('hex').slice(0, 32);
}

function sign(payload: AttributionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', signingSecret()).update(body).digest());
  return `${body}.${mac}`;
}

export function issueAttributionToken(input: {
  campaign_id: string;
  channel_id: string;
  source: AcquisitionSource;
  placement: SponsoredPlacement;
  anonymous_session_id: string | null | undefined;
  ttl_ms?: number;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + Math.floor((input.ttl_ms ?? DEFAULT_TTL_MS) / 1000);
  const payload: AttributionPayload = {
    campaign_id: input.campaign_id,
    channel_id: input.channel_id,
    source: input.source,
    placement: input.placement,
    traffic_type: 'sponsored',
    session_binding: deriveSessionBinding(input.anonymous_session_id),
    iat,
    exp,
    jti: crypto.randomBytes(9).toString('hex'),
  };
  return sign(payload);
}

export interface VerifyOptions {
  now?: Date;
  anonymous_session_id: string | null | undefined;
}

export type VerifyResult =
  | { valid: true; payload: AttributionPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'session_mismatch' };

export function verifyAttributionToken(token: string | null | undefined, opts: VerifyOptions): VerifyResult {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: 'malformed' };
  const [body, mac] = token.split('.', 2);
  if (!body || !mac) return { valid: false, reason: 'malformed' };
  const expectedMac = b64url(crypto.createHmac('sha256', signingSecret()).update(body).digest());
  // Constant-time compare.
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };
  let payload: AttributionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as AttributionPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  const now = opts.now ?? new Date();
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  const expectedBinding = deriveSessionBinding(opts.anonymous_session_id);
  if (payload.session_binding !== expectedBinding) {
    return { valid: false, reason: 'session_mismatch' };
  }
  return { valid: true, payload };
}
