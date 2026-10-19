/**
 * WaveLead — safe channel avatar resolver.
 *
 * WhatsApp public CDN URLs (pps.whatsapp.net, mmg.whatsapp.net,
 * media-*.fna.whatsapp.net, static.whatsapp.net) are typically pre-signed and
 * expire, which caused the SEO crawler to report 20 broken external images on
 * channel pages. Crawlers still record the <img src> even when a client-side
 * onError handler swaps it, so the only reliable fix is to NEVER emit a URL
 * we know is prone to expiry.
 *
 * Policy:
 *   - WhatsApp CDN hostnames are VOLATILE; their URLs are never rendered
 *     directly. They are swapped for WaveLead's own stable cache URL
 *     (/api/channels/<slug>/avatar) so the real avatar still appears while
 *     crawlers only ever see a first-party, non-expiring link.
 *   - Everything else (WaveLead-hosted, user-supplied stable HTTPS URLs) is
 *     rendered normally.
 *   - `resolveChannelAvatar` returns null only when there is nothing usable
 *     at all; the caller then renders the local fallback (initials or the SVG
 *     at /brand/channel-fallback.svg).
 *
 * NOTE: this is a render-time policy. A separate operator-invoked script
 * (scripts/repair_broken_avatars.mjs) performs the corresponding DB cleanup.
 */

const VOLATILE_HOST_SUFFIXES = [
  '.whatsapp.net',
  '.whatsapp.com',
  '.fbcdn.net',
];

export const CHANNEL_FALLBACK_AVATAR = '/brand/channel-fallback.svg';

export function isVolatileAvatarHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'whatsapp.net' || h === 'whatsapp.com') return true;
  return VOLATILE_HOST_SUFFIXES.some((suf) => h.endsWith(suf));
}

/**
 * Stable first-party URL for a channel's avatar. Backed by
 * app/api/channels/[slug]/avatar/route.ts, which serves WaveLead's own cached
 * copy of the image and redirects to the local placeholder when no real
 * avatar can be obtained.
 */
export function channelAvatarCacheUrl(slug: string): string {
  return `/api/channels/${encodeURIComponent(slug)}/avatar`;
}

/**
 * Return a URL that is safe to render as an <img src="…">, or null when the
 * caller should render the local fallback / initials instead.
 *
 * FINALIST HOTFIX — behaviour change.
 * Previously this returned null for every `*.whatsapp.net` host. That removed
 * the broken images the SEO crawler had flagged, but it also discarded every
 * avatar that was working, so real submitted channels rendered a generic
 * letter placeholder across /top, /trending, the directory and channel
 * details even though a valid avatar was stored in `logo_url`.
 *
 * The volatile URL is now swapped for our stable first-party cache URL rather
 * than being dropped. Crawlers still never see an expiring CDN link, and real
 * avatars are actually displayed.
 *
 * `slug` is optional purely for backward compatibility: without it we cannot
 * build a cache URL and must keep the old suppress-to-fallback behaviour.
 */
export function resolveChannelAvatar(
  logoUrl: string | null | undefined,
  slug?: string | null,
): string | null {
  if (!logoUrl) return null;
  const s = String(logoUrl).trim();
  if (!s) return null;
  // Reject non-http(s) inputs outright (data:, javascript:, etc.).
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (isVolatileAvatarHost(u.hostname)) {
      return slug ? channelAvatarCacheUrl(slug) : null;
    }
    return s;
  } catch {
    return null;
  }
}
