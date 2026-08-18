// Shared domain types for WaveLead. Do not weaken with `any`.

export type Role =
  | 'visitor'
  | 'user'
  | 'channel_owner'
  | 'business'
  | 'moderator'
  | 'admin'
  | 'super_admin';

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
  country_code: string | null;
  preferred_language: string;
  password_hash?: string; // never leaked outside auth service
  auth_providers: string[];
  created_at: Date;
  updated_at: Date;
}

export type PublicUser = Omit<User, 'password_hash'>;

export type ChannelStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'archived';

export type VerificationStatus = 'unclaimed' | 'claimed' | 'verified' | 'official';

export interface Channel {
  id: string;
  slug: string;
  name: string;
  whatsapp_url: string;
  whatsapp_channel_id?: string | null;
  description: string | null;
  short_description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  website_url: string | null;
  country_code: string | null;
  primary_language: string | null;
  category_id: string | null;
  owner_id: string | null;
  status: ChannelStatus;
  verification_status: VerificationStatus;
  is_official: boolean;
  is_featured: boolean;
  is_nsfw: boolean;
  is_demo: boolean;
  activity_level: string;
  follower_count: number;
  follower_count_source: string;
  follower_count_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  // Moderation trail (internal — sanitized out of public responses).
  reviewed_by?: string | null;
  reviewed_at?: Date | null;
  rejection_reason?: string | null;
  rejection_notes?: string | null;
}

export type PublicChannel = Omit<
  Channel,
  | 'owner_id'
  | 'verification_status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'rejection_reason'
  | 'rejection_notes'
> & {
  is_verified: boolean;
  is_official: boolean;
  has_owner: boolean;
};

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  parent_id: string | null;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export type ClaimStatus = 'draft' | 'pending' | 'needs_information' | 'approved' | 'rejected' | 'cancelled';

export type ClaimVerificationMethod = 'domain' | 'social' | 'manual';

export interface ClaimEvidenceItem {
  evidence_type: 'website' | 'youtube' | 'instagram' | 'tiktok' | 'x' | 'facebook' | 'other';
  evidence_url: string;
  note?: string | null;
}

export type ClaimRejectReason =
  | 'insufficient_evidence'
  | 'evidence_mismatch'
  | 'channel_already_owned'
  | 'impersonation'
  | 'duplicate_claim'
  | 'fraud'
  | 'invalid_information'
  | 'other';

