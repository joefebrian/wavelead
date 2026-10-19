// WaveLead — persistent channel-avatar cache.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The Submit Channel → Fetch Metadata flow reads the public WhatsApp Channel
// page and stores the `og:image` in `channels.logo_url`. Those URLs live on
// `mmg.whatsapp.net` / `pps.whatsapp.net` and are PRE-SIGNED — they carry
// `oh` / `oe` / `_nc_oc` parameters and stop resolving after a while
// (observed live: some real channels still 200, others already 404).
//
// The previous mitigation suppressed every `*.whatsapp.net` URL at render
// time so crawlers would never see a broken <img src>. That removed the broken
// images, but it ALSO removed the working ones — which is why every real
// channel rendered a generic letter fallback on /top, /trending and the
// directory even though a perfectly good avatar was sitting in the database.
//
// The fix is to stop hotlinking the volatile CDN and instead keep our own copy
// of the bytes, served from a stable first-party URL
// (`/api/channels/<slug>/avatar`). Crawlers and browsers then get a URL that
// does not expire, and the real avatar is displayed.
//
// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------
// This is NOT a general image proxy. It cannot be pointed at an arbitrary URL:
//   • the only input is a channel's OWN stored `logo_url` (or the `og:image`
//     re-read from that channel's own WhatsApp page via the existing
//     SSRF-safe ogFetcher);
//   • the host must match the WhatsApp/Meta CDN allowlist — no private ranges,
//     no IP literals, no user-controlled hosts;
//   • HTTPS only, redirects followed manually and re-validated against the
//     same allowlist;
//   • hard timeout and a 512 KB response cap;
//   • only `image/*` content types are stored.
//
// Storage is additive: a dedicated `channel_avatar_cache` collection. No
// channel record, moderation state, ownership record, follower observation or
// financial row is read for writing or modified by this module. Avatars are a
// few tens of KB, far inside the BSON document limit.
import { createHash } from 'node:crypto';
import { Binary } from 'mongodb';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { normalizeChannelUrl } from '@/lib/services/enrichment/urlNormalizer';
import { fetchPublicChannelMetadata } from '@/lib/services/enrichment/ogFetcher';

/** WhatsApp / Meta CDN hosts we are willing to pull avatar bytes from. */
const ALLOWED_AVATAR_HOST_SUFFIXES = ['.whatsapp.net', '.whatsapp.com', '.fbcdn.net'];
const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/** Re-check the upstream image at most this often, even on a cache hit. */
export const AVATAR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedAvatar {
  channel_id: string;
  content_type: string;
  byte_size: number;
  etag: string;
  source_host: string;
  /** sha256 of the logo_url the bytes came from — lets us detect a refresh. */
  source_key: string;
  fetched_at: Date;
  data: Binary;
}

async function coll() {
  return getCollection<CachedAvatar>(COLLECTIONS.CHANNEL_AVATAR_CACHE);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Host allowlist check — the SSRF gate for this module. */
export function isAllowedAvatarSource(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    // Reject bare IP literals outright.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return false;
    return ALLOWED_AVATAR_HOST_SUFFIXES.some((suf) => h.endsWith(suf));
  } catch {
    return false;
  }
}

/** Fetch image bytes with allowlist, timeout, redirect and size guards. */
async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Buffer; contentType: string; host: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedAvatarSource(current)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: 'image/*', 'User-Agent': 'WaveLeadBot/1.0 (+https://wavelead)' },
      });
    } catch {
      clearTimeout(timer);
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return null;

    const declared = Number(res.headers.get('content-length') || '0');
    if (declared > MAX_AVATAR_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_AVATAR_BYTES) return null;

    return {
      bytes: buf,
      contentType: contentType || 'image/jpeg',
      host: new URL(current).hostname,
    };
  }
  return null;
}

/**
 * Ask the channel's own WhatsApp page for a FRESH og:image. Used when the
 * stored logo_url has expired. Reuses the existing SSRF-safe ogFetcher, which
 * only ever talks to whatsapp.com.
 */
async function refetchAvatarUrlFromWhatsApp(whatsappUrl: string | null | undefined): Promise<string | null> {
  if (!whatsappUrl) return null;
  const normalized = normalizeChannelUrl(whatsappUrl);
  if (!normalized) return null;
  try {
    const meta = await fetchPublicChannelMetadata(normalized);
    const img = meta?.image_url || null;
    return img && isAllowedAvatarSource(img) ? img : null;
  } catch {
    return null;
  }
}

export async function getCachedAvatar(channelId: string): Promise<CachedAvatar | null> {
  const c = await coll();
  return (await c.findOne({ channel_id: channelId }, { projection: { _id: 0 } })) as CachedAvatar | null;
}

async function store(
  channelId: string,
  sourceKey: string,
  img: { bytes: Buffer; contentType: string; host: string },
): Promise<CachedAvatar> {
  const doc: CachedAvatar = {
    channel_id: channelId,
    content_type: img.contentType,
    byte_size: img.bytes.byteLength,
    etag: `"${sha256(img.bytes.toString('base64')).slice(0, 32)}"`,
    source_host: img.host,
    source_key: sourceKey,
    fetched_at: new Date(),
    data: new Binary(img.bytes),
  };
  const c = await coll();
  await c.updateOne({ channel_id: channelId }, { $set: doc }, { upsert: true });
  return doc;
}

export interface AvatarChannelInput {
  id: string;
  logo_url?: string | null;
  whatsapp_url?: string | null;
}

/**
 * Return a usable cached avatar for this channel, fetching and persisting it
 * on first use. Returns null when no real avatar can be obtained — the caller
 * must then fall back to the local placeholder / initials. NEVER invents an
 * image.
 */
export async function resolveCachedAvatar(channel: AvatarChannelInput): Promise<CachedAvatar | null> {
  const sourceUrl = (channel.logo_url || '').trim();
  const sourceKey = sourceUrl ? sha256(sourceUrl) : '';
  const existing = await getCachedAvatar(channel.id);

  // Fresh enough, and still pinned to the same upstream URL → serve as-is.
  if (existing && existing.source_key === sourceKey && Date.now() - new Date(existing.fetched_at).getTime() < AVATAR_CACHE_TTL_MS) {
    return existing;
  }

  // 1. Try the stored URL.
  if (sourceUrl && isAllowedAvatarSource(sourceUrl)) {
    const img = await fetchImageBytes(sourceUrl);
    if (img) return store(channel.id, sourceKey, img);
  }

  // 2. Stored URL expired/unusable → re-read the channel's own public page.
  const fresh = await refetchAvatarUrlFromWhatsApp(channel.whatsapp_url);
  if (fresh) {
    const img = await fetchImageBytes(fresh);
    // Key the entry to the ORIGINAL stored URL so a later logo_url change still
    // invalidates it, rather than pinning to this transient signed URL.
    if (img) return store(channel.id, sourceKey, img);
  }

  // 3. Nothing usable now — keep serving a previously cached copy if we have
  //    one (a stale real avatar beats a generic placeholder).
  return existing ?? null;
}
