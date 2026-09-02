// M11-Batch2A \u2014 Follower Evidence service.
//
// Product invariants enforced here:
//   \u2022 Only the AUTHORIZED channel owner may submit or replace evidence.
//   \u2022 At most ONE active pending submission per channel (also DB-enforced
//     by the partial-unique index).
//   \u2022 Append-only history \u2014 verified / rejected rows are IMMUTABLE.
//     Replacing a pending submission transitions the previous row to
//     'superseded' and links it via superseded_by_snapshot_id.
//   \u2022 Public reads always use the latest 'verified' row \u2014 never pending,
//     rejected, or superseded.
//   \u2022 rejection_reason is shown to owners; review_note is admin-internal.
//   \u2022 Do NOT use WhatsApp scraping. Do NOT auto-verify.
import { v4 as uuidv4 } from 'uuid';
import { channelRepo } from '../repositories/channelRepo';
import { audienceSnapshotRepo } from '../repositories/audienceSnapshotRepo';
import { auditRepo } from '../repositories/genericRepo';
import { requireAuth, requireRole, ROLES, HttpError } from '../auth/rbac';
import { submitSnapshotSchema, rejectSnapshotSchema, verifySnapshotSchema } from '../validation/audienceSnapshotSchema';
import type { Actor, ChannelAudienceSnapshot, PublicUser, Role } from '@/lib/types';
import { hasAtLeastRole } from '../auth/rbac';

function isModerator(user: PublicUser | null | undefined): boolean {
  return hasAtLeastRole(user, ROLES.MODERATOR as Role);
}

async function requireOwnedChannel(actor: Actor | null, channelId: string) {
  requireAuth(actor);
  const channel = await channelRepo.findById(channelId);
  if (!channel) throw new HttpError(404, 'Channel not found');
  const isOwner = channel.owner_id && channel.owner_id === actor!.user.id;
  const modOverride = isModerator(actor!.user);
  if (!isOwner && !modOverride) throw new HttpError(403, 'Only the verified channel owner can manage follower evidence for this channel');
  return channel;
}

// Public view shape returned to owners \u2014 excludes admin-internal review_note.
function toOwnerView(s: ChannelAudienceSnapshot) {
  return {
    id: s.id,
    channel_id: s.channel_id,
    followers: s.followers,
    source: s.source,
    evidence_attachment: s.evidence_attachment,
    evidence_date: s.evidence_date,
    reported_at: s.reported_at,
    reported_by_user_id: s.reported_by_user_id,
    submission_note: s.submission_note,
    status: s.status,
    reviewed_at: s.reviewed_at,
    verified_at: s.verified_at,
    rejection_reason: s.rejection_reason,
    superseded_by_snapshot_id: s.superseded_by_snapshot_id,
    created_at: s.created_at,
  };
}

// Admin view includes review_note.
function toAdminView(s: ChannelAudienceSnapshot) {
  return { ...toOwnerView(s), review_note: s.review_note, verified_by_user_id: s.verified_by_user_id };
}

