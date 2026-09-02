// M11-Batch3 — Per-event metadata allowlist. Only these keys are stored
// (all other properties on the client-supplied payload are dropped).
import type { AnalyticsEventName } from '@/lib/types';

type AllowedKind = 'string' | 'number' | 'boolean';

export const EVENT_METADATA_ALLOWLIST: Record<AnalyticsEventName, Record<string, AllowedKind>> = {
  page_view: {},
  channel_profile_view: {
    channel_id: 'string',
    channel_slug: 'string',
    category_slug: 'string',
    country_code: 'string',
  },
  channel_search: {
    query_length: 'number',  // never store raw text
    result_count: 'number',
  },
  category_view: { category_slug: 'string' },
  country_view: { country_code: 'string' },
  follow_intent_click: {
    channel_id: 'string',
    channel_slug: 'string',
    source: 'string',
  },
  sponsor_channel_click: {
    channel_id: 'string',
    channel_slug: 'string',
    package_id: 'string',
  },
  sponsorship_package_view: {
    channel_id: 'string',
    channel_slug: 'string',
    package_id: 'string',
    package_type: 'string',
  },
  pricing_view: { plan_focus: 'string' },
  pro_waitlist_click: { plan_focus: 'string' },
  enterprise_contact_click: { plan_focus: 'string' },
  signup_started: {},
  signup_completed: {},
};

// Absolute max sizes so we never persist unbounded strings even if allowlisted.
export const META_STRING_MAX = 128;
export const PATHNAME_MAX = 512;
export const REFERRER_DOMAIN_MAX = 253;
export const UTM_MAX = 128;
