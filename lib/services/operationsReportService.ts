// P0C — OPERATIONS REPORTING (read-only).
//
//   recentSubmissions — ADMIN+ only. Who submitted recent listings, who is
//     linked as owner, provenance and review state. Never public; never
//     reclassifies, releases or writes anything.
//   sourcingScoreboard — MODERATOR+ (agent identity shown to ADMIN+ only by
//     the page). Per Asia/Jakarta day and sourcing account, computed from
//     real channel / claim rows. Duplicate attempts are NOT persisted
//     anywhere, so they are reported as `null` ("Not tracked").
//   inventorySplit — MODERATOR+. Public inventory split by provenance plus
//     verified owners and sponsorship-ready channels.
//
// Nothing here is a creator-acquisition or traction figure.
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { requireRole, ROLES } from '../auth/rbac';
import { buildPublicChannelMongoFilter } from './publicChannelVisibility';
import { SOURCING_REPORT_TIMEZONE } from './sourcingAgentService';
import { isActivationBadgeSatisfied } from '../utils/sanitize';
import type { Actor, Channel, ChannelClaim, User } from '@/lib/types';

export const DAILY_SOURCING_TARGET = 100;
const VERIFIED = ['verified', 'official'];
const ACTIVE_CLAIM = ['pending', 'needs_information'];
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is UTC+7, no DST.

/** `YYYY-MM-DD` calendar day of `d` in Asia/Jakarta. */
export function jakartaDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SOURCING_REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** UTC instant of 00:00 Asia/Jakarta, `daysBack` Jakarta days before `now`'s Jakarta day. */
export function jakartaDayStart(now: Date, daysBack = 0): Date {
  const [y, m, d] = jakartaDay(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysBack) - JAKARTA_OFFSET_MS);
}

function isVerifiedOwned(c: Pick<Channel, 'owner_id' | 'verification_status'>): boolean {
  return !!c.owner_id && VERIFIED.includes(String(c.verification_status));
}

type UserLite = { id: string; email: string; display_name: string; role: string; is_sourcing_agent: boolean };

async function usersById(ids: (string | null | undefined)[]): Promise<Map<string, UserLite>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (uniq.length === 0) return new Map();
  const rows = await (await getCollection<User>(COLLECTIONS.USERS))
    .find({ id: { $in: uniq } } as never, { projection: { _id: 0, id: 1, email: 1, display_name: 1, role: 1, is_sourcing_agent: 1 } } as never)
    .toArray();
  return new Map(rows.map((u) => [u.id, {
    id: u.id, email: u.email, display_name: u.display_name, role: String(u.role), is_sourcing_agent: u.is_sourcing_agent === true,
  }]));
}

async function publicIdSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await (await getCollection<Channel>(COLLECTIONS.CHANNELS))
    .find(buildPublicChannelMongoFilter({ status: 'approved', id: { $in: ids } } as never) as never, { projection: { id: 1 } } as never)
    .toArray();
  return new Set(rows.map((r) => r.id));
}

export type ClaimEligibility =
  | 'verified_owner'
  | 'claimable'
  | 'linked_to_account_unverified'
  | 'listing_not_public';

export interface RecentSubmissionRow {
  channel_id: string;
  slug: string;
  name: string;
  whatsapp_channel_id: string | null;
  status: string;
  is_public: boolean;
  created_at: Date;
  published_at: Date | null;
  source: string | null;
  submitter: UserLite | null;
  linked_owner: UserLite | null;
  sourced_by: UserLite | null;
  sourced_at: Date | null;
  submitter_is_linked_owner: boolean;
  verification_status: string;
  claim_eligibility: ClaimEligibility;
  active_claims: number;
}

