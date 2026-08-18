// Orchestrates the smart-import pipeline:
//   1. Normalize URL → canonical channel_id
//   2. Duplicate lookup (short-circuits everything expensive)
//   3. Rate-limit + refresh cooldown check
//   4. Cache lookup (success 24h, negative 30min)
//   5. OG fetch  → factual metadata (public_metadata provenance)
//   6. LLM infer → suggestions (wavelead_inference provenance)
//   7. Cache + return
// Fail-open: anything below step 3 that fails still returns a usable
// response — the user can submit the form manually.

import { v4 as uuidv4 } from 'uuid';
import { normalizeChannelUrl } from './urlNormalizer';
import type { NormalizedChannelUrl } from './urlNormalizer';
import { fetchPublicChannelMetadata, type PublicChannelMetadata } from './ogFetcher';
import { GeminiFlashProvider } from './geminiProvider';
import { applyThresholds, type MetadataInferenceProvider, type InferenceOutput } from './inferenceProvider';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import type { Actor } from '@/lib/types';

const SUCCESS_TTL_MS = 24 * 60 * 60_000;
const NEGATIVE_TTL_MS = 30 * 60_000;
const REFRESH_COOLDOWN_MS = 5 * 60_000;
const RATE_ANON_MAX = 10;
const RATE_USER_MAX = 20;
const RATE_WINDOW_MS = 60_000;

export interface EnrichField<T> { value: T | null; source: 'public_metadata' | 'wavelead_inference' | 'user' | null; confidence: number; editable: boolean; }
export type EnrichmentStatus = 'success' | 'partial' | 'unavailable' | 'rate_limited' | 'invalid_url' | 'duplicate';
export interface EnrichmentResult {
  status: EnrichmentStatus;
  duplicate?: {
    slug: string; name: string; public_url: string;
    is_verified: boolean; has_owner: boolean; is_official: boolean;
    owned_by_me: boolean; pending_submission?: boolean;
    suggested_action: 'view' | 'claim' | 'manage' | 'report' | 'submission_status';
  };
  canonical?: { channel_id: string; canonical_url: string };
  fields?: {
    channel_name: EnrichField<string>;
    description: EnrichField<string>;
    logo_url: EnrichField<string>;
    short_description: EnrichField<string>;
    category_slug: EnrichField<string>;
    primary_language: EnrichField<string>;
    country_code: EnrichField<string>;
  };
  metadata_available: boolean;
  inference_available: boolean;
  cached: boolean;
  cache_at?: string;
  refresh_available_at?: string;
  provider?: string;
  inference_version?: string;
}

// In-memory rate limiter (per-process). For a single-container deploy this is
// sufficient. If we ever scale to N replicas we'll move to Redis/Mongo.
const rateBuckets: Map<string, number[]> = new Map();
function rateHit(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= max) { rateBuckets.set(key, arr); return true; }
  arr.push(now); rateBuckets.set(key, arr); return false;
}

function publicUrl(slug: string): string { return `/channel/${slug}`; }

async function findExisting(n: NormalizedChannelUrl) {
  const coll = await getCollection(COLLECTIONS.CHANNELS);
  return await coll.findOne({
    $or: [
      { whatsapp_channel_id: n.channel_id },
      { whatsapp_url: { $regex: new RegExp(`/channel/${n.channel_id}(?:$|[/?])`, 'i') } },
    ],
  });
}

interface CacheDoc {
  cache_key: string; canonical_url: string; channel_id: string; inference_version: string;
  status: EnrichmentStatus; result: EnrichmentResult; expires_at: Date; updated_at: Date; last_refresh_at: Date;
}

async function getCache(cacheKey: string): Promise<CacheDoc | null> {
  const coll = await getCollection<CacheDoc>(COLLECTIONS.ENRICHMENT_CACHE);
  const doc = await coll.findOne({ cache_key: cacheKey });
  if (!doc) return null;
  if (new Date(doc.expires_at).getTime() < Date.now()) return null;
  return doc;
}
async function setCache(cacheKey: string, canonicalUrl: string, channelId: string, inferenceVersion: string, result: EnrichmentResult, ttlMs: number): Promise<void> {
  const coll = await getCollection<CacheDoc>(COLLECTIONS.ENRICHMENT_CACHE);
  const now = new Date();
  const doc: CacheDoc = {
    cache_key: cacheKey, canonical_url: canonicalUrl, channel_id: channelId, inference_version: inferenceVersion,
    status: result.status, result: { ...result, cached: true, cache_at: now.toISOString() },
    expires_at: new Date(now.getTime() + ttlMs), updated_at: now, last_refresh_at: now,
  };
  await coll.updateOne({ cache_key: cacheKey }, { $set: doc }, { upsert: true });
}

