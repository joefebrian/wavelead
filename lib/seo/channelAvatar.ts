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
 *   - WhatsApp CDN hostnames are treated as VOLATILE and never rendered.
 *   - Everything else (WaveLead-hosted, user-supplied stable HTTPS URLs) is
 *     rendered normally.
 *   - `resolveChannelAvatar` returns null when the URL should be suppressed;
 *     the caller then renders the local fallback (initials or the SVG at
 *     /brand/channel-fallback.svg).
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
 * Return a URL that is safe to render as an <img src="…">, or null when the
 * caller should render the local fallback / initials instead.
 */
export function resolveChannelAvatar(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const s = String(logoUrl).trim();
  if (!s) return null;
  // Reject non-http(s) inputs outright (data:, javascript:, etc.).
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (isVolatileAvatarHost(u.hostname)) return null;
    return s;
  } catch {
    return null;
  }
}