export const operationsReportService = {
  async recentSubmissions(
    actor: Actor | null,
    opts: { days?: number; limit?: number; skip?: number } = {},
  ): Promise<{ items: RecentSubmissionRow[]; total: number; since: Date; limit: number; skip: number }> {
    requireRole(actor, ROLES.ADMIN);
    const days = Math.min(Math.max(Math.trunc(opts.days ?? 7) || 7, 1), 60);
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 60) || 60, 1), 200);
    const skip = Math.max(Math.trunc(opts.skip ?? 0) || 0, 0);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    // Real listings only — QA / demo fixtures are never part of the report.
    const filter = { created_at: { $gte: since }, is_test_fixture: { $ne: true }, is_demo: { $ne: true } } as never;
    const total = await channels.countDocuments(filter);
    const rows = await channels.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).toArray();
    const ids = rows.map((r) => r.id);
    const pub = await publicIdSet(ids);
    const people = await usersById(rows.flatMap((r) => [r.submitted_by, r.owner_id, r.sourced_by_user_id]));
    const claimCounts = new Map<string, number>();
    if (ids.length) {
      const agg = await (await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS)).aggregate<{ _id: string; n: number }>([
        { $match: { channel_id: { $in: ids }, status: { $in: ACTIVE_CLAIM } } },
        { $group: { _id: '$channel_id', n: { $sum: 1 } } },
      ]).toArray();
      agg.forEach((a) => claimCounts.set(a._id, a.n));
    }

    const items: RecentSubmissionRow[] = rows.map((r) => {
      const isPublic = pub.has(r.id);
      const eligibility: ClaimEligibility = !isPublic ? 'listing_not_public'
        : isVerifiedOwned(r) ? 'verified_owner'
          : r.owner_id ? 'linked_to_account_unverified' : 'claimable';
      return {
        channel_id: r.id,
        slug: r.slug,
        name: r.name,
        whatsapp_channel_id: r.whatsapp_channel_id ?? null,
        status: String(r.status),
        is_public: isPublic,
        created_at: r.created_at,
        published_at: r.published_at ?? null,
        source: r.source ?? null,
        submitter: r.submitted_by ? people.get(r.submitted_by) ?? null : null,
        linked_owner: r.owner_id ? people.get(r.owner_id) ?? null : null,
        sourced_by: r.sourced_by_user_id ? people.get(r.sourced_by_user_id) ?? null : null,
        sourced_at: r.sourced_at ?? null,
        submitter_is_linked_owner: !!r.owner_id && r.submitted_by === r.owner_id,
        verification_status: String(r.verification_status),
        claim_eligibility: eligibility,
        active_claims: claimCounts.get(r.id) ?? 0,
      };
    });
    return { items, total, since, limit, skip };
  },

  async sourcingScoreboard(actor: Actor | null, days = 7) {
    requireRole(actor, ROLES.MODERATOR);
    const windowDays = Math.min(Math.max(Math.trunc(days) || 7, 1), 31);
    const now = new Date();
    const since = jakartaDayStart(now, windowDays - 1);

    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const rows = await channels.find({
      source: 'staff_sourced',
      sourced_by_user_id: { $nin: [null, ''] },
      sourced_at: { $gte: since },
      is_test_fixture: { $ne: true },
      is_demo: { $ne: true },
    } as never, {
      projection: { _id: 0, id: 1, status: 1, owner_id: 1, verification_status: 1, sourced_by_user_id: 1, sourced_at: 1 },
    } as never).toArray();

    const ids = rows.map((r) => r.id);
    const pub = await publicIdSet(ids);
    const claimsByChannel = new Map<string, number>();
    if (ids.length) {
      const agg = await (await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS)).aggregate<{ _id: string; n: number }>([
        { $match: { channel_id: { $in: ids }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$channel_id', n: { $sum: 1 } } },
      ]).toArray();
      agg.forEach((a) => claimsByChannel.set(a._id, a.n));
    }
    const people = await usersById(rows.map((r) => r.sourced_by_user_id));

    type Row = {
      day: string; user_id: string; display_name: string;
      submitted: number; accepted_unique: number; approved_public: number; pending_moderation: number;
      rejected: number; ownership_claims: number; claimed_by_owner: number; verified_conversions: number;
      duplicate_attempts: null; target: number; progress_pct: number;
    };
    const map = new Map<string, Row>();
    for (const r of rows) {
      const day = jakartaDay(new Date(r.sourced_at as Date));
      const uid = String(r.sourced_by_user_id);
      const key = `${day}|${uid}`;
      let row = map.get(key);
      if (!row) {
        row = {
          day, user_id: uid, display_name: people.get(uid)?.display_name || 'Unknown',
          submitted: 0, accepted_unique: 0, approved_public: 0, pending_moderation: 0, rejected: 0,
          ownership_claims: 0, claimed_by_owner: 0, verified_conversions: 0,
          duplicate_attempts: null, target: DAILY_SOURCING_TARGET, progress_pct: 0,
        };
        map.set(key, row);
      }
      row.submitted += 1;
      if (r.status !== 'rejected') row.accepted_unique += 1;
      if (pub.has(r.id)) row.approved_public += 1;
      if (r.status === 'pending_review') row.pending_moderation += 1;
      if (r.status === 'rejected') row.rejected += 1;
      row.ownership_claims += claimsByChannel.get(r.id) ?? 0;
      // A real owner linked to a staff-sourced listing only via claim approval.
      if (r.owner_id && r.owner_id !== r.sourced_by_user_id) row.claimed_by_owner += 1;
      if (isVerifiedOwned(r) && r.owner_id !== r.sourced_by_user_id) row.verified_conversions += 1;
    }
    const items = Array.from(map.values())
      .map((r) => ({ ...r, progress_pct: Math.round((r.accepted_unique / DAILY_SOURCING_TARGET) * 100) }))
      .sort((a, b) => (a.day === b.day ? b.submitted - a.submitted : a.day < b.day ? 1 : -1));

    // Day totals across all agents (the 100/day target is a team target).
    const totals = new Map<string, { day: string; submitted: number; accepted_unique: number; approved_public: number }>();
    for (const r of items) {
      const t = totals.get(r.day) || { day: r.day, submitted: 0, accepted_unique: 0, approved_public: 0 };
      t.submitted += r.submitted; t.accepted_unique += r.accepted_unique; t.approved_public += r.approved_public;
      totals.set(r.day, t);
    }
    return {
      timezone: SOURCING_REPORT_TIMEZONE,
      today: jakartaDay(now),
      since,
      target_per_day: DAILY_SOURCING_TARGET,
      duplicate_attempts_tracked: false,
      items,
      day_totals: Array.from(totals.values()).map((t) => ({
        ...t, progress_pct: Math.round((t.accepted_unique / DAILY_SOURCING_TARGET) * 100),
      })),
    };
  },

  async inventorySplit(actor: Actor | null) {
    requireRole(actor, ROLES.MODERATOR);
    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const pubFilter = (extra: Record<string, unknown>) =>
      buildPublicChannelMongoFilter({ status: 'approved', ...extra } as never) as never;

    const staffSourced = await channels.countDocuments(pubFilter({ source: 'staff_sourced' }));
    const ownerSubmitted = await channels.countDocuments(pubFilter({ source: 'owner_self' }));
    const legacyNoSource = await channels.countDocuments(pubFilter({ source: { $nin: ['staff_sourced', 'owner_self'] } }));
    const staffSourcedVerifiedByOwner = await channels.countDocuments(pubFilter({
      source: 'staff_sourced', owner_id: { $nin: [null, ''] }, verification_status: { $in: VERIFIED },
    }));

    // Sponsorship-ready = verified ownership + activation satisfied + at least
    // one active rate-card package (published by the current owner) + an
    // active, VERIFIED payout method for that owner.
    const verified = await channels.find(pubFilter({
      owner_id: { $nin: [null, ''] }, verification_status: { $in: VERIFIED },
    }), { projection: { _id: 0, id: 1, owner_id: 1, activation_status: 1 } } as never).limit(5000).toArray();
    let sponsorshipReady = 0;
    if (verified.length) {
      const cards = await (await getCollection<{ channel_id: string; owner_user_id: string; packages?: { is_active?: boolean }[] }>(COLLECTIONS.CHANNEL_RATE_CARDS))
        .find({ channel_id: { $in: verified.map((v) => v.id) } } as never).toArray();
      const cardOk = new Set(cards
        .filter((c) => Array.isArray(c.packages) && c.packages.some((p) => p?.is_active === true))
        .map((c) => `${c.channel_id}|${c.owner_user_id}`));
      const owners = Array.from(new Set(verified.map((v) => String(v.owner_id))));
      const payouts = await (await getCollection<{ owner_user_id: string }>(COLLECTIONS.OWNER_PAYOUT_METHODS))
        .find({ owner_user_id: { $in: owners }, is_active: true, verified_at: { $ne: null } } as never,
          { projection: { owner_user_id: 1 } } as never).toArray();
      const payoutOk = new Set(payouts.map((p) => p.owner_user_id));
      for (const v of verified) {
        if (isActivationBadgeSatisfied(v) && cardOk.has(`${v.id}|${v.owner_id}`) && payoutOk.has(String(v.owner_id))) {
          sponsorshipReady += 1;
        }
      }
    }
    return {
      staff_sourced_public: staffSourced,
      owner_submitted_public: ownerSubmitted,
      legacy_no_source_public: legacyNoSource,
      staff_sourced_claimed_verified: staffSourcedVerifiedByOwner,
      verified_owners: verified.length,
      sponsorship_ready: sponsorshipReady,
    };
  },
};