export async function enrich(actor: Actor | null, input: { channel_url: string; force_refresh?: boolean; ipAddress?: string | null }): Promise<EnrichmentResult> {
  const rateKey = actor ? `u:${actor.user.id}` : `ip:${input.ipAddress || 'unknown'}`;
  const max = actor ? RATE_USER_MAX : RATE_ANON_MAX;
  if (rateHit(rateKey, max)) return { status: 'rate_limited', metadata_available: false, inference_available: false, cached: false };

  const normalized = normalizeChannelUrl(input.channel_url);
  if (!normalized) return { status: 'invalid_url', metadata_available: false, inference_available: false, cached: false };

  // Duplicate lookup ALWAYS runs before any expensive work.
  const existing = await findExisting(normalized);
  if (existing) {
    const isMine = !!actor && existing.owner_id === actor.user.id;
    const isVerified = existing.verification_status === 'verified' || existing.verification_status === 'official';
    const isOfficial = existing.is_official === true || existing.verification_status === 'official';
    const suggested_action: 'view' | 'claim' | 'manage' | 'report' | 'submission_status' =
      isMine ? 'manage'
      : (isVerified || existing.owner_id) ? (isOfficial ? 'view' : 'report')
      : (existing.status === 'approved' ? 'claim' : 'submission_status');
    return {
      status: 'duplicate',
      duplicate: {
        slug: existing.slug, name: existing.name, public_url: publicUrl(existing.slug),
        is_verified: isVerified, has_owner: !!existing.owner_id, is_official: isOfficial,
        owned_by_me: isMine,
        suggested_action,
      },
      canonical: { channel_id: normalized.channel_id, canonical_url: normalized.canonical_url },
      metadata_available: false, inference_available: false, cached: false,
    };
  }

  const catRows = await categoryRepo.listActive();
  const categorySlugs = catRows.map((c) => c.slug);
  const provider: MetadataInferenceProvider = new GeminiFlashProvider(categorySlugs);
  const cacheKey = `${normalized.channel_id}::${provider.inference_version}`;

  // Cache read + refresh cooldown
  const cached = await getCache(cacheKey);
  if (cached && !input.force_refresh) {
    return cached.result;
  }
  if (cached && input.force_refresh) {
    const nextRefresh = new Date(cached.last_refresh_at).getTime() + REFRESH_COOLDOWN_MS;
    if (Date.now() < nextRefresh) {
      return { ...cached.result, refresh_available_at: new Date(nextRefresh).toISOString() };
    }
  }

  // OG fetch
  let og: PublicChannelMetadata | null = null;
  try { og = await fetchPublicChannelMetadata(normalized); } catch { og = null; }

  // LLM inference — only when we have enough seed text
  let inference: InferenceOutput | null = null;
  if (og && (og.title || og.description)) {
    try {
      const raw = await provider.infer({ channelName: og.title || '', description: og.description || '' });
      inference = applyThresholds(raw, categorySlugs);
    } catch { inference = null; }
  }

  const metadata_available = !!og && !!(og.title || og.description);
  const inference_available = !!inference && !!(inference.category.value || inference.language.value || inference.country.value);
  const status: EnrichmentStatus = metadata_available && inference_available ? 'success' : metadata_available ? 'partial' : 'unavailable';

  const shortDesc = og?.description ? og.description.slice(0, 180) : null;
  const result: EnrichmentResult = {
    status,
    canonical: { channel_id: normalized.channel_id, canonical_url: normalized.canonical_url },
    fields: {
      channel_name:       { value: og?.title || null,       source: og?.title ? 'public_metadata' : null, confidence: og?.title ? 1 : 0, editable: true },
      description:        { value: og?.description || null, source: og?.description ? 'public_metadata' : null, confidence: og?.description ? 1 : 0, editable: true },
      logo_url:           { value: og?.image_url || null,   source: og?.image_url ? 'public_metadata' : null, confidence: og?.image_url ? 1 : 0, editable: true },
      short_description:  { value: shortDesc || null,       source: shortDesc ? 'public_metadata' : null, confidence: shortDesc ? 1 : 0, editable: true },
      category_slug:      { value: inference?.category.value || null, source: inference?.category.value ? 'wavelead_inference' : null, confidence: inference?.category.confidence ?? 0, editable: true },
      primary_language:   { value: inference?.language.value || null, source: inference?.language.value ? 'wavelead_inference' : null, confidence: inference?.language.confidence ?? 0, editable: true },
      country_code:       { value: inference?.country.value  || null, source: inference?.country.value  ? 'wavelead_inference' : null, confidence: inference?.country.confidence  ?? 0, editable: true },
    },
    metadata_available, inference_available,
    cached: false, provider: provider.name, inference_version: provider.inference_version,
  };

  const ttl = status === 'unavailable' ? NEGATIVE_TTL_MS : SUCCESS_TTL_MS;
  await setCache(cacheKey, normalized.canonical_url, normalized.channel_id, provider.inference_version, result, ttl);
  return result;
}

export const enrichmentService = { enrich };

// Test helper: reset the in-memory rate buckets.
export function __resetRateLimiter(): void { rateBuckets.clear(); }

// Test helper: force a specific inference provider (e.g. deterministic mock).
export function __setInferenceProviderForTests(_p: MetadataInferenceProvider | null): void { /* placeholder */ }

// Uuid re-export so callers building fake docs can reuse ids.
export { uuidv4 };
