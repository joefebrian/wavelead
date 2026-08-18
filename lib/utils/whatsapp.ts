// WhatsApp public channel URL validation + normalization.
// Public channel URLs use the /channel/... path on whatsapp.com or wa.me.
const HOSTS = new Set(['whatsapp.com', 'www.whatsapp.com', 'wa.me']);

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
  normalized?: string;
  channelKey?: string; // stable dedupe key
}

export function validateAndNormalizeWhatsAppUrl(input: string): UrlCheckResult {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, reason: 'URL is required' };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'Malformed URL' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only https/http URLs are accepted' };
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) {
    return { ok: false, reason: 'URL must point to whatsapp.com or wa.me' };
  }
  // Accept: /channel/XYZ  OR wa.me/channel/XYZ (rare) OR path startsWith /channel/
  const path = url.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/channel\/([A-Za-z0-9_-]{5,})/);
  if (!match) return { ok: false, reason: 'URL must be a public WhatsApp channel link (contains /channel/...)' };
  const key = match[1].toLowerCase();
  const normalized = `https://whatsapp.com/channel/${match[1]}`;
  return { ok: true, normalized, channelKey: key };
}
