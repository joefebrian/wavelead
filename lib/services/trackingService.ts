// Event ingestion for WaveLead. All persistence here is fire-and-forget:
// a tracking failure MUST NEVER block the user-facing response.
import { v4 as uuidv4 } from 'uuid';
import { eventRepo } from '../repositories/genericRepo';
import type { AcquisitionSource, EventRecord, EventType } from '@/lib/types';
import { ACQUISITION_SOURCES } from '@/lib/types';

const SOURCE_SET = new Set<AcquisitionSource>(ACQUISITION_SOURCES);

// Normalize any user-controlled `source` value to the canonical taxonomy.
// Unknown values collapse to `other`. Never accept arbitrary strings.
export function normalizeSource(v: unknown): AcquisitionSource {
  if (typeof v !== 'string') return 'other';
  const s = v.toLowerCase().trim();
  return SOURCE_SET.has(s as AcquisitionSource) ? (s as AcquisitionSource) : 'other';
}

// Legacy source values from M02/M03 events sometimes used slot-level names.
// Fold these deterministically into canonical sources for historical rollups.
const LEGACY_TO_CANONICAL: Record<string, AcquisitionSource> = {
  homepage_slot: 'homepage',
  homepage_popular: 'homepage',
  homepage_featured: 'homepage',
  homepage_new_noteworthy: 'homepage',
  homepage_top_channels: 'homepage',
  homepage_top: 'homepage',
  hero: 'homepage',
  hero_search: 'search',
  search_results: 'search',
  category_page: 'category',
  country_page: 'country',
  trending_page: 'trending',
  top_page: 'top',
  related: 'related_channel',
  profile: 'channel_profile',
  no_referrer: 'direct',
  '': 'other',
};

export function canonicalizeStoredSource(raw: unknown): AcquisitionSource {
  if (typeof raw !== 'string') return 'other';
  const s = raw.toLowerCase().trim();
  if (SOURCE_SET.has(s as AcquisitionSource)) return s as AcquisitionSource;
  if (s in LEGACY_TO_CANONICAL) return LEGACY_TO_CANONICAL[s];
  return 'other';
}

// Normalize search terms for grouping. Keeps only lowercased, whitespace-
// collapsed queries. Non-strings collapse to empty; caller decides to store.
export function normalizeQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  return q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Extract the normalized hostname from a URL string. Never store full URLs.
export function normalizeReferrerDomain(referrer: unknown, ownHosts: Set<string>): string | null {
  if (typeof referrer !== 'string' || !referrer) return null;
  try {
    const u = new URL(referrer);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    if (ownHosts.has(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export interface BaseTrackInput {
  channelId: string;
  anonymousSessionId: string | null;
  userId: string | null;
  source?: unknown;
  placement?: string | null;
  referrer?: string | null;
  referrerDomain?: string | null;
  searchQuery?: string | null;
  categorySlug?: string | null;
  countryCode?: string | null;
  deviceType?: string | null;
  pagePath?: string | null;
  campaignId?: string | null;
  trafficType?: 'organic' | 'sponsored';
  metadata?: Record<string, unknown>;
}

function buildEvent(type: EventType, input: BaseTrackInput): EventRecord {
  return {
    id: uuidv4(),
    event_type: type,
    anonymous_session_id: input.anonymousSessionId,
    user_id: input.userId,
    channel_id: input.channelId,
    campaign_id: input.campaignId ?? null,
    traffic_type: input.trafficType === 'sponsored' && input.campaignId ? 'sponsored' : 'organic',
    source: normalizeSource(input.source),
    placement: input.placement ? String(input.placement).slice(0, 60) : null,
    referrer: input.referrer ? String(input.referrer).slice(0, 500) : null,
    referrer_domain: input.referrerDomain ? String(input.referrerDomain).toLowerCase().slice(0, 120) : null,
    search_query: input.searchQuery ? normalizeQuery(input.searchQuery) : null,
    category_slug: input.categorySlug ? String(input.categorySlug).toLowerCase().slice(0, 80) : null,
    country_code: input.countryCode ? String(input.countryCode).toUpperCase().slice(0, 4) : null,
    device_type: input.deviceType ?? null,
    page_path: input.pagePath ?? null,
    metadata: input.metadata ?? {},
    created_at: new Date(),
  };
}

function fireAndForget(rec: EventRecord): void {
  eventRepo.insert(rec).catch((err) => {
    console.error(`[wavelead] ${rec.event_type} persistence failed:`, err);
  });
}

export const trackingService = {
  recordFollowClick(input: BaseTrackInput): void {
    fireAndForget(buildEvent('follow_click', input));
  },
  recordProfileView(input: BaseTrackInput): void {
    fireAndForget(buildEvent('channel_profile_view', input));
  },
  recordChannelImpression(input: BaseTrackInput): void {
    fireAndForget(buildEvent('channel_impression', input));
  },
  recordSearchImpression(input: BaseTrackInput & { searchQuery: string }): void {
    fireAndForget(buildEvent('search_impression', input));
  },
};
