// P0B — SOURCING AGENT (PIC) DESIGNATION.
//
// A sourcing agent is a staff member who adds public WhatsApp Channel
// listings to the WaveLead directory. Sourcing is DIRECTORY WORK, never an
// ownership right.
//
// Design rules (non-negotiable):
//   • The designation is a plain user ATTRIBUTE (`users.is_sourcing_agent`),
//     NOT an RBAC role and NOT an elevated permission. It grants nothing.
//     Its only effects are: submissions are attributed as `staff_sourced`
//     and keep `owner_id: null`, and the agent can never gain Fast
//     Verification eligibility from original-submitter status.
//   • Only admin+ may assign or clear it, and every change is audit-logged.
//   • It is NEVER inferred from display names, e-mail patterns or anything
//     the client sends.
//   • Clearing the designation NEVER rewrites historical attribution:
//     `sourced_by_user_id` / `sourced_at` stay on the channel so per-agent
//     reporting remains truthful.
//   • Existing listings are never reclassified or migrated by this service.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { userRepo } from '../repositories/userRepo';
import { auditRepo } from '../repositories/genericRepo';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import { buildPublicChannelMongoFilter } from './publicChannelVisibility';
import type { Actor, Channel, User } from '@/lib/types';

/** Operational reporting timezone for sourcing productivity (fixed, no DST). */
export const SOURCING_REPORT_TIMEZONE = 'Asia/Jakarta';

export interface SourcingAgentSummary {
  user_id: string;
  display_name: string;
  email: string;
  is_sourcing_agent: boolean;
  assigned_at: Date | null;
  assigned_by: string | null;
  /** Lifetime count of listings attributed to this agent. */
  total_sourced: number;
}

export interface DailySourcingCount {
  /** Calendar day in Asia/Jakarta, `YYYY-MM-DD`. */
  day: string;
  user_id: string;
  display_name: string;
  /** Unique channels sourced by this agent on this day. */
  unique_channels: number;
}

export const sourcingAgentService = {
  /**
   * Assign or clear the sourcing designation. Admin+ only. Idempotent.
   * Never changes the target user's role, plan or any permission.
   */
  async setDesignation(
    actor: Actor | null,
    targetUserId: string,
    enabled: boolean,
    reason: string,
  ): Promise<{ user_id: string; is_sourcing_agent: boolean; changed: boolean }> {
    requireRole(actor, ROLES.ADMIN);
    const admin = actor!;
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) {
      throw new HttpError(400, 'A reason of at least 5 characters is required for this change.');
    }
    const target = await userRepo.findById(targetUserId);
    if (!target) throw new HttpError(404, 'User not found');

    const before = target.is_sourcing_agent === true;
    if (before === enabled) {
      return { user_id: target.id, is_sourcing_agent: before, changed: false };
    }

    const now = new Date();
    const fields: Partial<User> = enabled
      ? { is_sourcing_agent: true, sourcing_agent_assigned_at: now, sourcing_agent_assigned_by: admin.user.id }
      : { is_sourcing_agent: false, sourcing_agent_assigned_at: null, sourcing_agent_assigned_by: admin.user.id };
    await userRepo.updateFields(target.id, { ...fields, updated_at: now } as Partial<User>);

    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: admin.user.id,
      action: enabled ? 'SOURCING_AGENT_DESIGNATED' : 'SOURCING_AGENT_REVOKED',
      entity_type: 'user',
      entity_id: target.id,
      before_data: { is_sourcing_agent: before },
      after_data: { is_sourcing_agent: enabled, reason: cleanReason },
      created_at: now,
    } as never);

    return { user_id: target.id, is_sourcing_agent: enabled, changed: true };
  },

  /** Read-only list of designated agents with lifetime attribution counts. */
  async listAgents(actor: Actor | null): Promise<SourcingAgentSummary[]> {
    requireRole(actor, ROLES.ADMIN);
    const users = await getCollection<User>(COLLECTIONS.USERS);
    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const agents = await users.find({ is_sourcing_agent: true } as never).limit(200).toArray();
    const out: SourcingAgentSummary[] = [];
    for (const a of agents) {
      const total = await channels.countDocuments({ sourced_by_user_id: a.id } as never);
      out.push({
        user_id: a.id,
        display_name: a.display_name,
        email: a.email,
        is_sourcing_agent: true,
        assigned_at: a.sourcing_agent_assigned_at ?? null,
        assigned_by: a.sourcing_agent_assigned_by ?? null,
        total_sourced: total,
      });
    }
    return out.sort((x, y) => y.total_sourced - x.total_sourced);
  },

  /**
   * Per-agent UNIQUE channels sourced per calendar day in Asia/Jakarta.
   * Counts real `channels` rows only (one row == one unique channel, the
   * canonical WhatsApp dedup guarantees no double-counting). Public-fixture
   * rows are excluded so QA data can never inflate productivity numbers.
   */
  async dailySourcingCounts(actor: Actor | null, days = 14): Promise<DailySourcingCount[]> {
    requireRole(actor, ROLES.MODERATOR);
    const windowDays = Math.min(Math.max(Math.trunc(days) || 14, 1), 90);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const rows = await channels.aggregate<{ _id: { day: string; user_id: string }; unique_channels: number }>([
      {
        $match: buildPublicChannelMongoFilter({
          source: 'staff_sourced',
          sourced_by_user_id: { $ne: null },
          sourced_at: { $gte: since },
        } as never) as never,
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$sourced_at', timezone: SOURCING_REPORT_TIMEZONE } },
            user_id: '$sourced_by_user_id',
          },
          unique_channels: { $addToSet: '$id' },
        },
      },
      { $project: { unique_channels: { $size: '$unique_channels' } } },
      { $sort: { '_id.day': -1 } },
      { $limit: 500 },
    ]).toArray();

    const users = await getCollection<User>(COLLECTIONS.USERS);
    const names = new Map<string, string>();
    for (const r of rows) {
      const uid = r._id.user_id;
      if (uid && !names.has(uid)) {
        const u = await users.findOne({ id: uid } as never);
        names.set(uid, u?.display_name || 'Unknown');
      }
    }
    return rows.map((r) => ({
      day: r._id.day,
      user_id: r._id.user_id,
      display_name: names.get(r._id.user_id) || 'Unknown',
      unique_channels: r.unique_channels,
    }));
  },

  /** Server-side check used by the submission path. Never trusts the client. */
  async isSourcingAgent(userId: string): Promise<boolean> {
    const u = await userRepo.findById(userId);
    return u?.is_sourcing_agent === true;
  },
};
