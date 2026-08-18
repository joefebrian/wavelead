import { v4 as uuidv4 } from 'uuid';
import { eventRepo } from '../repositories/genericRepo';
import type { EventRecord, EventType } from '@/lib/types';

const ALLOWED_SOURCES = new Set([
  'homepage','search','trending','top','category','country','related_channel','channel_profile','other',
]);

function normalizeSource(v: string | null | undefined): string {
  if (!v) return 'other';
  const s = v.toLowerCase().trim();
  return ALLOWED_SOURCES.has(s) ? s : 'other';
}

interface FollowClickInput {
  channelId: string;
  anonymousSessionId: string | null;
  userId: string | null;
  source?: string | null;
  referrer?: string | null;
  countryCode?: string | null;
  deviceType?: string | null;
  pagePath?: string | null;
}

export const trackingService = {
  // Fire-and-forget. Never let a persistence failure block the redirect.
  recordFollowClick(input: FollowClickInput): void {
    const rec: EventRecord = {
      id: uuidv4(),
      event_type: 'follow_click' as EventType,
      anonymous_session_id: input.anonymousSessionId,
      user_id: input.userId,
      channel_id: input.channelId,
      campaign_id: null,
      source: normalizeSource(input.source),
      referrer: input.referrer || null,
      page_path: input.pagePath || null,
      country_code: input.countryCode || null,
      device_type: input.deviceType || null,
      metadata: {},
      created_at: new Date(),
    };
    eventRepo.insert(rec).catch((err) => {
      console.error('[wavelead] follow_click persistence failed:', err);
    });
  },
};
