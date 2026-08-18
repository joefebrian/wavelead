// Normalize WhatsApp Channel URLs into a canonical identifier for duplicate
// detection, cache keying, and safe outbound fetching. All strings that vary
// in trivial ways (www vs apex, http vs https, trailing slashes, query/fragment)
// map to the same canonical `whatsapp_channel_id`.

export interface NormalizedChannelUrl {
  channel_id: string;                // opaque id from the URL path segment
  canonical_url: string;             // e.g. https://whatsapp.com/channel/<id>
  host: string;                      // whatsapp.com | wa.me
}

const ALLOWED_HOSTS = new Set(['whatsapp.com', 'www.whatsapp.com', 'wa.me']);
const CANONICAL_HOST = 'whatsapp.com';
// WhatsApp channel IDs look like `0029Va...xyz` — alphanumeric, ≥16, ≤40 chars.
const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{16,40}$/;

export function normalizeChannelUrl(input: string | null | undefined): NormalizedChannelUrl | null {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  // Accept /channel/<id> or /channel/<id>/<invite-key>
  if (parts.length < 2 || parts[0].toLowerCase() !== 'channel') return null;
  const id = parts[1];
  if (!CHANNEL_ID_RE.test(id)) return null;
  return {
    channel_id: id,
    canonical_url: `https://${CANONICAL_HOST}/channel/${id}`,
    host: CANONICAL_HOST,
  };
}
