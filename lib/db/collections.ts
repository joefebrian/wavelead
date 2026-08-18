export const COLLECTIONS = {
  USERS: 'users',
  CHANNELS: 'channels',
  CATEGORIES: 'categories',
  CHANNEL_CATEGORIES: 'channel_categories',
  CHANNEL_CLAIMS: 'channel_claims',
  CHANNEL_CHANGE_REQUESTS: 'channel_change_requests',
  EVENTS: 'events',
  CHANNEL_DAILY_METRICS: 'channel_daily_metrics',
  CHANNEL_DAILY_SOURCE_METRICS: 'channel_daily_source_metrics',
  CHANNEL_SEARCH_QUERY_METRICS: 'channel_search_query_metrics',
  ROLLUP_STATE: 'analytics_rollup_state',
  ENRICHMENT_CACHE: 'enrichment_cache',
  BOOKMARKS: 'bookmarks',
  REPORTS: 'reports',
  AUDIT_LOGS: 'audit_logs',
  HOMEPAGE_SLOTS: 'homepage_slots',
  PROMOTION_CAMPAIGNS: 'promotion_campaigns',
  PROMOTION_RATE_CARDS: 'promotion_rate_cards',
  CAMPAIGN_IMPRESSION_DEDUP: 'campaign_impression_dedup',
  CAMPAIGN_DAILY_METRICS: 'campaign_daily_metrics',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
