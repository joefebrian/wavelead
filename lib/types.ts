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
  // Security metadata (M07-security patch)
  is_disabled?: boolean;
  session_version?: number;         // incremented on password change / admin reset / disable
  must_change_password?: boolean;   // set by admin reset; enforced on /change-password
  password_updated_at?: Date | null;
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
  // M06.1 hardening — durable internal marker used by
  // publicChannelVisibility to hide test/QA fixtures from every public
  // discovery surface (browse, direct lookup, search, homepage). Never
  // settable via public API; never leaked to public responses.
  is_test_fixture?: boolean;
}

export type PublicChannel = Omit<
  Channel,
  | 'owner_id'
  | 'verification_status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'rejection_reason'
  | 'rejection_notes'
  | 'is_test_fixture'
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
  v?: number;   // session_version at issuance — invalidated when user.session_version bumps
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

  // M06.0 Phase 3: precise micros counter (2,000 micros per impression at
  // $2.00 CPM). estimated_spend_usd_minor stays as the display-rounded value.
  estimated_spend_usd_micros?: number;

  // M06.0 Phase 3: cached ledger aggregates (derivable but kept on the campaign
  // doc so `atomicDeliverImpression` can gate delivery in one Mongo op).
  //   available_funds_micros = (funded_amount_usd_micros - refunded_amount_usd_micros) - estimated_spend_usd_micros
  // Never let this drop below zero.
  funded_amount_usd_micros?: number;
  refunded_amount_usd_micros?: number;

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

// =====================================================================
// M06.0 — Payments / Campaign Funding
// =====================================================================

// Funding lifecycle (provider-neutral):
//   created           — internal record exists, no provider order yet
//   checkout_created  — provider order created, buyer has not approved
//   pending           — buyer approved but capture not yet confirmed
//   paid              — capture confirmed AND campaign_funding_ledger posted
//   failed            — capture explicitly failed
//   cancelled         — buyer cancelled or order voided
//   partially_refunded / refunded — reversal path
//   legacy_waived     — pre-M06 campaigns migrated in-place; no payment required
export type FundingStatus =
  | 'created'
  | 'checkout_created'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded'
  | 'legacy_waived';

