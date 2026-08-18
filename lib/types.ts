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

export type ClaimStatus = 'pending' | 'verified' | 'rejected' | 'cancelled';

export interface ChannelClaim {
  id: string;
  channel_id: string;
  user_id: string;
  verification_method: string;
  verification_data: Record<string, unknown>;
  status: ClaimStatus;
  admin_notes: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

export type EventType =
  | 'channel_impression'
  | 'channel_profile_view'
  | 'follow_click'
  | 'bookmark'
  | 'share'
  | 'search'
  | 'category_view'
  | 'submit_started'
  | 'submit_completed'
  | 'claim_started'
  | 'claim_completed';

export interface EventRecord {
  id: string;
  event_type: EventType;
  anonymous_session_id: string | null;
  user_id: string | null;
  channel_id: string | null;
  campaign_id: string | null;
  source: string | null;
  referrer: string | null;
  page_path: string | null;
  country_code: string | null;
  device_type: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface DailyMetric {
  id: string;
  channel_id: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  profile_views: number;
  follow_clicks: number;
  unique_follow_clicks: number;
  bookmarks: number;
  shares: number;
  search_impressions: number;
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
