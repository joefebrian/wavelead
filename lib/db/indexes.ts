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
  ]);
}