export interface PaymentFundingOrder {
  id: string;
  campaign_id: string;
  owner_user_id: string;
  provider: 'paypal' | 'stripe' | 'mock' | 'local';
  provider_order_id: string | null;
  provider_capture_id: string | null;
  // M06.1: generic per-provider identifiers. Optional / nullable to keep
  // historical PayPal records structurally valid without a migration.
  provider_session_id?: string | null;
  provider_payment_id?: string | null;
  provider_channel_code?: string | null;
  currency: string;                    // ISO 4217 (payment currency for this order)
  payment_currency?: string;           // M06.1: explicit payment-currency marker (mirrors `currency` for legacy)
  amount_minor: number;                // funding request in payment-currency minor units (PayPal cents; IDR whole)
  payment_amount_provider_units?: number; // M06.1: explicit provider-native amount (IDR uses whole units)
  amount_captured_minor: number;
  amount_refunded_minor: number;
  amount_usd_micros: number;           // frozen conversion to internal ad ledger currency
  fx_quote_id?: string | null;         // M06.1: nullable link to locked USD/IDR quote (PayPal remains null)
  status: FundingStatus;
  approve_url: string | null;          // buyer redirect target (safe for client)
  return_url: string | null;
  cancel_url: string | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  refunded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// M06.1 \u2014 USD/IDR FX support (display + future local-payment readiness)
// =============================================================================
// Rates are represented as `rate_scaled / 10^rate_scale`. Integer-safe.
export interface FundingFxRate {
  id: string;
  base_currency: string;            // 'USD'
  quote_currency: string;           // 'IDR'
  rate_scaled: number;              // e.g. 16500 for 1 USD = 16500 IDR
  rate_scale: number;               // e.g. 0 for the above; 4 for 16523.4567
  source: 'admin' | 'automated';    // M06.1 uses 'admin'
  active: boolean;                  // exactly one row per pair is active at a time
  effective_from: Date;
  effective_until: Date | null;
  note: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type FundingFxQuoteStatus = 'open' | 'expired' | 'consumed';

// Immutable locked snapshot. Only `status` transitions; all other fields
// are frozen at `locked_at`.
export interface FundingFxQuote {
  id: string;
  campaign_id: string;
  funding_order_id: string | null;   // populated later if the quote is consumed by a real funding
  base_currency: string;             // 'USD'
  quote_currency: string;            // 'IDR'
  campaign_usd_micros: number;       // exact source-of-truth amount at quote time
  rate_scaled: number;
  rate_scale: number;
  quoted_idr_amount: number;         // integer whole rupiah
  source_rate_id: string;            // FK \u2192 funding_fx_rates.id
  locked_at: Date;
  expires_at: Date;
  status: FundingFxQuoteStatus;
}

// Immutable double-entry ledger row. Positive entries credit the campaign;
// negative-signed reversal rows record refunds. Balance is derived by summing
// all rows for a campaign (never stored directly).
export type LedgerEntryType =
  | 'funding_credit'    // paid capture → +amount
  | 'spend_debit'       // future: reserved for delivery spend
  | 'refund_debit'      // refund → -amount
  | 'refund_reversal';  // reversal of a refund → +amount

export interface CampaignFundingLedgerEntry {
  id: string;
  campaign_id: string;
  funding_id: string | null;           // link to the funding order (nullable for adjustments)
  entry_type: LedgerEntryType;
  direction: 'credit' | 'debit';
  amount_usd_micros: number;           // absolute value; sign is derived from direction
  balance_after_usd_micros: number | null;   // optional snapshot for auditing
  provider_reference: string | null;   // e.g. capture id / refund id
  idempotency_key: string;             // unique — deduplicates concurrent postings
  metadata: Record<string, unknown>;
  created_at: Date;
}

// Persistence log for verified provider webhooks. Provider event id is the
// idempotency key — duplicate deliveries never mutate business state twice.
export interface PaymentWebhookEvent {
  id: string;
  provider: 'paypal' | 'stripe' | 'mock';
  provider_event_id: string;
  event_type: string;
  raw_payload: Record<string, unknown>;
  processed: boolean;
  processed_at: Date | null;
  process_error: string | null;
  received_at: Date;
}

// ============================================================================
// M06.0 Phase 3 — Immutable double-entry ledger
// ============================================================================
// The single source of truth for campaign money movement. Every dollar in and
// out is a `LedgerTransaction` with N postings that MUST sum to zero (total
// debits == total credits in USD micros). Transactions are append-only —
// corrections happen via reversing transactions, never updates.
export type LedgerAccount =
  | 'gateway_clearing'       // money in-flight at PayPal
  | 'campaign_unspent_funds' // funds committed to a specific campaign
  | 'ad_delivery_revenue'    // WaveLead revenue realized from billable impressions
  | 'refund_payable'         // pending outflows to refund a buyer
  | 'rounding_adjustment';   // reserved: reconciles CPM integer rounding

export type LedgerTransactionType =
  | 'funding_credit'    // PayPal capture → campaign_unspent_funds
  | 'spend_debit'       // billable impression → ad_delivery_revenue
  | 'refund_debit'      // funds pulled back → refund_payable
  | 'rounding_adjustment';

export interface LedgerPosting {
  account: LedgerAccount;
  direction: 'debit' | 'credit';
  amount_usd_micros: number; // positive integer only
}

export interface LedgerTransaction {
  id: string;
  transaction_type: LedgerTransactionType;
  idempotency_key: string;       // unique — prevents any duplicate posting
  campaign_id: string;
  funding_order_id: string | null;
  provider_event_id: string | null;
  reference_event_id: string | null; // impression id / capture id / refund id
  postings: LedgerPosting[];
  amount_usd_micros: number;     // convenience: sum of debits (== sum of credits)
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ============================================================================
// M06.0 Phase 4 — Refund workflow
// ============================================================================
export type RefundStatus =
  | 'none'                 // no refund; used only conceptually
  | 'eligible'             // system computed refundable > 0; nothing requested yet
  | 'pending'              // refund_request created by owner cancel; awaits admin exec
  | 'processing'           // admin dispatched to provider; provider async
  | 'partially_refunded'   // provider confirmed partial amount
  | 'refunded'             // provider confirmed full refundable amount
  | 'failed';

export interface PaymentRefund {
  id: string;
  funding_order_id: string;
  campaign_id: string;
  owner_user_id: string;
  provider: 'paypal' | 'stripe' | 'mock' | 'local';
  provider_refund_id: string | null;
  requested_amount_minor: number;      // owner-requested (== unused refundable at request time)
  requested_amount_usd_micros: number;
  actual_refunded_amount_minor: number;
  actual_refunded_usd_micros: number;
  status: RefundStatus;
  requested_by_user_id: string;        // usually the owner cancelling
  executed_by_user_id: string | null;  // admin who ran the provider call
  reason: string | null;
  requested_at: Date;
  processed_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}


// ============================================================
// M07-Lite — Sponsorship Leads (sales-assisted commercial funnel)
// ============================================================
export type SponsorshipLeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
export type SponsorshipObjective = 'brand_awareness' | 'traffic' | 'product_launch' | 'promotion' | 'other';
export type SponsorshipBudgetRange = 'under_500' | '500_1000' | '1000_2500' | '2500_5000' | '5000_plus';

export interface SponsorshipLead {
  id: string;
  channel_id: string;
  channel_slug_snapshot: string;
  channel_name_snapshot: string;
  requester_user_id: string | null;
  requester_role: Role | null;
  company_name: string;
  contact_name: string;
  work_email: string;
  objective: SponsorshipObjective;
  budget_range: SponsorshipBudgetRange;
  target_country: string | null;
  desired_start_at: Date | null;
  brief: string;
  status: SponsorshipLeadStatus;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================================
// M07-security — Integration credential vault (PayPal + future providers)
// ============================================================
export type IntegrationProvider = 'paypal';
export type IntegrationEnvironment = 'sandbox' | 'live';

export interface IntegrationCredential {
  id: string;
  provider: IntegrationProvider;
  environment: IntegrationEnvironment;
  client_id: string;               // NOT secret; stored plain for masking display
  client_secret_ciphertext: string; // AES-256-GCM base64: iv:ct:tag
  webhook_id: string | null;
  configured_by: string;           // user id
  last_connection_test_at: Date | null;
  last_connection_test_status: 'success' | 'failure' | null;
  last_connection_test_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SecurityAuditEvent {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  event_type: string;              // e.g. PAYPAL_CONFIG_UPDATED, USER_PASSWORD_RESET, USER_PASSWORD_CHANGED, USER_DISABLED
  subject_user_id?: string | null;
  metadata: Record<string, unknown>;  // NEVER contains secrets
  created_at: Date;
}
