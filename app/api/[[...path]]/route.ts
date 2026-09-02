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

/**
 * Force-change-password gate for privileged routes.
 * Returns a 428 response if the current actor has must_change_password=true
 * AND the requested route is not in the whitelist. Public routes remain open.
 */
const FORCE_CHANGE_WHITELIST = new Set([
  '/auth/me', '/auth/logout', '/auth/login', '/auth/signup',
  '/me/password', '/health',
]);
const FORCE_CHANGE_GATED_PREFIXES = ['/admin', '/owner', '/me', '/submit', '/dashboard', '/sponsorship-leads', '/dev'];
async function passwordChangeGate(request: NextRequest, route: string): Promise<NextResponse | null> {
  if (FORCE_CHANGE_WHITELIST.has(route)) return null;
  const gated = FORCE_CHANGE_GATED_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`));
  if (!gated) return null;
  const actor = await resolveActor(request);
  if (actor?.user && (actor.user as { must_change_password?: boolean }).must_change_password) {
    return applyCors(fail(428, 'Password change required', { code: 'password_change_required' }), request);
  }
  return null;
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
    // Force-change gate. When admin resets a user's password, must_change_password=true
    // is set on that user (and session_version bumps → old cookie invalidated).
    // After the user logs in with the temp password they hold a *valid* session but MUST
    // change their password before doing anything privileged. Public reads (GET /channels,
    // /categories, homepage, …) remain accessible; only privileged/mutating endpoints
    // and dashboard/admin surfaces are gated. /me/password itself is exempt so the user
    // can actually rotate their password.
    const gate = await passwordChangeGate(request, route);
    if (gate) return gate;

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
      const { user, token, redirect_to } = await authService.signup(body, (body as { next?: unknown })?.next);
      const res = applyCors(ok({ user, redirect_to }), request);
      return setSessionCookie(res, token);
    }
    if (route === '/auth/login' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'login'), 8, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many login attempts, please try again shortly', { retryAfter: rl.retryAfterSeconds }), request);
      const body = await safeJson(request);
      const { user, token, redirect_to } = await authService.login(body, (body as { next?: unknown })?.next);
      const res = applyCors(ok({ user, redirect_to }), request);
      return setSessionCookie(res, token);
    }
    if (route === '/auth/logout' && method === 'POST') {
      return clearSessionCookie(applyCors(ok({ loggedOut: true }), request));
    }

    // ---------- Emergent Managed Google Auth ----------
    // Public endpoints (no session required). The password-change gate whitelist
    // above already excludes /auth/* prefix — no additional gate change needed.
    if (route === '/auth/google/start' && method === 'GET') {
      const { isGoogleAuthEnabled, buildStartUrl } = await import('@/lib/services/auth/emergentGoogleAdapter');
      if (!isGoogleAuthEnabled()) {
        return applyCors(fail(404, 'not_found'), request);
      }
      // Build absolute callback URL from the current request origin — this makes
      // the exact same code work on preview AND on wavelead.org with no changes.
      const origin = request.headers.get('origin')
        || `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host') || ''}`;
      const callback = `${origin.replace(/\/$/, '')}/auth/google/callback`;
      const startUrl = buildStartUrl(callback);
      return NextResponse.redirect(startUrl, 302);
    }
    if (route === '/auth/google/exchange' && method === 'POST') {
      const { isGoogleAuthEnabled, exchangeSessionId, EmergentAuthError } = await import('@/lib/services/auth/emergentGoogleAdapter');
      const { linkAndIssueSession, GoogleLinkError } = await import('@/lib/services/auth/googleLinkService');
      if (!isGoogleAuthEnabled()) {
        return applyCors(fail(404, 'not_found'), request);
      }
      const body = await safeJson(request);
      const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
      if (!sessionId) return applyCors(fail(400, 'session_id_required'), request);
      try {
        const identity = await exchangeSessionId(sessionId);
        const result = await linkAndIssueSession(identity);
        // Compute a role-aware redirect using the freshly-loaded DB user.
        const { userRepo } = await import('@/lib/repositories/userRepo');
        const { resolvePostLoginRedirect } = await import('@/lib/auth/postLoginRedirect');
        const dbUser = await userRepo.findById(result.user_id);
        const redirect_to = dbUser
          ? resolvePostLoginRedirect({ user: dbUser as unknown as import('@/lib/types').PublicUser, next: (body as { next?: unknown })?.next })
          : '/dashboard';
        const res = applyCors(ok({ user_id: result.user_id, linked: result.linked, redirect_to }), request);
        return setSessionCookie(res, result.token);
      } catch (e) {
        if (e instanceof EmergentAuthError) return applyCors(fail(e.httpStatus, e.code), request);
        if (e instanceof GoogleLinkError)  return applyCors(fail(e.httpStatus, e.code), request);
        // Never leak internals to the client.
        return applyCors(fail(500, 'google_auth_failed'), request);
      }
    }

    if (route === '/auth/me' && method === 'GET') {
      // No cookie / bad JWT → visitor (200, user:null).
      // Valid JWT but stale session (bumped version OR disabled) → 401 so the client
      // clears the dead cookie. This is the enforcement point for password-reset /
      // account-disable session invalidation.
      const session = getSessionFromRequest(request);
      if (!session) return applyCors(ok({ user: null }), request);
      const actor = await resolveActor(request);
      if (!actor) return applyCors(fail(401, 'Session invalidated'), request);
      return applyCors(ok({ user: actor.user }), request);
    }

    // Phase 3 — SaaS entitlements introspection. Returns the effective plan
    // + resolved entitlements for the current actor. Non-authoritative — the
    // client uses this only to hint UI; every mutating endpoint re-checks
    // entitlements server-side via requireEntitlement / requireQuota.
    if (route === '/entitlements/me' && method === 'GET') {
      const actor = await resolveActor(request);
      const { resolveEntitlements, getUserPlan, serializeEntitlements } = await import('@/lib/entitlements');
      const ent = resolveEntitlements(actor);
      return applyCors(ok({
        plan: actor ? getUserPlan(actor.user) : 'free',
        is_admin_bypass: !!(actor && (actor.user.role === 'admin' || actor.user.role === 'super_admin')),
        entitlements: serializeEntitlements(ent),
      }), request);
    }

    // ---------- PREVIEW-ONLY QA BOOTSTRAP ----------
    // Idempotent provisioning of the three canonical QA personas so a human
    // reviewer can log in and exercise M06.0 flows. Passwords are read from
    // Emergent Secrets env vars only; never returned in the response.
    // Hard-gated to non-production + QA_SEED_ENABLED=true.
    if (route === '/dev/qa-bootstrap') {
      const { isQaBootstrapEnabled, runQaPersonaSeed } = await import('@/lib/seed/qaPersonaSeed');
      const gate = isQaBootstrapEnabled();
      if (!gate.enabled) {
        return applyCors(fail(403, 'QA bootstrap disabled', { reason: gate.reason }), request);
      }
      if (method === 'GET') {
        return applyCors(ok({ enabled: true, note: 'POST to provision QA personas.' }), request);
      }
      if (method === 'POST') {
        const rl = rateLimit(clientKey(request, 'qa-bootstrap'), 5, 60_000);
        if (!rl.allowed) return applyCors(fail(429, 'Too many QA bootstrap attempts', { retryAfter: rl.retryAfterSeconds }), request);
        const result = await runQaPersonaSeed();
        // Also idempotently seed the QA USD/IDR fixture rate.
        try {
          const { seedQaFxRateIfEnabled } = await import('@/lib/seed/qaFxRateSeed');
          const fx = await seedQaFxRateIfEnabled();
          (result as unknown as Record<string, unknown>).fx_rate = fx.row
            ? { id: fx.row.id, base_currency: fx.row.base_currency, quote_currency: fx.row.quote_currency, rate_scaled: fx.row.rate_scaled, rate_scale: fx.row.rate_scale, active: fx.row.active, seeded: fx.seeded }
            : { seeded: false, reason: fx.reason };
        } catch { /* seeding is best-effort; personas still returned */ }
        // Never include passwords in the response.
        return applyCors(ok(result), request);
      }
    }

    // ---------- M06.1 FX RATES ----------
    if (route === '/admin/fx-rates') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { fxAdminService } = await import('@/lib/services/fx/fxAdminService');
      if (method === 'GET') {
        const rows = await fxAdminService.list();
        const active = rows.find((r) => r.active) ?? null;
        return applyCors(ok({ items: rows, active }), request);
      }
      if (method === 'POST') {
        const body = (await request.json()) as { rate_scaled?: number; rate_scale?: number; note?: string };
        const row = await fxAdminService.createAndActivate(actor, {
          base_currency: 'USD', quote_currency: 'IDR',
          rate_scaled: Number(body.rate_scaled), rate_scale: Number(body.rate_scale),
          note: body.note,
        });
        return applyCors(ok({ rate: row }), request);
      }
    }
    if (route.startsWith('/admin/fx-rates/') && path[2] === 'deactivate' && method === 'POST') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { fxAdminService } = await import('@/lib/services/fx/fxAdminService');
      await fxAdminService.deactivate(actor, path[3]);
      return applyCors(ok({ ok: true }), request);
    }
    // Public: current active USD→IDR display rate (safe to return — no secrets, no rates from third parties).
    if (route === '/fx/rate' && method === 'GET') {
      const { fxRateProvider } = await import('@/lib/services/fx/fxRateProvider');
      const r = await fxRateProvider.getActiveRate('USD', 'IDR');
      if (!r) return applyCors(ok({ active: null }), request);
      return applyCors(ok({ active: { base_currency: r.base_currency, quote_currency: r.quote_currency, rate_scaled: r.rate_scaled, rate_scale: r.rate_scale, effective_from: r.effective_from } }), request);
    }
    // Owner: preview an IDR equivalent quote for an owned campaign (server-side conversion; no payment authority).
    if (route.startsWith('/owner/campaigns/') && path[3] === 'fx-preview' && method === 'GET') {
      const actor = await resolveActor(request);
      if (!actor) return applyCors(fail(401, 'Unauthorized'), request);
      const { promotionCampaignRepo } = await import('@/lib/repositories/promotionRepo');
      const camp = await promotionCampaignRepo.findById(path[2]);
      if (!camp) return applyCors(fail(404, 'Not found'), request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);
      if (!isAdmin && camp.owner_user_id !== actor.user.id) return applyCors(fail(403, 'Forbidden'), request);
      const { fxQuoteService } = await import('@/lib/services/fx/fxQuoteService');
      const preview = await fxQuoteService.previewIdrForCampaign(camp.budget_total_usd_minor * 10000);
      return applyCors(ok({ preview, campaign_usd_micros: camp.budget_total_usd_minor * 10000 }), request);
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
      const bundle = await discoveryService.getHomepageBundle();
      const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
      const anonId = request.cookies.get('wl_anon_id')?.value || null;
      const country = (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null);
      const sponsored = await promotionDeliveryService.selectCandidates({
        placement: 'sponsored_homepage', anonymous_session_id: anonId, country_code: country,
      }, 1).catch(() => []);
      return applyCors(ok({ ...bundle, sponsored }), request);
    }
    if (route === '/channels/rising' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '6', 10) || 6, 24);
      // Rising = trending. NO sponsored inventory here.
      return applyCors(ok({ items: await discoveryService.getRising(limit) }), request);
    }
    if (route === '/channels/top' && method === 'GET') {
      const { discoveryService } = await import('@/lib/services/discoveryService');
      const sp = new URL(request.url).searchParams;
      const country = sp.get('country') || undefined;
      const limit = Math.min(parseInt(sp.get('limit') || '10', 10) || 10, 50);
      // Top = organic ranking. NO sponsored inventory here.
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
      // Sponsored delivery — separate array, never mutates organic result.
      // - `q` present → sponsored_search
      // - `category` present → sponsored_category
      // - `country` present → sponsored_country
      // - `sort=trending|top` → NO sponsored inventory
      const sort = sp.get('sort');
      const q = sp.get('q');
      const category = sp.get('category');
      const country = sp.get('country');
      let placement: 'sponsored_search' | 'sponsored_category' | 'sponsored_country' | null = null;
      if (sort !== 'trending' && sort !== 'top') {
        if (q) placement = 'sponsored_search';
        else if (category) placement = 'sponsored_category';
        else if (country) placement = 'sponsored_country';
      }
      let sponsored: unknown[] = [];
      if (placement) {
        const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
        const anonId = request.cookies.get('wl_anon_id')?.value || null;
        const ipCountry = (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null);
        sponsored = await promotionDeliveryService.selectCandidates({
          placement,
          anonymous_session_id: anonId,
          country_code: country || ipCountry,
          category_slug: category,
          search_query: q,
        }, 1).catch(() => []);
      }
      return applyCors(ok({ ...result, sponsored }), request);
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
      // Related sponsored candidates — never self-promote.
      const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
      const anonId = request.cookies.get('wl_anon_id')?.value || null;
      const ipCountry = (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null);
      const sponsored = await promotionDeliveryService.selectCandidates({
        placement: 'sponsored_related_channel',
        anonymous_session_id: anonId,
        country_code: c.country_code || ipCountry,
        category_slug: (c as unknown as { category_slug?: string }).category_slug || null,
        exclude_channel_id: c.id,
      }, 1).catch(() => []);
      return applyCors(ok({ channel: c, sponsored }), request);
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
    // M03.7 — Admin "Verify Current Owner": preserves owner_id, flips
    // verification_status to 'verified' without creating a claim owned by
    // the admin. See claimModerationService.verifyCurrentOwner.
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'channels' && path[3] === 'verify-current-owner' && method === 'POST') {
      const { claimModerationService } = await import('@/lib/services/claimModerationService');
      return applyCors(ok(await claimModerationService.verifyCurrentOwner(await resolveActor(request), path[2], await safeJson(request))), request);
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

    // ---------- M06.0 PAYMENTS / CAMPAIGN FUNDING ----------
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'funding' && method === 'POST') {
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      // Resolve an origin that the incoming request is allowed to use; if the
      // effective host isn't in the allowlist we fall back to the configured
      // canonical origin. This is the ONLY point where request headers touch
      // PayPal return/cancel URL construction.
      const trustedOrigin = resolveTrustedOrigin(request.headers);
      const f = await campaignFundingService.createFundingForCampaign(await resolveActor(request), path[2], trustedOrigin);
      return applyCors(ok({ funding: { id: f.id, status: f.status, approve_url: f.approve_url, amount_minor: f.amount_minor, currency: f.currency } }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'funding-summary' && method === 'GET') {
      const actor = await resolveActor(request);
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      await promotionCampaignService.getForOwner(actor, path[2]); // enforces ownership
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      return applyCors(ok(await campaignFundingService.fundingSummary(path[2])), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'funding-orders' && method === 'GET') {
      const actor = await resolveActor(request);
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      await promotionCampaignService.getForOwner(actor, path[2]); // enforces ownership
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const rows = await paymentFundingOrderRepo.listForCampaign(path[2]);
      // Never leak provider-raw responses or captured amounts on other users.
      const items = rows.map((r) => ({
        id: r.id, status: r.status,
        amount_minor: r.amount_minor,
        amount_captured_minor: r.amount_captured_minor,
        amount_refunded_minor: r.amount_refunded_minor,
        currency: r.currency,
        approve_url: r.approve_url,
        provider_order_id: r.provider_order_id,
        created_at: r.created_at,
      }));
      return applyCors(ok({ items }), request);
    }
    if (path.length === 3 && path[0] === 'payments' && path[1] === 'funding' && method === 'GET') {
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      return applyCors(ok({ funding: await campaignFundingService.getFunding(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'payments' && path[1] === 'funding' && path[3] === 'capture' && method === 'POST') {
      // Buyer-return capture. Cross-owner isolation: only the funding owner (or admin) may trigger.
      const actor = await resolveActor(request);
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      await campaignFundingService.getFunding(actor, path[2]); // authz guard
      const funding = await campaignFundingService.captureAndFinalize(path[2]);
      return applyCors(ok({ funding: { id: funding.id, status: funding.status } }), request);
    }
    // ---------- M06.0 Phase 4 — OWNER BILLING ----------
    if (route === '/owner/billing' && method === 'GET') {
      const actor = await resolveActor(request);
      if (!actor) return applyCors(fail(401, 'Authentication required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const rows = await paymentFundingOrderRepo.list({ owner_user_id: actor.user.id });
      const { promotionCampaignRepo } = await import('@/lib/repositories/promotionRepo');
      const items = await Promise.all(rows.map(async (r) => {
        const camp = await promotionCampaignRepo.findById(r.campaign_id);
        return {
          id: r.id, provider: r.provider, status: r.status,
          amount_minor: r.amount_minor, amount_captured_minor: r.amount_captured_minor,
          amount_refunded_minor: r.amount_refunded_minor, currency: r.currency,
          created_at: r.created_at, paid_at: r.paid_at,
          campaign_id: r.campaign_id, campaign_name: camp?.name || null,
          provider_reference: r.provider_order_id ? r.provider_order_id.slice(0, 12) + '…' : null,
        };
      }));
      return applyCors(ok({ items }), request);
    }
    if (path.length === 3 && path[0] === 'owner' && path[1] === 'billing' && method === 'GET') {
      const actor = await resolveActor(request);
      if (!actor) return applyCors(fail(401, 'Authentication required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const f = await paymentFundingOrderRepo.findById(path[2]);
      if (!f || f.owner_user_id !== actor.user.id) return applyCors(fail(404, 'Payment not found'), request);
      const { promotionCampaignRepo } = await import('@/lib/repositories/promotionRepo');
      const { paymentRefundRepo } = await import('@/lib/repositories/paymentRefundRepo');
      const camp = await promotionCampaignRepo.findById(f.campaign_id);
      const refunds = await paymentRefundRepo.list({ funding_order_id: f.id });
      return applyCors(ok({
        payment: {
          id: f.id, provider: f.provider, status: f.status, currency: f.currency,
          amount_minor: f.amount_minor, amount_captured_minor: f.amount_captured_minor,
          amount_refunded_minor: f.amount_refunded_minor,
          paid_at: f.paid_at, created_at: f.created_at,
          campaign_id: f.campaign_id, campaign_name: camp?.name || null,
          provider_reference: f.provider_order_id ? f.provider_order_id.slice(0, 12) + '…' : null,
          provider_capture_reference: f.provider_capture_id ? f.provider_capture_id.slice(0, 12) + '…' : null,
        },
        refunds: refunds.map((r) => ({
          id: r.id, status: r.status,
          requested_amount_minor: r.requested_amount_minor,
          actual_refunded_amount_minor: r.actual_refunded_amount_minor,
          requested_at: r.requested_at, processed_at: r.processed_at,
          reason: r.reason,
        })),
      }), request);
    }
    // ---------- M06.0 Phase 4 — ADMIN PAYMENTS / REFUNDS / LEDGER / HEALTH ----------
    if (route === '/admin/payments' && method === 'GET') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const rows = await paymentFundingOrderRepo.list({});
      const items = rows.map((r) => ({
        id: r.id, provider: r.provider, status: r.status,
        amount_minor: r.amount_minor, amount_captured_minor: r.amount_captured_minor,
        amount_refunded_minor: r.amount_refunded_minor, currency: r.currency,
        campaign_id: r.campaign_id, owner_user_id: r.owner_user_id,
        created_at: r.created_at, paid_at: r.paid_at,
      }));
      return applyCors(ok({ items }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'payments' && method === 'GET') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const f = await paymentFundingOrderRepo.findById(path[2]);
      if (!f) return applyCors(fail(404, 'Payment not found'), request);
      const { promotionCampaignRepo } = await import('@/lib/repositories/promotionRepo');
      const { paymentRefundRepo } = await import('@/lib/repositories/paymentRefundRepo');
      const { refundService } = await import('@/lib/services/payments/refundService');
      const camp = await promotionCampaignRepo.findById(f.campaign_id);
      const refunds = await paymentRefundRepo.list({ funding_order_id: f.id });
      const refundability = await refundService.computeRefundability(f.campaign_id);
      return applyCors(ok({
        payment: {
          id: f.id, provider: f.provider, status: f.status, currency: f.currency,
          amount_minor: f.amount_minor, amount_captured_minor: f.amount_captured_minor,
          amount_refunded_minor: f.amount_refunded_minor,
          paid_at: f.paid_at, created_at: f.created_at,
          campaign_id: f.campaign_id, campaign_name: camp?.name || null,
          owner_user_id: f.owner_user_id,
          provider_order_reference: f.provider_order_id,
          provider_capture_reference: f.provider_capture_id,
        },
        refundability,
        refunds: refunds.map((r) => ({
          id: r.id, status: r.status,
          requested_amount_minor: r.requested_amount_minor,
          actual_refunded_amount_minor: r.actual_refunded_amount_minor,
          provider_refund_id: r.provider_refund_id,
          requested_at: r.requested_at, processed_at: r.processed_at,
          failed_at: r.failed_at, failure_reason: r.failure_reason,
          reason: r.reason,
        })),
      }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'payments' && path[3] === 'reconcile' && method === 'POST') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { paymentReconciliationService } = await import('@/lib/services/payments/paymentReconciliationService');
      const out = await paymentReconciliationService.reconcileFundingOrder(path[2]);
      return applyCors(ok(out), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'payments' && path[3] === 'refunds' && method === 'POST') {
      // Admin opens a new refund request for a funding order (rare path — the
      // usual path is owner cancel auto-creates). Body may include a reason.
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const f = await paymentFundingOrderRepo.findById(path[2]);
      if (!f) return applyCors(fail(404, 'Payment not found'), request);
      const { refundService } = await import('@/lib/services/payments/refundService');
      // Build synthetic owner actor for the request (executed_by set to admin later).
      const ownerActor = { user: { id: f.owner_user_id, role: 'user' }, session: null } as unknown as import('@/lib/types').Actor;
      const refund = await refundService.requestRefundForCancelledCampaign(ownerActor, f.campaign_id);
      return applyCors(ok({ refund }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'refunds' && path[3] === 'execute' && method === 'POST') {
      const actor = await resolveActor(request);
      const { refundService } = await import('@/lib/services/payments/refundService');
      const r = await refundService.executeRefund(actor, path[2]);
      return applyCors(ok({ refund: r }), request);
    }
    if (route === '/admin/ledger' && method === 'GET') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
      const filter: Record<string, unknown> = {};
      const url = new URL(request.url);
      const campaignId = url.searchParams.get('campaign_id');
      const type = url.searchParams.get('transaction_type');
      const idempKey = url.searchParams.get('idempotency_key');
      if (campaignId) filter.campaign_id = campaignId;
      if (type) filter.transaction_type = type;
      if (idempKey) filter.idempotency_key = idempKey;
      const rows = await ledgerRepo.list(filter);
      return applyCors(ok({ items: rows.map((t) => {
        const dr = t.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
        const cr = t.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
        return {
          id: t.id, transaction_type: t.transaction_type, campaign_id: t.campaign_id,
          idempotency_key: t.idempotency_key, funding_order_id: t.funding_order_id,
          reference_event_id: t.reference_event_id, amount_usd_micros: t.amount_usd_micros,
          postings: t.postings, debits_micros: dr, credits_micros: cr,
          balanced: dr === cr, created_at: t.created_at,
        };
      })}), request);
    }
    if (route === '/admin/payment-health' && method === 'GET') {
      const actor = await resolveActor(request);
      const { rankOf, ROLES } = await import('@/lib/auth/rbac');
      if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) return applyCors(fail(403, 'Admin privileges required'), request);
      const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
      const { paymentRefundRepo } = await import('@/lib/repositories/paymentRefundRepo');
      const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
      const { getCollection } = await import('@/lib/db/mongo');
      const { COLLECTIONS } = await import('@/lib/db/collections');
      const all = await paymentFundingOrderRepo.list({});
      const pending = all.filter((f) => ['created', 'checkout_created', 'pending'].includes(f.status)).length;
      const failed = all.filter((f) => f.status === 'failed').length;
      const refunds = await paymentRefundRepo.list({});
      const refunds_pending = refunds.filter((r) => ['pending', 'processing'].includes(r.status)).length;
      const refunds_failed = refunds.filter((r) => r.status === 'failed').length;
      const webhookColl = await getCollection<{ processed?: boolean; process_error?: string | null }>(COLLECTIONS.PAYMENT_WEBHOOK_EVENTS);
      const webhook_failed = await webhookColl.countDocuments({ processed: true, process_error: { $ne: null } });
      const integrity = await ledgerService.checkIntegrityCount();
      const reconciliation_needed = all.filter((f) => f.status === 'pending' && f.provider_order_id).length;
      // M06.1: local payment provider readiness signals (informational, never a health error).
      const { fxRateProvider } = await import('@/lib/services/fx/fxRateProvider');
      const { PAYPAL_CAPABILITIES, LOCAL_PAYMENT_CAPABILITIES } = await import('@/lib/services/payments/paymentProviderCapabilities');
      // M07-security: enrich PayPal readiness with vault/env source, mode, connection test.
      const { paypalConfigService, apiHostFor, readActiveEnvironment } = await import('@/lib/services/payments/paypalConfigService');
      const activeCfg = await paypalConfigService.resolveActive();
      const persistedEnv = await readActiveEnvironment();
      const activeMode = activeCfg?.environment ?? null;
      const paypalStatus = activeCfg ? 'configured' : 'not_configured';
      const activeEnvStatus = activeMode ? await paypalConfigService.status(activeMode) : null;
      const activeFx = await fxRateProvider.getActiveRate('USD', 'IDR');
      return applyCors(ok({
        pending_payments: pending,
        failed_payments: failed,
        refunds_pending, refunds_failed,
        webhook_processing_failures: webhook_failed,
        ledger_integrity_issues: integrity,
        reconciliation_needed_count: reconciliation_needed,
        // M06.1 provider readiness + M07-security config source
        providers: {
          paypal: {
            ...PAYPAL_CAPABILITIES,
            status: paypalStatus,
            configured: !!activeCfg,
            mode: activeMode,
            api_host: activeCfg?.api_host ?? apiHostFor(persistedEnv.environment),
            credential_source: activeCfg?.source ?? null,
            environment_source: persistedEnv.source,          // 'db' | 'env' | 'default'
            persisted_environment: persistedEnv.environment,  // what the admin last chose
            webhook_configured: !!activeCfg?.webhook_id,
            last_connection_test_status: activeEnvStatus?.last_connection_test_status ?? null,
            last_connection_test_at: activeEnvStatus?.last_connection_test_at ?? null,
            real_money_enabled: activeMode === 'live',
          },
          local: { ...LOCAL_PAYMENT_CAPABILITIES, status: 'not_configured' },
        },
        fx: activeFx
          ? { base: activeFx.base_currency, quote: activeFx.quote_currency, rate_scaled: activeFx.rate_scaled, rate_scale: activeFx.rate_scale, status: 'configured' }
          : { status: 'missing' },
      }), request);
    }
    // PayPal webhook. Public endpoint. Verifies signature via PayPal API.
    if (route === '/payments/paypal/webhook' && method === 'POST') {
      const raw_body = await request.text();
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      const { getPaymentProvider } = await import('@/lib/services/payments/providerFactory');
      const provider = getPaymentProvider();
      const v = await provider.verifyWebhook({ headers, raw_body });
      if (!v.valid) {
        // Never leak reason to caller \u2014 200 with generic body to avoid replay pings.
        return applyCors(fail(400, 'invalid_webhook'), request);
      }
      const { paymentWebhookEventRepo } = await import('@/lib/repositories/paymentRepo');
      const { v4: uuidv4 } = await import('uuid');
      const { inserted } = await paymentWebhookEventRepo.recordIfAbsent({
        id: uuidv4(), provider: 'paypal', provider_event_id: v.event_id!, event_type: v.event_type!,
        raw_payload: JSON.parse(raw_body || '{}'), processed: false, processed_at: null, process_error: null,
        received_at: new Date(),
      });
      if (!inserted) {
        // Duplicate delivery \u2014 already recorded, safe to ack.
        return applyCors(ok({ recorded: true, duplicate: true }), request);
      }
      try {
        const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
        const { marketplaceService } = await import('@/lib/services/marketplaceService');
        const resource = (v.resource || {}) as Record<string, unknown>;
        if (v.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
          // PayPal capture resource carries supplementary_data.related_ids.order_id
          const orderId = extractPayPalOrderId(resource);
          const captureId = String(resource.id || '');
          const amtObj = (resource.amount || {}) as { value?: string; currency_code?: string };
          const amt_minor = amtObj.value ? Math.round(parseFloat(amtObj.value) * 100) : 0;
          const currency = String(amtObj.currency_code || 'USD');
          // Extract exact PayPal fee if PayPal provided a
          // seller_receivable_breakdown. Missing → null (never zero).
          const srb = (resource as { seller_receivable_breakdown?: {
            paypal_fee?: { value?: string; currency_code?: string };
            net_amount?: { value?: string; currency_code?: string };
          }}).seller_receivable_breakdown;
          const feeVal = srb?.paypal_fee?.value;
          const netVal = srb?.net_amount?.value;
          const fee_minor: number | null = typeof feeVal === 'string' ? Math.round(parseFloat(feeVal) * 100) : null;
          const net_minor: number | null = typeof netVal === 'string' ? Math.round(parseFloat(netVal) * 100) : null;
          if (orderId && captureId && amt_minor > 0) {
            // First try marketplace (B3). Falls through to promote when not found.
            const mp = await marketplaceService.finalizeMarketplaceCaptureFromWebhook(orderId, captureId, amt_minor, currency, fee_minor, net_minor);
            if (!mp) {
              await campaignFundingService.finalizePaidByProviderOrderId(orderId, captureId, amt_minor);
            }
          }
        } else if (v.event_type === 'CHECKOUT.ORDER.APPROVED') {
          // Buyer approved on PayPal side. Trigger the same idempotent capture
          // pipeline as the browser-return route — either race can win.
          const orderId = String(resource.id || '');
          if (orderId) {
            // First check marketplace attempt; if not found, fall through to promote.
            let handled = false;
            try {
              const mp = await marketplaceService.captureMarketplacePaypalOrderByProviderOrderId(orderId);
              handled = !!mp;
            } catch { /* server-side capture may race with return-callback; guards dedupe */ }
            if (!handled) {
              try { await campaignFundingService.captureFundingOrderByProviderOrderId(orderId); } catch { /* server-side capture may race with return-callback; the ledger guard dedupes */ }
            }
          }
        } else if (v.event_type === 'PAYMENT.CAPTURE.REFUNDED' || v.event_type === 'PAYMENT.CAPTURE.REVERSED') {
          const orderId = extractPayPalOrderId(resource);
          const amtVal = ((resource.amount || {}) as { value?: string }).value;
          const amt_minor = amtVal ? Math.round(parseFloat(amtVal) * 100) : 0;
          const refundRef = String(resource.id || '');
          if (orderId && refundRef && amt_minor > 0) {
            // Marketplace-first routing; refund/reversal blocks marketplace payout.
            const mp = await marketplaceService.recordMarketplaceRefundOrReversal(
              orderId,
              v.event_type === 'PAYMENT.CAPTURE.REFUNDED' ? 'MARKETPLACE_PAYMENT_REFUNDED' : 'MARKETPLACE_PAYMENT_REVERSED',
              amt_minor,
              refundRef,
            );
            if (!mp) {
              await campaignFundingService.recordRefund(orderId, amt_minor, refundRef);
            }
          }
        }
        // PAYMENT.CAPTURE.DENIED is audit-only; the capture flow already marks
        // the funding as failed when PayPal declines the instrument.
        await paymentWebhookEventRepo.markProcessed(v.event_id!, true, null);
      } catch (err) {
        await paymentWebhookEventRepo.markProcessed(v.event_id!, false, (err as Error).message.slice(0, 500));
        return applyCors(fail(500, 'processing_failed'), request);
      }
      return applyCors(ok({ recorded: true }), request);
    }

    // ---------- M05.1 PROMOTE CHANNEL / SPONSORED DISCOVERY ----------
    // Owner endpoints
    if (route === '/owner/promotions' && method === 'GET') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ items: await promotionCampaignService.listForOwner(await resolveActor(request)) }), request);
    }
    if (route === '/owner/promotions' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      const camp = await promotionCampaignService.create(await resolveActor(request), await safeJson(request));
      return applyCors(ok({ campaign: camp }), request);
    }
    if (path.length === 3 && path[0] === 'owner' && path[1] === 'promotions' && method === 'GET') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.getForOwner(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 3 && path[0] === 'owner' && path[1] === 'promotions' && method === 'PATCH') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.patch(await resolveActor(request), path[2], await safeJson(request)) }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'submit' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.submit(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'pause' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.pause(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'resume' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.resume(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'cancel' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.cancel(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'promotions' && path[3] === 'report' && method === 'GET') {
      const { promotionReportingService } = await import('@/lib/services/promotion/reportingService');
      return applyCors(ok(await promotionReportingService.forOwner(await resolveActor(request), path[2])), request);
    }
    // Admin endpoints
    if (route === '/admin/promotions' && method === 'GET') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      const status = new URL(request.url).searchParams.get('status') || undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return applyCors(ok({ items: await promotionCampaignService.listForAdmin(await resolveActor(request), status as any) }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'promotions' && method === 'GET') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.getForAdmin(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'promotions' && path[3] === 'approve' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.approve(await resolveActor(request), path[2]) }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'promotions' && path[3] === 'reject' && method === 'POST') {
      const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
      return applyCors(ok({ campaign: await promotionCampaignService.reject(await resolveActor(request), path[2], await safeJson(request)) }), request);
    }
    // Rate cards (admin/super_admin)
    if (route === '/admin/promotion-rates' && method === 'GET') {
      const actor = await resolveActor(request); requireRole(actor, ROLES.ADMIN);
      const { promotionRateCardRepo } = await import('@/lib/repositories/promotionRepo');
      return applyCors(ok({ items: await promotionRateCardRepo.list() }), request);
    }
    if (route === '/admin/promotion-rates' && method === 'POST') {
      const actor = await resolveActor(request); requireRole(actor, ROLES.ADMIN);
      const { rateCardUpsertSchema } = await import('@/lib/validation/promotion');
      const parsed = rateCardUpsertSchema.safeParse(await safeJson(request));
      if (!parsed.success) return applyCors(fail(400, parsed.error.issues[0]?.message || 'Invalid rate'), request);
      const { promotionRateCardRepo } = await import('@/lib/repositories/promotionRepo');
      const now = new Date();
      const { v4: uuidv4 } = await import('uuid');
      const doc = {
        id: uuidv4(),
        placement: parsed.data.placement,
        country_code: parsed.data.country_code,
        pricing_model: 'cpm' as const,
        cpm_usd_minor: parsed.data.cpm_usd_minor,
        active: parsed.data.active,
        effective_from: parsed.data.effective_from ? new Date(parsed.data.effective_from) : now,
        effective_to: parsed.data.effective_to ? new Date(parsed.data.effective_to) : null,
        is_fixture: false,
        seed_key: null,
        created_at: now,
        updated_at: now,
        created_by: actor.user.id,
      };
      return applyCors(ok({ card: await promotionRateCardRepo.insert(doc) }), request);
    }
    if (path.length === 2 && path[0] === 'admin' && path[1] === 'promotion-rates' && method === 'PATCH') {
      const actor = await resolveActor(request); requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const { promotionRateCardRepo } = await import('@/lib/repositories/promotionRepo');
      const patch: Record<string, unknown> = {};
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (typeof body.cpm_usd_minor === 'number') patch.cpm_usd_minor = body.cpm_usd_minor;
      if (body.effective_to !== undefined) patch.effective_to = body.effective_to ? new Date(String(body.effective_to)) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await promotionRateCardRepo.update(String(body.id), patch as any);
      return applyCors(ok({ updated: true }), request);
    }
    // Sponsored impression acknowledgement.
    // Client calls after the sponsored card is actually rendered/visible.
    // Enforces frequency cap, budget, and creates the paid impression event.
    if (route === '/track/sponsored/impression' && method === 'POST') {
      const body = await safeJson(request);
      const token = String(body?.attribution_token || '');
      const anonId = request.cookies.get('wl_anon_id')?.value || null;
      const { verifyAttributionToken } = await import('@/lib/services/promotion/attributionTokenService');
      const v = verifyAttributionToken(token, { anonymous_session_id: anonId });
      if (!v.valid) return applyCors(ok({ recorded: false, reason: v.reason }), request);
      const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
      const ack = await promotionDeliveryService.acknowledgeImpression({
        campaign_id: v.payload.campaign_id,
        placement: v.payload.placement,
        anonymous_session_id: anonId,
        country_code: (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null),
        // Stable per-candidate id from the signed attribution token — same
        // ack retried 10× produces exactly one billable impression.
        impression_event_id: v.payload.jti,
      });
      if (!ack.recorded) return applyCors(ok({ recorded: false, reason: ack.reason }), request);
      // Record the sponsored channel impression event.
      const { trackingService } = await import('@/lib/services/trackingService');
      trackingService.recordChannelImpression({
        channelId: v.payload.channel_id,
        anonymousSessionId: anonId,
        userId: null,
        source: v.payload.source,
        placement: v.payload.placement,
        campaignId: v.payload.campaign_id,
        trafficType: 'sponsored',
        countryCode: (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null),
      });
      return applyCors(ok({ recorded: true, unit_spend_usd_minor: ack.unit_spend_usd_minor }), request);
    }
    // Sponsored profile view acknowledgement.
    if (route === '/track/sponsored/profile-view' && method === 'POST') {
      const body = await safeJson(request);
      const token = String(body?.attribution_token || '');
      const anonId = request.cookies.get('wl_anon_id')?.value || null;
      const { verifyAttributionToken } = await import('@/lib/services/promotion/attributionTokenService');
      const v = verifyAttributionToken(token, { anonymous_session_id: anonId });
      if (!v.valid) return applyCors(ok({ recorded: false, reason: v.reason }), request);
      const { trackingService } = await import('@/lib/services/trackingService');
      trackingService.recordProfileView({
        channelId: v.payload.channel_id,
        anonymousSessionId: anonId,
        userId: null,
        source: v.payload.source,
        placement: v.payload.placement,
        campaignId: v.payload.campaign_id,
        trafficType: 'sponsored',
        countryCode: (request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null),
      });
      return applyCors(ok({ recorded: true }), request);
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

    // ---------- M07-SECURITY — ACCOUNT SECURITY ----------
    if (route === '/me/password' && method === 'POST') {
      const { accountSecurityService } = await import('@/lib/services/security/accountSecurityService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.USER);
      const body = await safeJson(request);
      await accountSecurityService.changeOwnPassword(actor!, String(body?.current_password || ''), String(body?.new_password || ''));
      return applyCors(ok({ ok: true }), request);
    }
    // ---------- M07-SECURITY — SUPER ADMIN USERS ----------
    if (route === '/admin/users' && method === 'GET') {
      const { adminUserService } = await import('@/lib/services/security/adminUserService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const { searchParams } = new URL(request.url);
      const items = await adminUserService.search(actor!, (searchParams.get('q') || '').trim());
      return applyCors(ok({ items }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'users' && method === 'GET') {
      const { adminUserService } = await import('@/lib/services/security/adminUserService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const user = await adminUserService.getById(actor!, path[2]);
      return applyCors(ok({ user }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'users' && path[3] === 'reset-password' && method === 'POST') {
      const { accountSecurityService } = await import('@/lib/services/security/accountSecurityService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const result = await accountSecurityService.adminResetPassword(actor!, path[2]);
      return applyCors(ok(result), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'users' && path[3] === 'disable' && method === 'POST') {
      const { accountSecurityService } = await import('@/lib/services/security/accountSecurityService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const body = await safeJson(request);
      await accountSecurityService.setDisabled(actor!, path[2], !!body?.disabled);
      return applyCors(ok({ ok: true }), request);
    }
    if (path.length === 4 && path[0] === 'admin' && path[1] === 'users' && path[3] === 'force-change' && method === 'POST') {
      const { accountSecurityService } = await import('@/lib/services/security/accountSecurityService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      await accountSecurityService.setMustChangePassword(actor!, path[2]);
      return applyCors(ok({ ok: true }), request);
    }
    // ---------- M07-SECURITY — SUPER ADMIN PAYPAL SETTINGS ----------
    if (route === '/admin/settings/paypal' && method === 'GET') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const status = await paypalAdminService.currentStatus(actor!);
      return applyCors(ok(status), request);
    }
    if (route === '/admin/settings/paypal' && method === 'POST') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const body = await safeJson(request);
      const res = await paypalAdminService.upsert(actor!, body);
      return applyCors(ok(res), request);
    }
    if (route === '/admin/settings/paypal/test-connection' && method === 'POST') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const body = await safeJson(request);
      const res = await paypalAdminService.testConnection(actor!, body);
      return applyCors(ok(res), request);
    }
    if (route === '/admin/settings/paypal/import-env' && method === 'POST') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const res = await paypalAdminService.importFromEnv(actor!);
      return applyCors(ok(res), request);
    }
    // M07 activation patch — DB-persisted active_environment switching.
    if (route === '/admin/settings/paypal/activate-live' && method === 'POST') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const body = await safeJson(request);
      const res = await paypalAdminService.activateLive(actor!, body);
      return applyCors(ok(res), request);
    }
    if (route === '/admin/settings/paypal/switch-to-sandbox' && method === 'POST') {
      const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.SUPER_ADMIN);
      const body = await safeJson(request);
      const res = await paypalAdminService.switchToSandbox(actor!, body);
      return applyCors(ok(res), request);
    }

    // ---------- M07-LITE SPONSORSHIP LEADS ----------
    if (route === '/sponsorship-leads' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'sponsor-lead'), 20, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many requests'), request);
      const { sponsorshipLeadService } = await import('@/lib/services/sponsorshipLeadService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const lead = await sponsorshipLeadService.create(actor, body);
      return applyCors(ok({ lead: { id: lead.id, status: lead.status, created_at: lead.created_at, channel_slug_snapshot: lead.channel_slug_snapshot, channel_name_snapshot: lead.channel_name_snapshot } }, { status: 201 }), request);
    }
    if (route === '/me/sponsorship-leads' && method === 'GET') {
      const { sponsorshipLeadService } = await import('@/lib/services/sponsorshipLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.USER);
      const items = await sponsorshipLeadService.listMine(actor!);
      return applyCors(ok({ items }), request);
    }
    if (route === '/admin/sponsorship-leads' && method === 'GET') {
      const { sponsorshipLeadService } = await import('@/lib/services/sponsorshipLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.MODERATOR);
      const { searchParams } = new URL(request.url);
      const items = await sponsorshipLeadService.listAdmin(actor!, {
        status: (searchParams.get('status') || undefined) as never,
        budget_range: searchParams.get('budget_range') || undefined,
        channel_id: searchParams.get('channel_id') || undefined,
      });
      const counts = await sponsorshipLeadService.adminStatusCounts(actor!);
      return applyCors(ok({ items, counts }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'sponsorship-leads' && method === 'GET') {
      const { sponsorshipLeadService } = await import('@/lib/services/sponsorshipLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.MODERATOR);
      const lead = await sponsorshipLeadService.getAdmin(actor!, path[2]);
      return applyCors(ok({ lead }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'sponsorship-leads' && method === 'PATCH') {
      const { sponsorshipLeadService } = await import('@/lib/services/sponsorshipLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.MODERATOR);
      const body = await safeJson(request);
      const lead = await sponsorshipLeadService.patch(actor!, path[2], body);
      return applyCors(ok({ lead }), request);
    }

    // ---------- COMMERCIAL LEADS (pricing conversion) ----------
    if (route === '/commercial-leads/pro-waitlist' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'pro-waitlist'), 10, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many requests', { retryAfter: rl.retryAfterSeconds }), request);
      const { commercialLeadService } = await import('@/lib/services/commercialLeadService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const res = await commercialLeadService.submitProWaitlist(actor, body);
      return applyCors(ok(res, { status: 201 }), request);
    }
    if (route === '/commercial-leads/enterprise' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'enterprise-lead'), 10, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many requests', { retryAfter: rl.retryAfterSeconds }), request);
      const { commercialLeadService } = await import('@/lib/services/commercialLeadService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const res = await commercialLeadService.submitEnterpriseLead(actor, body);
      return applyCors(ok(res, { status: 201 }), request);
    }
    if (route === '/admin/commercial-leads' && method === 'GET') {
      const { commercialLeadService } = await import('@/lib/services/commercialLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const { searchParams } = new URL(request.url);
      const type = (searchParams.get('type') || undefined) as 'pro_waitlist' | 'enterprise_sales' | undefined;
      const status = (searchParams.get('status') || undefined) as import('@/lib/types').CommercialLeadStatus | undefined;
      const items = await commercialLeadService.listAdmin(actor!, { type, status });
      const counts = await commercialLeadService.adminCounts(actor!);
      return applyCors(ok({ items, counts }), request);
    }
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'commercial-leads' && method === 'PATCH') {
      const { commercialLeadService } = await import('@/lib/services/commercialLeadService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const lead = await commercialLeadService.patchAdmin(actor!, path[2], body);
      return applyCors(ok({ lead }), request);
    }

    // ---------- MARKETPLACE (Phase B1) ----------
    // Owner rate-card CRUD (verified owner only)
    if (path.length === 3 && path[0] === 'owner' && path[1] === 'channels' && path[2] === 'rate-card' && method === 'GET') {
      // /owner/channels/:id/rate-card — this shape supported below
    }
    if (path.length === 4 && path[0] === 'owner' && path[1] === 'channels' && path[3] === 'rate-card') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const channelId = path[2];
      if (method === 'GET') {
        const card = await marketplaceService.getMyRateCard(actor, channelId);
        return applyCors(ok({ rate_card: card }), request);
      }
      if (method === 'PUT') {
        const body = await safeJson(request);
        const card = await marketplaceService.replaceRateCard(actor, channelId, body);
        return applyCors(ok({ rate_card: card }), request);
      }
    }
    // Public: rate card for a channel (sanitized)
    if (path.length === 3 && path[0] === 'channels' && path[2] === 'rate-card' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const data = await marketplaceService.getPublicRateCard(path[1]);
      if (!data) return applyCors(fail(404, 'not_found'), request);
      return applyCors(ok(data), request);
    }
    // Brand booking
    if (route === '/marketplace/orders' && method === 'POST') {
      const rl = rateLimit(clientKey(request, 'mp-book'), 10, 60_000);
      if (!rl.allowed) return applyCors(fail(429, 'Too many requests', { retryAfter: rl.retryAfterSeconds }), request);
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const order = await marketplaceService.submitBooking(actor, body);
      return applyCors(ok({ order }, { status: 201 }), request);
    }
    // Owner: list own orders + accept + reject
    if (route === '/marketplace/owner/orders' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const { searchParams } = new URL(request.url);
      const status = (searchParams.get('status') || undefined) as import('@/lib/types').MarketplaceOrderStatus | undefined;
      const items = await marketplaceService.listMyOwnerOrders(actor, status);
      return applyCors(ok({ items }), request);
    }
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'accept' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const order = await marketplaceService.ownerAcceptOrder(actor, path[2]);
      return applyCors(ok({ order }), request);
    }
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'reject' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const order = await marketplaceService.ownerRejectOrder(actor, path[2], body);
      return applyCors(ok({ order }), request);
    }
    // Buyer: list own orders
    if (route === '/marketplace/buyer/orders' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const items = await marketplaceService.listMyBuyerOrders(actor);
      return applyCors(ok({ items }), request);
    }
    // Admin: list orders, kpis, confirm payment, reconcile fee
    if (route === '/admin/marketplace/orders' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const { searchParams } = new URL(request.url);
      const status = (searchParams.get('status') || undefined) as import('@/lib/types').MarketplaceOrderStatus | undefined;
      const items = await marketplaceService.listOrdersAdmin(actor, { status });
      const kpis = await marketplaceService.adminKpis(actor);
      return applyCors(ok({ items, kpis }), request);
    }
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'orders' && path[4] === 'confirm-payment' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const order = await marketplaceService.adminConfirmPayment(actor, path[3], body);
      return applyCors(ok({ order }), request);
    }
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'orders' && path[4] === 'reconcile-fee' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const order = await marketplaceService.adminReconcileFee(actor, path[3], body);
      return applyCors(ok({ order }), request);
    }

    // ── Phase B2 — Delivery lifecycle + payout ──────────────────────────────
    // Owner: start work (paid → in_progress)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'start-work' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const order = await marketplaceService.startWork(actor, path[2]);
      return applyCors(ok({ order }), request);
    }
    // Owner: submit delivery (in_progress → submitted_for_review)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'submit-delivery' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const order = await marketplaceService.submitDelivery(actor, path[2], body);
      return applyCors(ok({ order }), request);
    }
    // Buyer: accept delivery (submitted_for_review → completed)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'accept-delivery' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const order = await marketplaceService.buyerAcceptDelivery(actor, path[2]);
      return applyCors(ok({ order }), request);
    }
    // ── Phase B3.2 Gate B — Delivery + Payment Protection ──────────────────
    // Buyer: request revision (submitted_for_review → revision_requested)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'request-revision' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const order = await marketplaceService.buyerRequestRevision(actor, path[2], body);
      return applyCors(ok({ order }), request);
    }
    // Owner: report no response (creates delivery escalation)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'report-no-response' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const escalation = await marketplaceService.ownerReportNoResponse(actor, path[2], body);
      return applyCors(ok({ escalation }), request);
    }
    // Buyer/Owner/Admin: read full delivery history + current escalation
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'deliveries' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const data = await marketplaceService.getDeliveryHistory(actor, path[2]);
      return applyCors(ok(data), request);
    }
    // Admin: list escalations
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'escalations' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const url = new URL(request.url);
      const isActiveParam = url.searchParams.get('is_active');
      const filter: { is_active?: boolean } = {};
      if (isActiveParam === 'true') filter.is_active = true;
      else if (isActiveParam === 'false') filter.is_active = false;
      const escalations = await marketplaceService.adminListEscalations(actor, filter);
      return applyCors(ok({ escalations }), request);
    }
    // Admin: approve delivery via escalation (submitted_for_review → completed)
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'escalations' && path[4] === 'approve' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const { order, escalation } = await marketplaceService.adminApproveDeliveryEscalation(actor, path[3], body);
      return applyCors(ok({ order, escalation }), request);
    }
    // Admin: request more evidence
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'escalations' && path[4] === 'request-evidence' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const escalation = await marketplaceService.adminRequestMoreEvidence(actor, path[3], body);
      return applyCors(ok({ escalation }), request);
    }
    // Admin: reject escalation (evidence insufficient)
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'escalations' && path[4] === 'reject' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const escalation = await marketplaceService.adminRejectEscalation(actor, path[3], body);
      return applyCors(ok({ escalation }), request);
    }
    // ── Phase B3.2 Gate C — Owner Earnings + Payout Account ────────────────
    // Owner earnings rollup
    if (path.length === 2 && path[0] === 'owner' && path[1] === 'earnings' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const data = await marketplaceService.ownerListEarnings(actor);
      return applyCors(ok(data), request);
    }
    // Owner payout method — read
    if (path.length === 2 && path[0] === 'owner' && path[1] === 'payout-method' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const methodData = await marketplaceService.ownerGetPayoutMethod(actor);
      return applyCors(ok({ method: methodData }), request);
    }
    // Owner payout method — upsert (creates new unverified row + returns dev verification code)
    if (path.length === 2 && path[0] === 'owner' && path[1] === 'payout-method' && method === 'PUT') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const result = await marketplaceService.ownerUpsertPayoutMethod(actor, body);
      return applyCors(ok(result), request);
    }
    // Owner payout method — verify
    if (path.length === 3 && path[0] === 'owner' && path[1] === 'payout-method' && path[2] === 'verify' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const body = await safeJson(request);
      const methodData = await marketplaceService.ownerVerifyPayoutMethod(actor, body);
      return applyCors(ok({ method: methodData }), request);
    }
    // Owner: request payout on a completed order (no money sent)
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'request-payout' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const order = await marketplaceService.ownerRequestPayout(actor, path[2]);
      return applyCors(ok({ order }), request);
    }
    // Admin: list payout methods (masked)
    if (path.length === 3 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'payout-methods' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const methods = await marketplaceService.adminListPayoutMethods(actor);
      return applyCors(ok({ methods }), request);
    }
    // Buyer: read a single order they own
    if (path.length === 3 && path[0] === 'marketplace' && path[1] === 'buyer' && method === 'GET' && path[2] !== 'orders') {
      // /marketplace/buyer/:orderId — only if this is not the list endpoint above
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const order = await marketplaceService.findOrderForBuyer(actor, path[2]);
      return applyCors(order ? ok({ order }) : fail(404, 'Not found'), request);
    }
    // Admin: complete-override
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'orders' && path[4] === 'complete-override' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const order = await marketplaceService.adminCompleteOrder(actor, path[3], body);
      return applyCors(ok({ order }), request);
    }
    // Admin: record manual payout
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'orders' && path[4] === 'record-payout' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const { order, payout } = await marketplaceService.adminRecordPayout(actor, path[3], body);
      return applyCors(ok({ order, payout }), request);
    }
    // Admin: refund guard (no execution; marks manual_reconciliation_required if paid_out)
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'orders' && path[4] === 'refund-guard' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const body = await safeJson(request);
      const result = await marketplaceService.adminInitiateRefund(actor, path[3], body);
      return applyCors(ok(result), request);
    }
    // Admin: payables + payouts lists
    if (route === '/admin/marketplace/payables' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const url = new URL(request.url);
      const statusParam = url.searchParams.get('status') || undefined;
      const items = await marketplaceService.listPayablesAdmin(actor, statusParam ? { status: statusParam as never } : {});
      return applyCors(ok({ items }), request);
    }
    if (route === '/admin/marketplace/payouts' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const items = await marketplaceService.listPayoutsAdmin(actor);
      return applyCors(ok({ items }), request);
    }

    // ── Phase B3 — Marketplace PayPal Checkout ───────────────────────────────
    // Buyer starts PayPal checkout for their sponsorship order.
    if (path.length === 5 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'paypal' && path[4] === 'create' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      const actor = await resolveActor(request);
      const origin = resolveTrustedOrigin(request.headers);
      const { attempt, approve_url } = await marketplaceService.buyerStartPaypalCheckout(actor, path[2], origin);
      return applyCors(ok({
        attempt: {
          id: attempt.id,
          marketplace_order_id: attempt.marketplace_order_id,
          status: attempt.status,
          currency: attempt.currency,
          amount_minor: attempt.amount_minor,
          approve_url,
          provider_environment: attempt.provider_environment,
        },
        approve_url,
      }), request);
    }
    // Buyer captures on return from PayPal (browser return is NOT payment proof — this triggers a server-side capture).
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'payments' && path[3] === 'capture' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const attempt = await marketplaceService.captureMarketplacePaypalOrder(actor, path[2]);
      return applyCors(ok({
        attempt: {
          id: attempt.id, status: attempt.status,
          marketplace_order_id: attempt.marketplace_order_id,
          currency: attempt.currency, amount_minor: attempt.amount_minor,
          failure_message_safe: attempt.failure_message_safe,
        },
      }), request);
    }
    // Buyer/admin polls attempt status.
    if (path.length === 3 && path[0] === 'marketplace' && path[1] === 'payments' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const attempt = await marketplaceService.getPaymentAttemptForBuyer(actor, path[2]);
      return applyCors(ok({
        attempt: {
          id: attempt.id, status: attempt.status,
          marketplace_order_id: attempt.marketplace_order_id,
          currency: attempt.currency, amount_minor: attempt.amount_minor,
          failure_message_safe: attempt.failure_message_safe,
          captured_at: attempt.captured_at,
        },
      }), request);
    }
    // Buyer/owner/admin: list attempts for an order (for UI).
    if (path.length === 4 && path[0] === 'marketplace' && path[1] === 'orders' && path[3] === 'payments' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const items = await marketplaceService.listPaymentAttemptsForOrder(actor, path[2]);
      return applyCors(ok({ items: items.map((a) => ({
        id: a.id, marketplace_order_id: a.marketplace_order_id,
        status: a.status, currency: a.currency, amount_minor: a.amount_minor,
        provider: a.provider, provider_environment: a.provider_environment,
        provider_order_id: a.provider_order_id ? maskId(a.provider_order_id) : null,
        provider_capture_id: a.provider_capture_id ? maskId(a.provider_capture_id) : null,
        created_at: a.created_at, captured_at: a.captured_at,
        provider_fee_minor: a.provider_fee_minor, provider_net_minor: a.provider_net_minor,
        failure_message_safe: a.failure_message_safe,
      })) }), request);
    }
    // Admin: list all attempts across all orders.
    if (route === '/admin/marketplace/payments' && method === 'GET') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.ADMIN);
      const items = await marketplaceService.listPaymentAttemptsAdmin(actor);
      return applyCors(ok({ items: items.map((a) => ({
        id: a.id, marketplace_order_id: a.marketplace_order_id,
        status: a.status, currency: a.currency, amount_minor: a.amount_minor,
        provider: a.provider, provider_environment: a.provider_environment,
        provider_order_id: a.provider_order_id ? maskId(a.provider_order_id) : null,
        provider_capture_id: a.provider_capture_id ? maskId(a.provider_capture_id) : null,
        created_at: a.created_at, captured_at: a.captured_at,
        provider_fee_minor: a.provider_fee_minor, provider_net_minor: a.provider_net_minor,
        failure_message_safe: a.failure_message_safe,
      })) }), request);
    }
    // B3.2 — Admin-triggered PayPal capture-details fee lookup + backfill.
    // Only usable on captured PayPal attempts whose fee is still null.
    if (path.length === 5 && path[0] === 'admin' && path[1] === 'marketplace' && path[2] === 'payments' && path[4] === 'reconcile-fee-from-provider' && method === 'POST') {
      const { marketplaceService } = await import('@/lib/services/marketplaceService');
      const actor = await resolveActor(request);
      const r = await marketplaceService.adminReconcileFeeFromProvider(actor, path[3]);
      return applyCors(ok(r), request);
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

// Extract PayPal Order id from a PAYMENT.CAPTURE.* webhook resource.
// PayPal puts it in `supplementary_data.related_ids.order_id` on captures
// and `supplementary_data.related_ids.capture_id + ... .order_id` on refunds.
// Falls back to walking the `links` array (self/up/order) as a last resort.
function extractPayPalOrderId(resource: Record<string, unknown>): string | null {
  const sup = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
  if (sup?.related_ids?.order_id) return sup.related_ids.order_id;
  const links = (resource.links || []) as Array<{ rel?: string; href?: string }>;
  const up = links.find((l) => l.rel === 'up' && typeof l.href === 'string');
  if (up?.href) {
    const m = up.href.match(/\/orders\/([^/]+)/);
    if (m) return m[1];
  }
  return null;
}

/** Mask a provider identifier for display (never leak full PayPal ids in UI). */
function maskId(s: string): string {
  if (s.length <= 8) return `••••${s.slice(-2)}`;
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

