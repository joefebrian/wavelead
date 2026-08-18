import { v4 as uuidv4 } from 'uuid';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { channelRepo } from '../repositories/channelRepo';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import { slotSchema } from '../validation/submissionSchema';
import { sanitizeChannel } from '../utils/sanitize';
import type { Actor, Channel, PublicChannel } from '@/lib/types';

interface Slot {
  id: string;
  section: 'popular' | 'new_noteworthy' | 'featured';
  channel_id: string;
  priority: number;
  active: boolean;
  start_at: Date | null;
  end_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

async function coll() { return getCollection<Slot>(COLLECTIONS.HOMEPAGE_SLOTS); }

const sanitize = sanitizeChannel;

export const curationService = {
  async listAll(actor: Actor | null) {
    requireRole(actor, ROLES.MODERATOR);
    const c = await coll();
    const rows = stripIds(await c.find({}).sort({ section: 1, priority: 1 }).toArray()) as Slot[];
    const channelIds = Array.from(new Set(rows.map((r) => r.channel_id)));
    const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const channels = stripIds(await channelsColl.find({ id: { $in: channelIds } }).toArray()) as Channel[];
    const byId = new Map(channels.map((c) => [c.id, c]));
    return rows.map((s) => ({ ...s, channel: byId.get(s.channel_id) ? sanitize(byId.get(s.channel_id)!) : null }));
  },

  async addSlot(actor: Actor | null, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = slotSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const ch = await channelRepo.findById(parsed.data.channel_id);
    if (!ch) throw new HttpError(404, 'Channel not found');
    if (ch.status !== 'approved') throw new HttpError(400, 'Only approved channels can be curated');

    const c = await coll();
    // Prevent duplicate slot for same section+channel.
    const dup = await c.findOne({ section: parsed.data.section, channel_id: parsed.data.channel_id });
    if (dup) throw new HttpError(409, 'Channel is already curated in this section');

    const now = new Date();
    const slot: Slot = {
      id: uuidv4(),
      section: parsed.data.section,
      channel_id: parsed.data.channel_id,
      priority: parsed.data.priority ?? 100,
      active: true,
      start_at: null,
      end_at: null,
      created_by: actor!.user.id,
      created_at: now,
      updated_at: now,
    };
    await c.insertOne(slot);
    return stripId(slot);
  },

  async removeSlot(actor: Actor | null, id: string) {
    requireRole(actor, ROLES.MODERATOR);
    const c = await coll();
    const res = await c.deleteOne({ id });
    if (res.deletedCount === 0) throw new HttpError(404, 'Slot not found');
    return { ok: true };
  },

  async updateSlot(actor: Actor | null, id: string, patch: { priority?: number; active?: boolean }) {
    requireRole(actor, ROLES.MODERATOR);
    const c = await coll();
    const update: Record<string, unknown> = { updated_at: new Date() };
    if (typeof patch.priority === 'number') update.priority = patch.priority;
    if (typeof patch.active === 'boolean') update.active = patch.active;
    const res = await c.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new HttpError(404, 'Slot not found');
    return { ok: true };
  },

  // Public: fetch curated (active only, approved channel only). Used by the
  // homepage bundle with fallback ranking.
  async getSectionCurated(section: Slot['section']): Promise<PublicChannel[]> {
    const c = await coll();
    const rows = stripIds(await c.find({ section, active: true }).sort({ priority: 1 }).toArray()) as Slot[];
    if (rows.length === 0) return [];
    const channelIds = rows.map((r) => r.channel_id);
    const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const channels = stripIds(await channelsColl.find({ id: { $in: channelIds }, status: 'approved' }).toArray()) as Channel[];
    const byId = new Map(channels.map((c) => [c.id, c]));
    return rows.map((r) => byId.get(r.channel_id)).filter(Boolean).map((c) => sanitize(c as Channel));
  },
};
