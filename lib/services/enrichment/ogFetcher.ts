// SSRF-safe fetcher for the WhatsApp public channel page. Only reaches an
// allowlisted host, HTTPS only, no cookies/auth, redirects must stay on the
// same allowlist, hard timeout, response size cap. If anything goes wrong
// we return null — the caller degrades to manual form.

import type { NormalizedChannelUrl } from './urlNormalizer';

const ALLOWED_HOSTS = new Set(['whatsapp.com', 'www.whatsapp.com']);
const OG_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024; // 512 KB — WhatsApp channel invite pages are small.

export interface PublicChannelMetadata {
  title: string | null;
  description: string | null;
  image_url: string | null;
  canonical_url: string | null;
}

function extractMeta(html: string, prop: string): string | null {
  // Match <meta property="prop" content="..."> or name="prop" — case-insensitive.
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decode(m[1]);
  }
  return null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .trim();
}

function sameHostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function fetchWithLimits(url: string, timeoutMs: number, maxBytes: number, maxRedirects = 3): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!sameHostAllowed(current)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'WaveLeadBot/1.0 (+https://wavelead)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
      });
    } catch {
      clearTimeout(timer); return null;
    } finally { clearTimeout(timer); }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;

    // Stream + cap.
    const reader = res.body?.getReader();
    if (!reader) return null;
    let received = 0;
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const buf = new Uint8Array(received);
    let off = 0; for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder('utf-8').decode(buf);
  }
  return null;
}

export async function fetchPublicChannelMetadata(n: NormalizedChannelUrl): Promise<PublicChannelMetadata | null> {
  const html = await fetchWithLimits(n.canonical_url, OG_TIMEOUT_MS, MAX_HTML_BYTES);
  if (!html) return null;
  const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  const description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description') || extractMeta(html, 'description');
  const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
  const canonical = extractMeta(html, 'og:url');
  if (!title && !description && !image) return null;
  return {
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 1000) : null,
    image_url: image && /^https:\/\//i.test(image) ? image.slice(0, 500) : null,
    canonical_url: canonical || n.canonical_url,
  };
}
