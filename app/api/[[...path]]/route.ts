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
      return applyCors(ok({ status: 'ok', service: 'wavelead', time: new Date().toISOString() }), request);
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

    // Sample privileged endpoint used by tests: verifies live-role authorization.
    if (route === '/admin/ping' && method === 'GET') {
      const actor = await resolveActor(request);
      requireRole(actor, ROLES.MODERATOR);
      return applyCors(ok({ pong: true, role: actor.user.role }), request);
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
