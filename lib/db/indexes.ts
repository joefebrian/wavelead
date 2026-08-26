import { Db } from 'mongodb';
import { COLLECTIONS } from './collections';

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(COLLECTIONS.USERS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { email: 1 }, unique: true, name: 'uniq_email' },
      { key: { role: 1 }, name: 'by_role' },
    ]),
    db.collection(COLLECTIONS.CHANNELS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { slug: 1 }, unique: true, name: 'uniq_slug' },
      { key: { whatsapp_url: 1 }, unique: true, name: 'uniq_wa_url' },
      { key: { status: 1, created_at: -1 }, name: 'status_created' },
      { key: { category_id: 1, status: 1 }, name: 'category_status' },
      { key: { country_code: 1, status: 1 }, name: 'country_status' },
      { key: { is_featured: 1, status: 1 }, name: 'featured_status' },
      { key: { follower_count: -1, status: 1 }, name: 'ranking' },
      { key: { owner_id: 1 }, name: 'by_owner' },
    ]),
    db.collection(COLLECTIONS.CATEGORIES).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { slug: 1 }, unique: true, name: 'uniq_slug' },
      { key: { parent_id: 1 }, name: 'by_parent' },
      { key: { is_active: 1, display_order: 1 }, name: 'active_order' },
    ]),
    db.collection(COLLECTIONS.CHANNEL_CATEGORIES).createIndexes([
      { key: { channel_id: 1, category_id: 1 }, unique: true, name: 'uniq_pair' },
    ]),
    db.collection(COLLECTIONS.CHANNEL_CLAIMS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { channel_id: 1 }, name: 'by_channel' },
      { key: { claimant_user_id: 1 }, name: 'by_claimant' },
      { key: { status: 1, submitted_at: -1 }, name: 'status_submitted' },
      // At most one active claim per (channel, claimant) — enforced by app
      // logic (we can't use a partial unique index across mixed status values
      // in a portable way; the service layer checks + a unique write barrier).
    ]),
    db.collection(COLLECTIONS.CHANNEL_CHANGE_REQUESTS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { channel_id: 1, status: 1 }, name: 'channel_status' },
      { key: { owner_id: 1, status: 1 }, name: 'owner_status' },
      { key: { status: 1, submitted_at: -1 }, name: 'status_time' },
    ]),
    db.collection(COLLECTIONS.EVENTS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { channel_id: 1, created_at: -1 }, name: 'channel_time' },
      { key: { event_type: 1, created_at: -1 }, name: 'type_time' },
      { key: { anonymous_session_id: 1 }, name: 'by_session' },
      { key: { created_at: -1 }, name: 'time_desc' },
    ]),
    db.collection(COLLECTIONS.CHANNEL_DAILY_METRICS).createIndexes([
      { key: { channel_id: 1, date: 1 }, unique: true, name: 'uniq_channel_date' },
      { key: { date: -1 }, name: 'by_date' },
    ]),
    db.collection(COLLECTIONS.CHANNEL_DAILY_SOURCE_METRICS).createIndexes([
      { key: { channel_id: 1, date: 1, source: 1 }, unique: true, name: 'uniq_channel_date_source' },
      { key: { channel_id: 1, date: 1 }, name: 'channel_date' },
      { key: { date: -1 }, name: 'by_date' },
    ]),
    db.collection(COLLECTIONS.CHANNEL_SEARCH_QUERY_METRICS).createIndexes([
      { key: { channel_id: 1, date: 1, normalized_query: 1 }, unique: true, name: 'uniq_channel_date_query' },
      { key: { channel_id: 1, date: 1 }, name: 'channel_date' },
      { key: { normalized_query: 1 }, name: 'by_query' },
    ]),
    db.collection(COLLECTIONS.ROLLUP_STATE).createIndexes([
      { key: { channel_id: 1, date: 1 }, unique: true, name: 'uniq_channel_date' },
    ]),
    db.collection(COLLECTIONS.ENRICHMENT_CACHE).createIndexes([
      { key: { cache_key: 1 }, unique: true, name: 'uniq_cache_key' },
      { key: { canonical_url: 1 }, name: 'by_canonical_url' },
      { key: { expires_at: 1 }, expireAfterSeconds: 0, name: 'ttl_expires_at' },
    ]),
    // M05: unique index on whatsapp_channel_id for canonical duplicate protection.
    // sparse:true so legacy rows without the field don't collide during backfill.
    db.collection(COLLECTIONS.CHANNELS).createIndex(
      { whatsapp_channel_id: 1 },
      { unique: true, sparse: true, name: 'uniq_whatsapp_channel_id' },
    ),
    db.collection(COLLECTIONS.BOOKMARKS).createIndexes([
      { key: { user_id: 1, channel_id: 1 }, unique: true, name: 'uniq_bookmark' },
      { key: { user_id: 1, created_at: -1 }, name: 'user_time' },
    ]),
    db.collection(COLLECTIONS.REPORTS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { channel_id: 1 }, name: 'by_channel' },
      { key: { status: 1, created_at: -1 }, name: 'status_time' },
    ]),
    db.collection(COLLECTIONS.AUDIT_LOGS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { actor_user_id: 1, created_at: -1 }, name: 'actor_time' },
      { key: { entity_type: 1, entity_id: 1, created_at: -1 }, name: 'entity_time' },
    ]),
    db.collection(COLLECTIONS.HOMEPAGE_SLOTS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { section: 1, channel_id: 1 }, unique: true, name: 'uniq_section_channel' },
      { key: { section: 1, active: 1, priority: 1 }, name: 'section_priority' },
    ]),
    // ---------- M05.1 Promote Channel / Sponsored Discovery ----------
    db.collection(COLLECTIONS.PROMOTION_CAMPAIGNS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { owner_user_id: 1, created_at: -1 }, name: 'by_owner_time' },
      { key: { channel_id: 1, status: 1 }, name: 'by_channel_status' },
      { key: { status: 1, start_at: 1 }, name: 'status_start' },
      { key: { status: 1, end_at: 1 }, name: 'status_end' },
    ]),
    db.collection(COLLECTIONS.PROMOTION_RATE_CARDS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { placement: 1, country_code: 1, active: 1 }, name: 'lookup' },
      { key: { seed_key: 1 }, sparse: true, name: 'by_seed_key' },
    ]),
    db.collection(COLLECTIONS.CAMPAIGN_IMPRESSION_DEDUP).createIndexes([
      { key: { campaign_id: 1, anonymous_session_id: 1 }, unique: true, name: 'uniq_campaign_session' },
      { key: { expires_at: 1 }, expireAfterSeconds: 0, name: 'ttl_expires_at' },
    ]),
    db.collection(COLLECTIONS.CAMPAIGN_DAILY_METRICS).createIndexes([
      { key: { campaign_id: 1, date: 1, placement: 1 }, unique: true, name: 'uniq_campaign_date_placement' },
      { key: { campaign_id: 1, date: 1 }, name: 'campaign_date' },
      { key: { date: -1 }, name: 'by_date' },
    ]),
    // ---------- M06.0 Payments / Campaign Funding ----------
    db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      // Partial-filter unique so multiple in-flight rows can coexist with provider_order_id=null.
      { key: { provider_order_id: 1 }, unique: true, name: 'uniq_provider_order', partialFilterExpression: { provider_order_id: { $type: 'string' } } },
      { key: { campaign_id: 1, created_at: -1 }, name: 'by_campaign' },
      { key: { owner_user_id: 1, status: 1 }, name: 'by_owner_status' },
    ]),
    db.collection(COLLECTIONS.CAMPAIGN_FUNDING_LEDGER).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { campaign_id: 1, created_at: 1 }, name: 'by_campaign_time' },
      { key: { funding_id: 1, entry_type: 1 }, name: 'by_funding_type' },
      { key: { idempotency_key: 1 }, unique: true, sparse: true, name: 'uniq_idempotency' },
    ]),
    db.collection(COLLECTIONS.PAYMENT_WEBHOOK_EVENTS).createIndexes([
      { key: { provider_event_id: 1 }, unique: true, name: 'uniq_event' },
      { key: { received_at: -1 }, name: 'received' },
    ]),
    db.collection(COLLECTIONS.LEDGER_TRANSACTIONS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { idempotency_key: 1 }, unique: true, name: 'uniq_idempotency_key' },
      { key: { campaign_id: 1, created_at: 1 }, name: 'by_campaign_time' },
      { key: { transaction_type: 1 }, name: 'by_type' },
    ]),
    db.collection(COLLECTIONS.SPONSORED_IMPRESSION_DEDUP).createIndexes([
      { key: { impression_event_id: 1 }, unique: true, name: 'uniq_impression_event' },
      // TTL: cleanup 7d after last write to keep the collection small.
      { key: { created_at: 1 }, expireAfterSeconds: 604_800, name: 'ttl_created_at' },
    ]),
    db.collection(COLLECTIONS.PAYMENT_REFUNDS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { funding_order_id: 1, status: 1 }, name: 'by_funding' },
      { key: { campaign_id: 1, created_at: -1 }, name: 'by_campaign_time' },
      { key: { owner_user_id: 1, created_at: -1 }, name: 'by_owner_time' },
      { key: { provider_refund_id: 1 }, unique: true, name: 'uniq_provider_refund', partialFilterExpression: { provider_refund_id: { $type: 'string' } } },
    ]),
    // M07-security PayPal-activation patch — exactly one settings row per provider.
    db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).createIndexes([
      { key: { provider: 1 }, unique: true, name: 'uniq_provider' },
    ]),
    // Pricing conversion — commercial leads
    db.collection(COLLECTIONS.COMMERCIAL_LEADS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      // Prevent obvious duplicates: one active lead per (type, email).
      // We DO NOT include status in the key so a Won/Lost lead does not permit
      // silent duplicate re-submission; admins can archive if needed.
      { key: { type: 1, email: 1 }, unique: true, name: 'uniq_type_email' },
      { key: { status: 1, created_at: -1 }, name: 'by_status_time' },
      { key: { type: 1, created_at: -1 }, name: 'by_type_time' },
    ]),
    // Phase B1 — marketplace
    db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).createIndexes([
      { key: { channel_id: 1 }, unique: true, name: 'uniq_channel' },
      { key: { owner_user_id: 1 }, name: 'by_owner' },
    ]),
    db.collection(COLLECTIONS.MARKETPLACE_ORDERS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { channel_id: 1, created_at: -1 }, name: 'by_channel_time' },
      { key: { owner_user_id: 1, status: 1, created_at: -1 }, name: 'by_owner_status_time' },
      { key: { buyer_user_id: 1, created_at: -1 }, name: 'by_buyer_time' },
      { key: { status: 1, created_at: -1 }, name: 'by_status_time' },
      { key: { payment_reference_normalized: 1 }, name: 'by_payment_ref', partialFilterExpression: { payment_reference_normalized: { $type: 'string' } } },
      // B1.1.2 — cross-order payment identity uniqueness. A single real-world
      // payment (method + normalized reference) may fund at most one order.
      { key: { payment_method: 1, payment_reference_normalized: 1 }, unique: true, name: 'uniq_payment_identity', partialFilterExpression: { payment_method: { $type: 'string' }, payment_reference_normalized: { $type: 'string' } } },
    ]),
    db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).createIndexes([
      { key: { id: 1 }, unique: true, name: 'uniq_id' },
      { key: { order_id: 1, created_at: -1 }, name: 'by_order_time' },
      // Idempotency: (order_id, event_type, payment_reference_normalized) unique
      // when both event_type=PAYMENT_CONFIRMED AND payment_reference is set.
      { key: { order_id: 1, event_type: 1, payment_reference_normalized: 1 }, unique: true, name: 'uniq_payment_confirm', partialFilterExpression: { event_type: 'PAYMENT_CONFIRMED', payment_reference_normalized: { $type: 'string' } } },
    ]),
  ]);
}
