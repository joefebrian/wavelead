// Central API dispatcher. This is the ONLY place that maps HTTP → services.
// Services never import next/server; keep this router thin.

import { NextResponse } from 'next/server';
import { authService } from '@/lib/services/authService';
import { channelService } from '@/lib/services/channelService';
import { categoryService } from '@/lib/services/categoryService';
import { runSeed } from '@/lib/seed/seedData';
import {
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
} from '@/lib/auth/session';
import { requireRole, ROLES } from '@/lib/auth/rbac';
import { ok, fail, handleServiceError } from '@/lib/utils/response';

function withCors(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handler(request, ctx) {
  const { path = [] } = (await ctx.params) || {};
  const route = '/' + path.join('/');
  const method = request.method;

  try {
    // ---------- health ----------
    if (route === '/health' && method === 'GET') {
      return withCors(ok({ status: 'ok', service: 'wavehub', time: new Date().toISOString() }));
    }

    // ---------- auth ----------
    if (route === '/auth/signup' && method === 'POST') {
      const body = await safeJson(request);
      const { user, token } = await authService.signup(body);
      const res = withCors(ok({ user }));
      return setSessionCookie(res, token);
    }
    if (route === '/auth/login' && method === 'POST') {
      const body = await safeJson(request);
      const { user, token } = await authService.login(body);
      const res = withCors(ok({ user }));
      return setSessionCookie(res, token);
    }
    if (route === '/auth/logout' && method === 'POST') {
      const res = withCors(ok({ loggedOut: true }));
      return clearSessionCookie(res);
    }
    if (route === '/auth/me' && method === 'GET') {
      const session = getSessionFromRequest(request);
      const user = await authService.me(session);
      return withCors(ok({ user }));
    }

    // ---------- public discovery ----------
    if (route === '/categories' && method === 'GET') {
      const categories = await categoryService.listActive();
      return withCors(ok({ categories }));
    }
    if (route === '/channels' && method === 'GET') {
      const url = new URL(request.url);
      const params = Object.fromEntries(url.searchParams.entries());
      const limit = Math.min(parseInt(params.limit || '24', 10) || 24, 60);
      const skip = Math.max(parseInt(params.skip || '0', 10) || 0, 0);
      const result = await channelService.listPublic({
        category: params.category,
        country: params.country,
        q: params.q,
        sort: params.sort,
        limit,
        skip,
      });
      return withCors(ok(result));
    }
    if (route === '/channels/featured' && method === 'GET') {
      const items = await channelService.getFeatured(6);
      return withCors(ok({ items }));
    }
    if (route === '/stats' && method === 'GET') {
      const stats = await channelService.getStats();
      return withCors(ok(stats));
    }
    // /channels/:slug — exact match with 2 segments
    if (path.length === 2 && path[0] === 'channels' && method === 'GET') {
      const c = await channelService.getPublicBySlug(path[1]);
      if (!c) return withCors(fail(404, 'Channel not found'));
      return withCors(ok({ channel: c }));
    }

    // ---------- admin ----------
    if (route === '/admin/seed' && method === 'POST') {
      // In dev, allow seeding without auth to bootstrap. In prod, require admin.
      if (process.env.NODE_ENV === 'production') {
        const session = getSessionFromRequest(request);
        requireRole(session, ROLES.ADMIN);
      }
      const body = await safeJson(request);
      const result = await runSeed({ force: !!body?.force });
      return withCors(ok({ seed: result }));
    }

    return withCors(fail(404, `Route ${route} not found`));
  } catch (err) {
    return withCors(handleServiceError(err));
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