export const audienceSnapshotService = {
  // ---------- OWNER ----------
  async submit(actor: Actor | null, channelId: string, body: unknown) {
    const channel = await requireOwnedChannel(actor, channelId);
    const parsed = submitSnapshotSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));

    const now = new Date();
    const newSnapshotId = uuidv4();

    // Replace any existing pending submission for this channel (append-only:
    // mark it superseded and link it to the new pending row).
    const existingPending = await audienceSnapshotRepo.findActivePendingForChannel(channelId);
    if (existingPending) {
      const superseded = await audienceSnapshotRepo.markSuperseded(existingPending.id, newSnapshotId);
      if (!superseded) {
        // Race condition \u2014 someone else transitioned it before us.
        // Refuse rather than double-supersede an already-terminal row.
        throw new HttpError(409, 'Your prior submission was just reviewed \u2014 please refresh and start again.');
      }
    }

    const doc: ChannelAudienceSnapshot = {
      id: newSnapshotId,
      channel_id: channel.id,
      followers: parsed.data.followers,
      source: 'owner_evidence',
      evidence_attachment: parsed.data.evidence_attachment,
      evidence_date: parsed.data.evidence_date ? new Date(parsed.data.evidence_date) : null,
      reported_at: now,
      reported_by_user_id: actor!.user.id,
      submission_note: (parsed.data.submission_note ?? null) || null,
      status: 'pending',
      reviewed_at: null,
      verified_at: null,
      verified_by_user_id: null,
      rejection_reason: null,
      review_note: null,
      superseded_by_snapshot_id: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await audienceSnapshotRepo.insert(doc);
    } catch (e) {
      const msg = (e as { message?: string })?.message || '';
      if (msg.includes('E11000') || msg.includes('duplicate key')) {
        throw new HttpError(409, 'Another pending submission already exists for this channel. Refresh to see the latest state.');
      }
      throw e;
    }
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'AUDIENCE_SNAPSHOT_SUBMITTED',
      entity_type: 'channel_audience_snapshot',
      entity_id: doc.id,
      before_data: existingPending ? { superseded_snapshot_id: existingPending.id } : {},
      after_data: { channel_id: channel.id, followers: doc.followers, status: 'pending' },
      created_at: now,
    });
    return { snapshot: toOwnerView(doc) };
  },

  async listMine(actor: Actor | null, channelId: string) {
    await requireOwnedChannel(actor, channelId);
    const items = await audienceSnapshotRepo.listForChannel(channelId, 50);
    return { items: items.map(toOwnerView) };
  },

  // ---------- ADMIN ----------
  async adminListPending(actor: Actor | null) {
    requireRole(actor, ROLES.MODERATOR);
    const items = await audienceSnapshotRepo.listByStatus('pending', 200);
    // Enrich with channel name/slug so the admin queue is scannable.
    const byChannel = new Map<string, { name: string; slug: string; owner_id: string | null }>();
    for (const s of items) {
      if (!byChannel.has(s.channel_id)) {
        const ch = await channelRepo.findById(s.channel_id);
        if (ch) byChannel.set(s.channel_id, { name: ch.name, slug: ch.slug, owner_id: ch.owner_id });
      }
    }
    return {
      items: items.map((s) => ({
        ...toAdminView(s),
        channel: byChannel.get(s.channel_id) || null,
      })),
    };
  },

  async adminGetById(actor: Actor | null, id: string) {
    requireRole(actor, ROLES.MODERATOR);
    const s = await audienceSnapshotRepo.findById(id);
    if (!s) throw new HttpError(404, 'Snapshot not found');
    const ch = await channelRepo.findById(s.channel_id);
    return { snapshot: toAdminView(s), channel: ch ? { id: ch.id, name: ch.name, slug: ch.slug, owner_id: ch.owner_id } : null };
  },

  async adminVerify(actor: Actor | null, id: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = verifySnapshotSchema.safeParse(body ?? {});
    if (!parsed.success) throw new HttpError(400, 'Invalid review payload');
    const s = await audienceSnapshotRepo.findById(id);
    if (!s) throw new HttpError(404, 'Snapshot not found');
    if (s.status !== 'pending') throw new HttpError(409, `Cannot verify a ${s.status} snapshot`);

    const now = new Date();
    await audienceSnapshotRepo.update(id, {
      status: 'verified',
      reviewed_at: now,
      verified_at: now,
      verified_by_user_id: actor!.user.id,
      rejection_reason: null,
      review_note: (parsed.data.review_note ?? null) || null,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'AUDIENCE_SNAPSHOT_VERIFIED',
      entity_type: 'channel_audience_snapshot',
      entity_id: id,
      before_data: { status: 'pending' },
      after_data: { status: 'verified', followers: s.followers },
      created_at: now,
    });
    return { ok: true };
  },

  async adminReject(actor: Actor | null, id: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = rejectSnapshotSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const s = await audienceSnapshotRepo.findById(id);
    if (!s) throw new HttpError(404, 'Snapshot not found');
    if (s.status !== 'pending') throw new HttpError(409, `Cannot reject a ${s.status} snapshot`);

    const now = new Date();
    await audienceSnapshotRepo.update(id, {
      status: 'rejected',
      reviewed_at: now,
      rejection_reason: parsed.data.rejection_reason,
      review_note: (parsed.data.review_note ?? null) || null,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'AUDIENCE_SNAPSHOT_REJECTED',
      entity_type: 'channel_audience_snapshot',
      entity_id: id,
      before_data: { status: 'pending' },
      after_data: { status: 'rejected', rejection_reason: parsed.data.rejection_reason },
      created_at: now,
    });
    return { ok: true };
  },

  // ---------- PUBLIC-SAFE READ (used by channel profile SSR) ----------
  async getLatestVerifiedForChannel(channelId: string): Promise<ChannelAudienceSnapshot | null> {
    return audienceSnapshotRepo.findLatestVerifiedForChannel(channelId);
  },
};
