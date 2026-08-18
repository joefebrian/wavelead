// Follow-Intent tracker + WhatsApp redirect.
//
// - Redirect ALWAYS wins: analytics failure must NEVER block the user.
// - Non-approved channels do NOT redirect (return 404).
// - Anonymous session cookie (wl_anon_id) is set for dedupe of the unique
//   Follow Intent metric only. Raw follow_click events are stored per click.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { trackingService } from '@/lib/services/trackingService';
import { getSessionFromRequest } from '@/lib/auth/session';

const ANON_COOKIE_NAME = 'wl_anon_id';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function ensureAnonId(request: NextRequest, response: NextResponse): string {
  const existing = request.cookies.get(ANON_COOKIE_NAME)?.value;
  if (existing && /^[a-z0-9-]{16,}$/i.test(existing)) return existing;
  const id = randomUUID();
  response.cookies.set({
    name: ANON_COOKIE_NAME,
    value: id,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return id;
}

function detectDeviceType(ua: string | null): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/mobile|android|iphone|ipod/.test(s)) return 'mobile';
  if (/tablet|ipad/.test(s)) return 'tablet';
  return 'desktop';
}

function safeRedirectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    // Only allow WhatsApp destinations.
    if (host === 'whatsapp.com' || host === 'www.whatsapp.com' || host === 'wa.me') return u.toString();
    return null;
  } catch {
    return null;
  }
}

interface Ctx { params: Promise<{ slug: string }>; }

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;

  let channel;
  try {
    channel = await channelRepo.findBySlug(slug);
  } catch (err) {
    console.error('[wavelead] /go lookup failed:', err);
    // If DB is down, still bounce user to the site (no blind redirect).
    return NextResponse.redirect(new URL('/', base), 302);
  }

  if (!channel || channel.status !== 'approved') {
    // Never blindly redirect a non-public channel.
    return NextResponse.redirect(new URL(`/channel/${slug}?not_available=1`, base), 302);
  }

  const destination = safeRedirectUrl(channel.whatsapp_url);
  if (!destination) {
    return NextResponse.redirect(new URL(`/channel/${slug}?invalid_url=1`, base), 302);
  }

  const response = NextResponse.redirect(destination, 302);
  // Prevent caching so every click is a fresh redirect.
  response.headers.set('Cache-Control', 'no-store, private');

  // Analytics — best effort, must never break the redirect.
  try {
    const anonId = ensureAnonId(request, response);
    const session = getSessionFromRequest(request);
    const sp = new URL(request.url).searchParams;
    const referrer = request.headers.get('referer');
    // Only mark as external if the referrer is off-site. wavelead's own hosts
    // are stripped by normalizeReferrerDomain via ownHosts.
    const ownHosts = new Set<string>();
    try {
      const base = process.env.NEXT_PUBLIC_BASE_URL;
      if (base) ownHosts.add(new URL(base).hostname.toLowerCase().replace(/^www\./, ''));
    } catch { /* ignore */ }
    ownHosts.add(new URL(request.url).hostname.toLowerCase().replace(/^www\./, ''));
    const { normalizeReferrerDomain, normalizeSource } = await import('@/lib/services/trackingService');
    const refDomain = normalizeReferrerDomain(referrer, ownHosts);
    // Attribution precedence: explicit source query param (canonical only) →
    // referrer-inferred external → direct.
    let source = normalizeSource(sp.get('source'));
    if (source === 'other') source = refDomain ? 'external' : 'direct';
    trackingService.recordFollowClick({
      channelId: channel.id,
      anonymousSessionId: anonId,
      userId: session?.userId ?? null,
      source,
      placement: sp.get('placement'),
      referrer,
      referrerDomain: refDomain,
      searchQuery: sp.get('q'),
      categorySlug: sp.get('category'),
      pagePath: sp.get('from'),
      countryCode: request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null,
      deviceType: detectDeviceType(request.headers.get('user-agent')),
      campaignId: sp.get('campaign_id'),
    });
  } catch (err) {
    console.error('[wavelead] follow_click tracking threw (ignored):', err);
  }

  return response;
}
