// M14 — WhatsApp public metadata refresh service.
//
// Reuses the existing SSRF-safe fetcher (ogFetcher) + parser
// (whatsappMetadataParser). Never creates a new scraper. Never touches
// verified follower evidence. Fail-safe: if fetching or parsing fails,
// the channel's stored logo/bio/follower count is preserved as-is and
// a clear error message is returned to the caller.

import { channelRepo } from '@/lib/repositories/channelRepo';
import { normalizeChannelUrl } from './enrichment/urlNormalizer';
import { fetchPublicChannelMetadata } from './enrichment/ogFetcher';
import { parseWhatsAppOgDescription, displayCleanWhatsAppDescription } from './enrichment/whatsappMetadataParser';
import { requireRole, ROLES, HttpError } from '@/lib/auth/rbac';
import type { Actor, Channel } from '@/lib/types';

export interface RefreshResult {
  channel_id: string;
  ok: boolean;
  updated_fields: Array<'logo_url' | 'description' | 'short_description' | 'public_followers_count'>;
  observed_at: string | null;
  reason?: string;
}

interface RefreshCandidate {
  id: string;
  whatsapp_url: string | null;
  logo_url: string | null;
  description: string | null;
  short_description: string | null;
  public_followers_count?: number | null;
}

const SHORT_DESC_MAX = 180;

// M18.1 Phase E — weekly refresh cadence for approved/live channels.
export const WEEKLY_STALE_DAYS = 7;

// Core: run one refresh against a stored channel doc. Pure at the fetch/parse
// layer; only writes when we have concrete new values. Never blanks existing
// data on failure.
export async function refreshChannelFromPublicMetadata(channel: RefreshCandidate): Promise<RefreshResult> {
  const now = new Date();
  const empty: RefreshResult = { channel_id: channel.id, ok: false, updated_fields: [], observed_at: null };
  if (!channel.whatsapp_url) return { ...empty, reason: 'no_whatsapp_url' };
  const normalized = normalizeChannelUrl(channel.whatsapp_url);
  if (!normalized) return { ...empty, reason: 'invalid_whatsapp_url' };

  let og;
  try {
    og = await fetchPublicChannelMetadata(normalized);
  } catch {
    og = null;
  }
  if (!og) return { ...empty, reason: 'fetch_failed' };

  const parsed = parseWhatsAppOgDescription(og.description);
  const nextLogo = og.image_url && /^https:\/\//i.test(og.image_url) ? og.image_url : null;
  const nextBio = parsed.bio ?? (og.description ? displayCleanWhatsAppDescription(og.description) : null);
  const nextCount = typeof parsed.followers === 'number' && parsed.followers >= 0 ? parsed.followers : null;

  const patch: Partial<Channel> = {};
  const updated_fields: RefreshResult['updated_fields'] = [];

  // Only overwrite existing values with a concrete non-empty replacement. If
  // parsing returned null (e.g. WhatsApp rendered a generic OG page), keep the
  // stored value intact.
  if (nextLogo && nextLogo !== channel.logo_url) {
    (patch as { logo_url: string | null }).logo_url = nextLogo;
    updated_fields.push('logo_url');
  }
  if (nextBio && nextBio !== channel.description) {
    (patch as { description: string | null }).description = nextBio;
    updated_fields.push('description');
    // If existing short_description was the leading-wrapper garbage or looks
    // like an older auto-fill, keep it in sync with the new clean bio slice.
    const nextShort = nextBio.slice(0, SHORT_DESC_MAX);
    if (nextShort !== channel.short_description) {
      (patch as { short_description: string | null }).short_description = nextShort;
      updated_fields.push('short_description');
    }
  }
  if (nextCount !== null && nextCount !== (channel.public_followers_count ?? null)) {
    (patch as { public_followers_count: number | null; public_followers_source: 'whatsapp_public_metadata' | null; public_followers_observed_at: Date | null }).public_followers_count = nextCount;
    (patch as { public_followers_source: 'whatsapp_public_metadata' | null }).public_followers_source = 'whatsapp_public_metadata';
    (patch as { public_followers_observed_at: Date | null }).public_followers_observed_at = now;
    updated_fields.push('public_followers_count');
  }

  if (updated_fields.length === 0) {
    return { ...empty, ok: true, observed_at: now.toISOString(), reason: 'no_change' };
  }
  (patch as { updated_at: Date }).updated_at = now;
  await channelRepo.update(channel.id, patch as unknown as Partial<Channel>);
  return {
    channel_id: channel.id,
    ok: true,
    updated_fields,
    observed_at: now.toISOString(),
  };
}

// Admin manual entry point. Loads the channel, applies role check, then
// delegates to refreshChannelFromPublicMetadata.
export const whatsappRefreshService = {
  async refreshOne(actor: Actor | null, channelId: string): Promise<RefreshResult> {
    requireRole(actor, ROLES.MODERATOR);
    const c = await channelRepo.findById(channelId);
    if (!c) throw new HttpError(404, 'Channel not found');
    return refreshChannelFromPublicMetadata({
      id: c.id,
      whatsapp_url: c.whatsapp_url,
      logo_url: c.logo_url,
      description: c.description,
      short_description: c.short_description,
      public_followers_count: c.public_followers_count ?? null,
    });
  },

  // Weekly batch. Bounded/conservative: caps the number of channels processed
  // per invocation and enforces an inter-request delay to avoid hammering
  // WhatsApp. Only refreshes approved public channels with a valid URL.
  //
  // M18.1 Phase E — WEEKLY semantics + failure isolation:
  //   • a channel observed within `staleAfterDays` (default 7) is skipped, so
  //     the job is idempotent and safe to retry/run more often than weekly;
  //   • one channel failing can never abort the batch.
  async refreshBatch(opts: { limit?: number; delayMs?: number; staleAfterDays?: number } = {}): Promise<{ processed: number; ok: number; skipped: number; failed: number; skipped_fresh: number; details: RefreshResult[] }> {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const delayMs = Math.max(0, Math.min(30_000, opts.delayMs ?? 1_000));
    const staleAfterDays = Math.max(0, Math.min(365, opts.staleAfterDays ?? WEEKLY_STALE_DAYS));
    const staleBefore = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
    // Prefer the least-recently observed public metadata first, then by created_at.
    const items = await channelRepo.list({
      filter: { status: 'approved' as const },
      sort: { public_followers_observed_at: 1, created_at: 1 },
      limit,
    });
    const details: RefreshResult[] = [];
    let okc = 0, skc = 0, fc = 0, freshSkipped = 0, processed = 0;
    for (const c of items) {
      if (!c.whatsapp_url) { skc++; continue; }
      // Weekly cadence: skip anything already observed inside the window.
      const observed = c.public_followers_observed_at ? new Date(c.public_followers_observed_at).getTime() : 0;
      if (staleAfterDays > 0 && observed && observed > staleBefore) { skc++; freshSkipped++; continue; }
      processed += 1;
      try {
        const r = await refreshChannelFromPublicMetadata({
          id: c.id,
          whatsapp_url: c.whatsapp_url,
          logo_url: c.logo_url,
          description: c.description,
          short_description: c.short_description,
          public_followers_count: c.public_followers_count ?? null,
        });
        details.push(r);
        if (r.ok) okc++; else fc++;
      } catch {
        // Failure isolation: never let one channel abort the weekly run.
        fc++;
        details.push({ channel_id: c.id, ok: false, updated_fields: [], observed_at: null, reason: 'refresh_threw' });
      }
      if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
    }
    return { processed, ok: okc, skipped: skc, failed: fc, skipped_fresh: freshSkipped, details };
  },
};