export interface ChannelClaim {
  id: string;
  channel_id: string;
  claimant_user_id: string;
  verification_method: ClaimVerificationMethod;
  claimant_note: string | null;
  evidence_urls: ClaimEvidenceItem[];
  evidence_metadata: Record<string, unknown>;
  claimant_email: string;
  website_domain: string | null;
  email_domain: string | null;
  domain_match: boolean;
  status: ClaimStatus;
  moderator_notes: string | null;
  request_more_info_message: string | null;
  reject_reason: ClaimRejectReason | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  approved_at: Date | null;
  rejected_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Public-facing claim (never expose moderator_notes / evidence internals to
// anyone other than the claimant themself or a moderator).
export type PublicClaimForClaimant = Omit<ChannelClaim, 'moderator_notes'>;
export type PublicClaimSummary = Pick<ChannelClaim,
  'id' | 'channel_id' | 'status' | 'verification_method' | 'submitted_at' |
  'reviewed_at' | 'approved_at' | 'rejected_at' | 'request_more_info_message'>;

// Sensitive change-request workflow (M03.7).
export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ChannelChangeRequest {
  id: string;
  channel_id: string;
  owner_id: string;
  changes: Record<string, unknown>;   // e.g. { whatsapp_url, name, website_url, category_slug, country_code }
  status: ChangeRequestStatus;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  moderator_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export type EventType =
  | 'channel_impression'
  | 'channel_profile_view'
  | 'follow_click'
  | 'bookmark'
  | 'share'
  | 'search'
  | 'search_impression'
  | 'category_view'
  | 'submit_started'
  | 'submit_completed'
  | 'claim_started'
  | 'claim_completed';

// Canonical Acquisition Source Taxonomy (M04).
// Keep this list closed: unknown values are normalized to 'other'.
export type AcquisitionSource =
  | 'search'
  | 'homepage'
  | 'trending'
  | 'top'
  | 'category'
  | 'country'
  | 'related_channel'
  | 'channel_profile'
  | 'direct'
  | 'external'
  | 'other';

export const ACQUISITION_SOURCES: readonly AcquisitionSource[] = [
  'search','homepage','trending','top','category','country','related_channel','channel_profile','direct','external','other',
] as const;

export const SOURCE_LABELS: Record<AcquisitionSource, string> = {
  search: 'WaveLead Search',
  homepage: 'Homepage',
  trending: 'Trending',
  top: 'Top Channels',
  category: 'Category Discovery',
  country: 'Country Discovery',
  related_channel: 'Related Channels',
  channel_profile: 'Channel Profile',
  direct: 'Direct',
  external: 'External',
  other: 'Other',
};

export interface EventRecord {
  id: string;
  event_type: EventType;
  anonymous_session_id: string | null;
  user_id: string | null;
  channel_id: string | null;
  campaign_id: string | null;
  traffic_type: 'organic' | 'sponsored';
  source: AcquisitionSource | null;
  placement: string | null;
  referrer: string | null;
  referrer_domain: string | null;
  search_query: string | null;
  category_slug: string | null;
  country_code: string | null;
  device_type: string | null;
  page_path: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface DailyMetric {
  id: string;
  channel_id: string;
  date: string; // YYYY-MM-DD (UTC)
  discovery_impressions: number;
  search_impressions: number;
  profile_views: number;
  unique_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  bookmarks: number;
  shares: number;
  last_aggregated_at: Date;
}

// Per-source (canonical) daily rollup for the same channel/date.
export interface DailySourceMetric {
  id: string;
  channel_id: string;
  date: string;
  source: AcquisitionSource;
  impressions: number;           // discovery + search combined per source
  profile_views: number;
  unique_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  last_aggregated_at: Date;
}

// Privacy-safe search-query rollup. Only exposed to owner if impressions >= threshold.
export interface SearchQueryMetric {
  id: string;
  channel_id: string;
  date: string;
  normalized_query: string;
  impressions: number;
  profile_views: number;
  unique_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  last_aggregated_at: Date;
}

// Rollup coordination row: tracks freshness + a lightweight advisory lock.
export interface RollupState {
  id: string;
  channel_id: string;
  date: string;
  last_aggregated_at: Date;
  locked_until: Date | null;
  updated_at: Date;
}

export interface Report {
  id: string;
  channel_id: string;
  reporter_user_id: string | null;
  reason: string;
  details: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export interface AuditLog {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: Date;
}

// JWT payload — identity ONLY. Role is always resolved fresh from DB.
export interface SessionPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Actor object returned by resolveActor(request): current identity + DB role.
export interface Actor {
  session: SessionPayload;
  user: PublicUser;
}

// =====================================================================
// M05.1 — Promote Channel / Sponsored Discovery
// =====================================================================

export type TrafficType = 'organic' | 'sponsored';

export type SponsoredPlacement =
  | 'sponsored_search'
  | 'sponsored_homepage'
  | 'sponsored_category'
  | 'sponsored_country'
  | 'sponsored_related_channel';

export const SPONSORED_PLACEMENTS: readonly SponsoredPlacement[] = [
  'sponsored_search',
  'sponsored_homepage',
  'sponsored_category',
  'sponsored_country',
  'sponsored_related_channel',
] as const;

// Map sponsored placement → canonical organic acquisition source.
// Sponsored placements NEVER map to trending or top.
export const PLACEMENT_TO_SOURCE: Record<SponsoredPlacement, AcquisitionSource> = {
  sponsored_search: 'search',
  sponsored_homepage: 'homepage',
  sponsored_category: 'category',
  sponsored_country: 'country',
  sponsored_related_channel: 'related_channel',
};

export type CampaignObjective = 'visibility' | 'follow_intent';
export const CAMPAIGN_OBJECTIVES: readonly CampaignObjective[] = ['visibility', 'follow_intent'] as const;

export type PromotionCampaignStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type PromotionRejectionReason =
  | 'invalid_targeting'
  | 'invalid_budget'
  | 'channel_not_eligible'
  | 'placement_unavailable'
  | 'policy_concern'
  | 'duplicate_or_test'
  | 'other';

export interface PromotionRateSnapshotItem {
  placement: SponsoredPlacement;
  pricing_model: 'cpm';
  cpm_usd_minor: number;
  rate_card_id: string;
  country_code: string | null;
  resolved_at: Date;
}

export interface PromotionTargeting {
  countries: string[];       // ISO 3166-1 alpha-2, uppercase; [] means any
  languages: string[];       // ISO 639-1, lowercase;         [] means any
  categories: string[];      // category slugs;               [] means any
}

export interface PromotionCampaign {
  id: string;

  owner_user_id: string;
  channel_id: string;

  name: string;
  objective: CampaignObjective;

  placements: SponsoredPlacement[];
  targeting: PromotionTargeting;

  budget_total_usd_minor: number;
  budget_daily_usd_minor: number | null;

  start_at: Date;
  end_at: Date;

  status: PromotionCampaignStatus;

  // Snapshot of resolved rates at submission time. Later admin rate changes
  // must not retroactively alter historical campaign economics.
  rate_snapshot: PromotionRateSnapshotItem[] | null;

  delivered_impressions: number;
  estimated_spend_usd_minor: number;

  created_at: Date;
  updated_at: Date;

  submitted_at: Date | null;

  reviewed_at: Date | null;
  reviewed_by: string | null;
  rejection_reason: PromotionRejectionReason | null;
  rejection_notes: string | null;

  activated_at: Date | null;
  paused_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

export interface PromotionRateCard {
  id: string;
  placement: SponsoredPlacement;
  country_code: string | null;   // null = global fallback
  pricing_model: 'cpm';
  cpm_usd_minor: number;
  active: boolean;
  effective_from: Date;
  effective_to: Date | null;
  is_fixture: boolean;           // marks QA/seeded default rate
  seed_key: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

export interface CampaignImpressionDedup {
  campaign_id: string;
  anonymous_session_id: string;
  impression_count: number;
  window_started_at: Date;
  last_impression_at: Date;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

// Per (campaign, date, placement) daily rollup for sponsored performance.
export interface CampaignDailyMetric {
  id: string;
  campaign_id: string;
  channel_id: string;
  date: string;                             // YYYY-MM-DD UTC
  placement: SponsoredPlacement;
  sponsored_impressions: number;
  sponsored_profile_views: number;
  unique_sponsored_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  spend_usd_minor: number;
  last_aggregated_at: Date;
}
