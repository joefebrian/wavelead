import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/authService';
import { channelService } from '@/lib/services/channelService';
import { categoryService } from '@/lib/services/categoryService';
import { runSeed } from '@/lib/seed/seedData';
import { getSessionFromRequest, setSessionCookie, clearSessionCookie } from '@/lib/auth/session';
import { resolveActor, requireRole, ROLES } from '@/lib/auth/rbac';
import { ok, fail, handleServiceError } from '@/lib/utils/response';
import { applyCors } from '@/lib/utils/cors';
import { rateLimit, clientKey } from '@/lib/auth/rateLimit';
import { getVersionInfo } from '@/lib/utils/version';

async function safeJson(request: NextRequest): Promise<Record<string, unknown>> {
  try { return await request.json(); } catch { return {}; }
}

interface RouteCtx { params: Promise<{ path?: string[] }>; }

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return applyCors(new NextResponse(null, { status: 204 }), request);
}

async function handler(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { path = [] } = await ctx.params;
  const route = '/' + path.join('/');
  const method = request.method;

  try {
    if (route === '/health' && method === 'GET') {
      const v = getVersionInfo();
      return applyCors(ok({
        status: 'ok',
        service: 'wavelead',
        time: new Date().toISOString(),
        env: process.env.NODE_ENV || 'unknown',
        version: v.commitShort,
        commit: v.commit,
        commitTime: v.commitTime,
        branch: v.branch,
      }), request);
    }

    // ---------- AUTH ----------
    if (route === '/auth/signup' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'signup'), 5, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many signup attempts, please slow down', { retryAfter: rl.retryAfterSeconds }), request);
      const body = await safeJson(request);
      const { user, token } = await authService.signup(body);
      const res = applyCors(ok({ user }), request);
      return setSessionCookie(res, token);
    }
    if (route === '/auth/login' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'login'), 8, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many login attempts, please try again shortly', { retryAfter: rl.retryAfterSeconds }), request);
      const body = await safeJson(request);
      const { user, token } = await authService.login(body);
      const res = applyCors(ok({ user }), request);
      return setSessionCookie(res, token);
    }
    if (route === '/auth/logout' && method === 'POST') {
      return clearSessionCookie(applyCors(ok({ loggedOut: true }), request));
    }
    if (route === '/auth/me' && method === 'GET') {
      // Always resolve current DB role — never trust JWT.
      const session = getSessionFromRequest(request);
      const user = await authService.me(session);
      return applyCors(ok({ user }), request);
    }

    // ---------- PUBLIC DISCOVERY ----------
    if (route === '/categories' && method === 'GET') {
      const withCounts = new URL(request.url).searchParams.get('withCounts');
      if (withCounts) {
        const { discoveryService } = await import('@/lib/services/discoveryService');
        return applyCors(ok({ categories: await discoveryService.getCategoryCounts() }), request);
      }
      return applyCors(ok({ categories: await categoryService.listActive() }), request);
    }
    if (route === '/countries' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      return applyCors(ok({ countries: await discoveryService.getCountryCounts() }), request);
    }
    if (route === '/discovery/home' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      return applyCors(ok(await discoveryService.getHomepageBundle()), request);
    }
    if (route === '/channels/rising' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '6', 10) || 6, 24);
      return applyCors(ok({ items: await discoveryService.getRising(limit) }), request);
    }
    if (route === '/channels/top' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      const sp = new URL(request.url).searchParams;
      const country = sp.get('country') || undefined;
      const limit = Math.min(parseInt(sp.get('limit') || '10', 10) || 10, 50);
      return applyCors(ok({ items: await discoveryService.getTop({ country, limit }) }), request);
    }
    if (route === '/channels' && method === 'GET') {
      const sp = new URL(request.url).searchParams;
      const result = await channelService.listPublic({
        category: sp.get('category') || undefined,
        country: sp.get('country') || undefined,
        q: sp.get('q') || undefined,
        sort: (sp.get('sort') as 'newest' | 'top' | 'trending' | null) || undefined,
        limit: Math.min(parseInt(sp.get('limit') || '24', 10) || 24, 60),
        skip: Math.max(parseInt(sp.get('skip') || '0', 10) || 0, 0),
      });
      return applyCors(ok(result), request);
    }
    if (route === '/channels/featured' && method === 'GET') {
      return applyCors(ok({ items: await channelService.getFeatured(6) }), request);
    }
    if (route === '/stats' && method === 'GET') {
      return applyCors(ok(await channelService.getStats()), request);
    }
    if (path.length === 2 && path[0] === 'channels' && method === 'GET') {
      const c = await channelService.getPublicBySlug(path[1]);
      if (!c) return applyCors(fail(404, 'Channel not found'), request);
      return applyCors(ok({ channel: c }), request);
    }

    // ---------- ADMIN (role resolved from DB, never JWT) ----------
    if (route === '/admin/seed' && method === 'POST') {
      if (process.env.NODE_ENV === 'production') {
        const actor = await resolveActor(request);
        requireRole(actor, ROLES.ADMIN);
      }
      const body = await safeJson(request);
      return applyCors(ok({ seed: await runSeed({ force: !!body?.force }) }), request);
    }

    // ---------- SUBMISSION (M02) ----------
    if (route === '/submit/check' && method === 'POST') {
      const body = await safeJson(request);
      const { submissionService } = await import('@/lib/services/submissionService');
      return applyCors(ok(await submissionService.checkDuplicate(String(body?.whatsapp_url || ''))), request);
    }
    if (route === '/submit' && method === 'POST') {
      const actor = await resolveActor(request);
      if (!actor) return applyCors(fail(401, 'You must be signed in to submit a channel'), request);
      const body = await safeJson(request);
      const { submissionService } = await import('@/lib/services/submissionService');
      return applyCors(ok(await submissionService.submit(actor, body)), request);
    }

    // ---------- MODERATION (M02) ----------
    if (route === '/admin/channels' && method === 'GET') {
      const { moderationService } = await import('@/lib/services/moderationService');
      const actor = await resolveActor(request);
      const status = new URL(request.url).searchParams.get('status') || 'pending_review';
      return applyCors(ok({ items: await moderationService.listQueue(actor, { status }) }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'channels' && method === 'GET') {
      const { moderationService } = await import('@/lib/services/moderationService');
      const actor = await resolveActor(request);
      return applyCors(ok({ channel: await moderationService.getById(actor, path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'channels' && path[3] === 'approve' && method === 'POST') {
      const { moderationService } = await import('@/lib/services/moderationService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      return applyCors(ok(await moderationService.approve(actor, path[2], body?.edits as Record<string, unknown> | undefined)), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'channels' && path[3] === 'reject' && method === 'POST') {
      const { moderationService } = await import('@/lib/services/moderationService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      return applyCors(ok(await moderationService.reject(actor, path[2], body)), request);
    }

    // ---------- CURATION (M02) ----------
    if (route === '/admin/homepage/slots' && method === 'GET') {
      const { curationService } = await import('@/lib/services/curationService');
      return applyCors(ok({ slots: await curationService.listAll(await resolveActor(request)) }), request);
    }
    if (route === '/admin/homepage/slots' && method === 'POST') {
      const { curationService } = await import('@/lib/services/curationService');
      return applyCors(ok({ slot: await curationService.addSlot(await resolveActor(request), await safeJson(request)) }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'homepage' && path[2] === 'slots' && method === 'DELETE') {
      const { curationService } = await import('@/lib/services/curationService');
      return applyCors(ok(await curationService.removeSlot(await resolveActor(request), path[3])), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'homepage' && path[2] === 'slots' && method === 'PATCH') {
      const { curationService } = await import('@/lib/services/curationService');
      return applyCors(ok(await curationService.updateSlot(await resolveActor(request), path[3], await safeJson(request))), request);
    }

    // ---------- CLAIMS (M03.1 / M03.2 / M03.6 claimant) ----------
    if (path.length === 3 && path[0] === 'claims' && path[1] === 'eligibility' && method === 'GET') {
      const { claimService } = await import('@/lib/services/claimService');
      return applyCors(ok(await claimService.getEligibility(path[2], await resolveActor(request))), request);
    }
    if (path.length === 2 && path[0] === 'claims' && method === 'POST') {
      const { claimService } = await import('@/lib/services/claimService');
      return applyCors(ok(await claimService.submit(await resolveActor(request), path[1], await safeJson(request))), request);
    }
    if (path.length === 3 && path[0] === 'claims' && path[2] === 'resubmit' && method === 'POST') {
      const { claimService } = await import('@/lib/services/claimService');
      return applyCors(ok(await claimService.resubmit(await resolveActor(request), path[1], await safeJson(request))), request);
    }
    if (path.length === 3 && path[0] === 'claims' && path[2] === 'cancel' && method === 'POST') {
      const { claimService } = await import('@/lib/services/claimService');
      return applyCors(ok(await claimService.cancel(await resolveActor(request), path[1])), request);
    }
    if (route === '/me/claims' && method === 'GET') {
      const { claimService } = await import('@/lib/services/claimService');
      return applyCors(ok({ items: await claimService.listMine(await resolveActor(request)) }), request);
    }

    // ---------- CLAIM MODERATION (M03.3 / M03.4) ----------
    if (route === '/admin/claims' && method === 'GET') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      const status = new URL(request.url).searchParams.get('status') || 'pending';
      return applyCors(ok({ items: await claimModerationService.listQueue(await resolveActor(request), { status }) }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'claims' && method === 'GET') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      return applyCors(ok(await claimModerationService.getDetail(await resolveActor(request), path[2])), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'claims' && path[3] === 'approve' && method === 'POST') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      return applyCors(ok(await claimModerationService.approve(await resolveActor(request), path[2], await safeJson(request))), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'claims' && path[3] === 'reject' && method === 'POST') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      return applyCors(ok(await claimModerationService.reject(await resolveActor(request), path[2], await safeJson(request))), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'claims' && path[3] === 'request-info' && method === 'POST') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      return applyCors(ok(await claimModerationService.requestInfo(await resolveActor(request), path[2], await safeJson(request))), request);
    }

    // ---------- OWNER CHANNEL MANAGEMENT (M03.6) ----------
    if (route === '/me/channels' && method === 'GET') {
      const { ownerService } = await import('@/lib/services/ownerService');
      return applyCors(ok({ items: await ownerService.listMine(await resolveActor(request)) }), request);
    }
    if (path.length === 3 && path[0] === 'me' && path[1] === 'channels' && method === 'GET') {
      const { ownerService } = await import('@/lib/services/ownerService');
      return applyCors(ok(await ownerService.getMine(await resolveActor(request), path[2])), request);
    }
    if (path.length === 3 && path[0] === 'me' && path[1] === 'channels' && method === 'PATCH') {
      const { ownerService } = await import('@/lib/services/ownerService');
      return applyCors(ok(await ownerService.updateSafeFields(await resolveActor(request), path[2], await safeJson(request))), request);
    }
    if (path.length === 4 && path[0] === 'me' && path[1] === 'channels' && path[3] === 'change-request' && method === 'POST') {
      const { ownerService } = await import('@/lib/services/ownerService');
      return applyCors(ok(await ownerService.submitChangeRequest(await resolveActor(request), path[2], await safeJson(request))), request);
    }

    // ---------- CHANGE REQUEST MODERATION (M03.7) ----------
    if (route === '/admin/channel-changes' && method === 'GET') {
      const { changeRequestModerationService } = await import('@/lib/services/changeRequestModerationService');
      const status = new URL(request.url).searchParams.get('status') || 'pending';
      return applyCors(ok({ items: await changeRequestModerationService.listQueue(await resolveActor(request), { status }) }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'channel-changes' && method === 'GET') {
      const { changeRequestModerationService } = await import('@/lib/services/changeRequestModerationService');
      return applyCors(ok(await changeRequestModerationService.getDetail(await resolveActor(request), path[2])), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'channel-changes' && path[3] === 'approve' && method === 'POST') {
      const { changeRequestModerationService } = await import('@/lib/services/changeRequestModerationService');
      return applyCors(ok(await changeRequestModerationService.approve(await resolveActor(request), path[2], await safeJson(request))), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'channel-changes' && path[3] === 'reject' && method === 'POST') {
      const { changeRequestModerationService } = await import('@/lib/services/changeRequestModerationService');
      return applyCors(ok(await changeRequestModerationService.reject(await resolveActor(request), path[2], await safeJson(request))), request);
    }

    // Sample privileged endpoint used by tests: verifies live-role authorization.
    if (route === '/admin/ping' && method === 'GET') {
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.MODERATOR);
      return applyCors(ok({ pong: true, role: actor.user.role }), request);
    }

    // ---------- M05.0 SMART CHANNEL IMPORT & ENRICHMENT ----------
    if (route === '/channels/enrich' && method === 'POST') {
      const body = await safeJson(request);
      const { enrichmentService } = await import('@/lib/services/enrichment/enrichmentService');
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
             || request.headers.get('x-real-ip')
             || null;
      const actor = await resolveActor(request).catch(() => null);
      const result = await enrichmentService.enrich(actor, {
        channel_url: String(body?.channel_url || ''),
        force_refresh: !!body?.force_refresh,
        ipAddress: ip,
      });
      const status = result.status === 'rate_limited' ? 429 : 200;
      return applyCors(NextResponse.json({ ok: true, data: result }, { status }), request);
    }

    // ---------- M04 OWNER ANALYTICS ----------
    // GET /api/owner/channels/:id/analytics/overview   ?window=7d|30d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
    // GET /api/owner/channels/:id/analytics/timeseries
    // GET /api/owner/channels/:id/analytics/sources
    // GET /api/owner/channels/:id/analytics/discovery  ?limit=50
    // GET /api/owner/channels/:id/analytics/geo-device
    // GET /api/owner/channels/:id/analytics/export?kind=overview|acquisition|search-terms
    if (path.length === 5 && path[0] === 'owner' && path[1] === 'channels' && path[3] === 'analytics' && method === 'GET') {
      const { analyticsService } = await import('@/lib/services/analyticsService');
      const actor = await resolveActor(request);
      const sp = new URL(request.url).searchParams;
      const q = {
        window: sp.get('window') || undefined,
        from: sp.get('from') || undefined,
        to: sp.get('to') || undefined,
        limit: sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
        compare: sp.get('compare') || undefined,
      };
      const channelId = path[2];
      const sub = path[4];
      if (sub === 'overview') return applyCors(ok(await analyticsService.overview(actor, channelId, q)), request);
      if (sub === 'timeseries') return applyCors(ok(await analyticsService.timeseries(actor, channelId, q)), request);
      if (sub === 'sources') return applyCors(ok(await analyticsService.sources(actor, channelId, q)), request);
      if (sub === 'discovery') return applyCors(ok(await analyticsService.discovery(actor, channelId, q)), request);
      if (sub === 'geo-device') return applyCors(ok(await analyticsService.geoDevice(actor, channelId, q)), request);
      if (sub === 'completeness') return applyCors(ok(await analyticsService.profileCompleteness(actor, channelId)), request);
      if (sub === 'recommendations') return applyCors(ok(await analyticsService.growthRecommendations(actor, channelId, q)), request);
      if (sub === 'export') {
        const { analyticsCsvService } = await import('@/lib/services/analyticsCsvService');
        const kind = (sp.get('kind') || 'overview') as 'overview' | 'acquisition' | 'search-terms';
        const { filename, csv } = await analyticsCsvService.build(actor, channelId, kind, q);
        const res = new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } });
        return applyCors(res, request);
      }
    }

    // ---------- M04 ANALYTICS EVENT INGESTION ----------
    // POST /api/track  body: { event_type, channel_slug|channel_id, source?, placement?, search_query?, category_slug? }
    if (route === '/track' && method === 'POST') {
      const body = await safeJson(request);
      const { trackingService, normalizeReferrerDomain } = await import('@/lib/services/trackingService');
      const { channelRepo } = await import('@/lib/repositories/channelRepo');
      const type = String(body?.event_type || '');
      const cid = body?.channel_id ? String(body.channel_id) : null;
      const cslug = body?.channel_slug ? String(body.channel_slug) : null;
      const channel = cid ? await channelRepo.findById(cid) : (cslug ? await channelRepo.findBySlug(cslug) : null);
      if (!channel || channel.status !== 'approved') return applyCors(fail(200, 'ignored'), request);
      // Anonymous session cookie (wl_anon_id) is set by /go/[slug]; here we
      // just read it if present.
      const anonId = request.cookies.get('wl_anon_id')?.value || null;
      const session = getSessionFromRequest(request);
      const referrer = request.headers.get('referer');
      const ownHosts = new Set<string>();
      try { const base = process.env.NEXT_PUBLIC_BASE_URL; if (base) ownHosts.add(new URL(base).hostname.toLowerCase().replace(/^www\./, '')); } catch { /* ignore */ }
      try { ownHosts.add(new URL(request.url).hostname.toLowerCase().replace(/^www\./, '')); } catch { /* ignore */ }
      const referrerDomain = normalizeReferrerDomain(referrer, ownHosts);
      const base = {
        channelId: channel.id,
        anonymousSessionId: anonId,
        userId: session?.userId ?? null,
        source: body?.source,
        placement: body?.placement ? String(body.placement) : null,
        referrer,
        referrerDomain,
        searchQuery: body?.search_query ? String(body.search_query) : null,
        categorySlug: body?.category_slug ? String(body.category_slug) : null,
        countryCode: (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null),
        deviceType: null,
        pagePath: body?.page_path ? String(body.page_path) : null,
        campaignId: body?.campaign_id ? String(body.campaign_id) : null,
      };
      if (type === 'channel_impression') trackingService.recordChannelImpression(base);
      else if (type === 'search_impression') trackingService.recordSearchImpression({ ...base, searchQuery: String(body?.search_query || '') });
      else if (type === 'channel_profile_view') trackingService.recordProfileView(base);
      else return applyCors(fail(400, 'Unsupported event_type'), request);
      return applyCors(ok({ tracked: true }), request);
    }

    // ---------- M04 ADMIN ROLLUP TRIGGER ----------
    if (route === '/admin/analytics/rollup' && method === 'POST') {
      const { analyticsService } = await import('@/lib/services/analyticsService');
      const body = await safeJson(request);
      const result = await analyticsService.triggerRollup(await resolveActor(request), {
        channel_id: body?.channel_id ? String(body.channel_id) : undefined,
        date_from: body?.date_from ? String(body.date_from) : undefined,
        date_to: body?.date_to ? String(body.date_to) : undefined,
        force: !!body?.force,
        dry_run: !!body?.dry_run,
      });
      return applyCors(ok(result), request);
    }

    return applyCors(fail(404, `Route ${route} not found`), request);
  } catch (err) {
    return applyCors(handleServiceError(err), request);
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
