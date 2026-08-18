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
  BOOKMARKS: 'bookmarks',
  REPORTS: 'reports',
  AUDIT_LOGS: 'audit_logs',
  HOMEPAGE_SLOTS: 'homepage_slots',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
