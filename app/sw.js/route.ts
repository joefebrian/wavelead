// WaveLead service worker, served from /sw.js.
//
// Served from a route (not /public) so the worker's bytes change with every
// deployment (the Next build id is embedded) — that is what makes browsers
// detect updates reliably.
//
// KILL SWITCH (rollback): set PWA_SW_DISABLED=true and redeploy. /sw.js then
// serves a self-unregistering worker that deletes WaveLead caches.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

function buildVersion(): string {
  try {
    return readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

const KILL_SWITCH_SW = `// WaveLead service worker — disabled
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('wavelead-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
  })());
});
`;

function workerSource(version: string, dev: boolean): string {
  return `// WaveLead service worker — build ${version}
'use strict';
const VERSION = ${JSON.stringify(version)};
const DEV = ${dev ? 'true' : 'false'};
const SHELL_CACHE = 'wavelead-shell-' + VERSION;   // versioned; old ones deleted on activate
const STATIC_CACHE = 'wavelead-static-v1';          // content-hashed, immutable build assets
const ASSET_CACHE = 'wavelead-assets-v1';           // icons / brand images / fonts
const OFFLINE_URL = '/offline';
const SHELL_URLS = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/brand/wavelead-logo.png'];
const STATIC_MAX = 250;

// NEVER intercepted (network only, never cached): APIs, auth, admin, dashboards,
// payments/checkout, sponsorship booking, claims, uploads, Next data/RSC.
const NETWORK_ONLY = /^\\/(api|auth|admin|dashboard|login|signup|sponsor|claim|submit|pricing|go|checkout|pay|sw\\.js)(\\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_URLS.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload', credentials: 'omit' });
        if (res.ok) await shell.put(u, res);
      } catch (e) { /* best effort — never block install on one asset */ }
    }));
  })());
  // Not calling skipWaiting(): an updated worker waits until the page asks
  // (user taps "Update") or every WaveLead tab is closed.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('wavelead-shell-') && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

function cacheable(res) {
  if (!res || !res.ok || res.type === 'opaqueredirect') return false;
  const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  return !cc.includes('no-store') && !cc.includes('private');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res) || res.type === 'opaque') {
    cache.put(request, res.clone()).then(() => trim(cacheName, STATIC_MAX)).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (cacheable(res) || res.type === 'opaque') cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => hit);
  return hit || network;
}

async function navigate(request) {
  try {
    // Pages are NEVER cached: they can contain signed-in, per-user content.
    return await fetch(request);
  } catch (e) {
    const shell = await caches.open(SHELL_CACHE);
    const offline = await shell.match(OFFLINE_URL);
    return offline || new Response('<h1>You are offline</h1><p>Reconnect and try again.</p>', {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // mutations are never touched or replayed
  const url = new URL(request.url);

  // Google Fonts (public, versioned)
  if (url.hostname === 'fonts.gstatic.com') { event.respondWith(cacheFirst(request, ASSET_CACHE)); return; }
  if (url.hostname === 'fonts.googleapis.com') { event.respondWith(staleWhileRevalidate(request, ASSET_CACHE)); return; }
  if (url.origin !== self.location.origin) return;     // all other third parties: browser default

  if (request.mode === 'navigate') {
    if (NETWORK_ONLY.test(url.pathname)) return;      // browser default (no fallback interference)
    event.respondWith(navigate(request));
    return;
  }
  if (NETWORK_ONLY.test(url.pathname)) return;
  if (request.headers.get('RSC') || url.searchParams.has('_rsc')) return; // Next RSC payloads: network only

  if (url.pathname.startsWith('/_next/static/')) {
    if (DEV) return;                                  // dev chunks are not content-hashed
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
  // Everything else (images via /_next/image, uploads, etc.): browser default.
});
`;
}

export async function GET() {
  const disabled = String(process.env.PWA_SW_DISABLED || '').toLowerCase() === 'true';
  const body = disabled ? KILL_SWITCH_SW : workerSource(buildVersion(), process.env.NODE_ENV !== 'production');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
