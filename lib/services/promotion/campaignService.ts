// M05.1 campaign lifecycle service. All authorization is server-side.
// Only owners of an approved + verified/official channel may create a promotion
// for their own channel. Sensitive fields cannot be mutated after approval.
import { v4 as uuidv4 } from 'uuid';
import { promotionCampaignRepo, promotionRateCardRepo } from '@/lib/repositories/promotionRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { HttpError, ROLES, rankOf } from '@/lib/auth/rbac';
import type {
  Actor,
  PromotionCampaign,
  PromotionRateSnapshotItem,
  PromotionCampaignStatus,
  PromotionRejectionReason,
  SponsoredPlacement,
} from '@/lib/types';
import { promotionCreateSchema, promotionPatchSchema, rejectSchema } from '@/lib/validation/promotion';
import { reconcileCampaign, recordAudit } from './campaignStateService';

function assertOwnerOf(actor: Actor | null, campaign: PromotionCampaign, minRole: 'owner' | 'admin' = 'owner'): void {
  if (!actor) throw new HttpError(401, 'Authentication required');
  const isOwner = campaign.owner_user_id === actor.user.id;
  const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);
  if (minRole === 'admin' && !isAdmin) throw new HttpError(403, 'Admin access required');
  if (minRole === 'owner' && !isOwner && !isAdmin) throw new HttpError(403, 'Not your campaign');
}

async function ensureChannelEligibleForOwner(actor: Actor, channel_id: string) {
  const ch = await channelRepo.findById(channel_id);
  if (!ch) throw new HttpError(404, 'Channel not found');
  if (ch.owner_id !== actor.user.id) throw new HttpError(403, 'You do not own this channel');
  if (ch.status !== 'approved') throw new HttpError(400, 'Channel must be approved to promote');
  const vs = (ch as unknown as { verification_status?: string }).verification_status;
  if (vs !== 'verified' && vs !== 'official') {
    throw new HttpError(400, 'Only verified or official channels can be promoted');
  }
  return ch;
}

async function resolveRateSnapshot(placements: SponsoredPlacement[], country_code: string | null): Promise<PromotionRateSnapshotItem[]> {
  const out: PromotionRateSnapshotItem[] = [];
  const now = new Date();
  for (const p of placements) {
    const card = await promotionRateCardRepo.resolve(p, country_code);
    if (!card) throw new HttpError(400, `No active rate card for placement ${p}`);
    out.push({
      placement: p,
      pricing_model: 'cpm',
      cpm_usd_minor: card.cpm_usd_minor,
      rate_card_id: card.id,
      country_code: card.country_code,
      resolved_at: now,
    });
  }
  return out;
}

export const promotionCampaignService = {
  async create(actor: Actor | null, raw: unknown): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const parsed = promotionCreateSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid campaign payload');
    const input = parsed.data;
    const channel = await ensureChannelEligibleForOwner(actor, input.channel_id);
    const now = new Date();
    const camp: PromotionCampaign = {
      id: uuidv4(),
      owner_user_id: actor.user.id,
      channel_id: channel.id,
      name: input.name || `Promote ${channel.name}`,
      objective: input.objective,
      placements: input.placements,
      targeting: {
        countries: input.targeting.countries.map((s) => s.toUpperCase()),
        languages: input.targeting.languages.map((s) => s.toLowerCase()),
        categories: input.targeting.categories.map((s) => s.toLowerCase()),
      },
      budget_total_usd_minor: input.budget_total_usd_minor,
      budget_daily_usd_minor: input.budget_daily_usd_minor ?? null,
      start_at: new Date(input.start_at),
      end_at: new Date(input.end_at),
      status: 'draft',
      rate_snapshot: null,
      delivered_impressions: 0,
      estimated_spend_usd_minor: 0,
      created_at: now,
      updated_at: now,
      submitted_at: null,
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
      rejection_notes: null,
      activated_at: null,
      paused_at: null,
      completed_at: null,
      cancelled_at: null,
    };
    await promotionCampaignRepo.insert(camp);
    await recordAudit(actor.user.id, 'PROMOTION_CREATED', camp.id, null, { channel_id: camp.channel_id });
    return camp;
  },

  async listForOwner(actor: Actor | null): Promise<PromotionCampaign[]> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    return promotionCampaignRepo.list({ owner_user_id: actor.user.id });
  },

  async getForOwner(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    return reconcileCampaign(camp);
  },

  async patch(actor: Actor | null, id: string, raw: unknown): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    if (!['draft', 'pending_review', 'rejected'].includes(camp.status)) {
      throw new HttpError(400, `Cannot edit campaign in status ${camp.status}. Pause first.`);
    }
    const parsed = promotionPatchSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid patch');
    const patch = parsed.data;
    const next: Partial<PromotionCampaign> = {};
    if (patch.name) next.name = patch.name;
    if (patch.objective) next.objective = patch.objective;
    if (patch.placements) next.placements = patch.placements;
    if (patch.targeting) next.targeting = {
      countries: patch.targeting.countries.map((s) => s.toUpperCase()),
      languages: patch.targeting.languages.map((s) => s.toLowerCase()),
      categories: patch.targeting.categories.map((s) => s.toLowerCase()),
    };
    if (patch.budget_total_usd_minor) next.budget_total_usd_minor = patch.budget_total_usd_minor;
    if (patch.budget_daily_usd_minor !== undefined) next.budget_daily_usd_minor = patch.budget_daily_usd_minor;
    if (patch.start_at) next.start_at = new Date(patch.start_at);
    if (patch.end_at) next.end_at = new Date(patch.end_at);
    if (next.start_at && next.end_at && next.end_at <= next.start_at) {
      throw new HttpError(400, 'end_at must be after start_at');
    }
    await promotionCampaignRepo.update(id, next);
    const updated = await promotionCampaignRepo.findById(id);
    return updated!;
  },

  async submit(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    if (!['draft', 'rejected'].includes(camp.status)) throw new HttpError(400, `Cannot submit from status ${camp.status}`);
    // Snapshot rates now; owner’s primary targeted country (or first) drives country-specific pricing.
    const targetCountry = camp.targeting.countries[0] || null;
    const rate_snapshot = await resolveRateSnapshot(camp.placements, targetCountry);
    const now = new Date();
    await promotionCampaignRepo.setStatus(id, 'pending_review', {
      rate_snapshot,
      submitted_at: now,
      rejection_reason: null,
      rejection_notes: null,
    });
    await recordAudit(actor.user.id, 'PROMOTION_SUBMITTED', id, { status: camp.status }, { status: 'pending_review' });
    return (await promotionCampaignRepo.findById(id))!;
  },

  async cancel(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    // M06.0 Phase 4: owners can cancel from any non-terminal state so they
    // can recover unused funds. Delivery stops immediately because the
    // atomicDeliverImpression gate filters on status='active'.
    const cancellable: PromotionCampaignStatus[] = ['draft', 'pending_review', 'approved', 'scheduled', 'active', 'paused', 'rejected'];
    if (!cancellable.includes(camp.status)) throw new HttpError(400, `Cannot cancel from ${camp.status}`);
    const now = new Date();
    await promotionCampaignRepo.setStatus(id, 'cancelled', { cancelled_at: now });
    await recordAudit(actor.user.id, 'PROMOTION_CANCELLED', id, { status: camp.status }, { status: 'cancelled' });
    // Auto-create pending refund request if there are unused funds. Owner
    // does NOT execute the provider refund — admin/super_admin must.
    try {
      const { refundService } = await import('@/lib/services/payments/refundService');
      await refundService.requestRefundForCancelledCampaign(actor, id);
    } catch { /* refund request creation is best-effort; admin can also open one */ }
    return (await promotionCampaignRepo.findById(id))!;
  },

  async pause(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    if (camp.status !== 'active') throw new HttpError(400, `Cannot pause from ${camp.status}`);
    const now = new Date();
    await promotionCampaignRepo.setStatus(id, 'paused', { paused_at: now });
    await recordAudit(actor.user.id, 'PROMOTION_PAUSED', id, { status: 'active' }, { status: 'paused' });
    return (await promotionCampaignRepo.findById(id))!;
  },

  async resume(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwnerOf(actor, camp);
    if (camp.status !== 'paused') throw new HttpError(400, `Cannot resume from ${camp.status}`);
    const now = new Date();
    // Compute next state based on time + budget.
    let nextStatus: PromotionCampaignStatus;
    if (camp.end_at <= now || camp.estimated_spend_usd_minor >= camp.budget_total_usd_minor) {
      nextStatus = 'completed';
    } else if (camp.start_at > now) {
      nextStatus = 'scheduled';
    } else {
      nextStatus = 'active';
    }
    await promotionCampaignRepo.setStatus(id, nextStatus, {
      paused_at: null,
      activated_at: nextStatus === 'active' ? (camp.activated_at ?? now) : camp.activated_at,
      completed_at: nextStatus === 'completed' ? now : camp.completed_at,
    });
    await recordAudit(actor.user.id, 'PROMOTION_RESUMED', id, { status: 'paused' }, { status: nextStatus });
    return (await promotionCampaignRepo.findById(id))!;
  },

  // ==================== Admin actions ====================
  async listForAdmin(actor: Actor | null, status?: PromotionCampaignStatus): Promise<PromotionCampaign[]> {
    if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin required');
    return promotionCampaignRepo.list(status ? { status } : {});
  },

  async getForAdmin(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    return reconcileCampaign(camp);
  },

  async approve(actor: Actor | null, id: string): Promise<PromotionCampaign> {
    if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin required');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    if (camp.status !== 'pending_review') throw new HttpError(400, `Cannot approve from ${camp.status}`);
    // Re-verify channel is still eligible.
    const ch = await channelRepo.findById(camp.channel_id);
    if (!ch || ch.status !== 'approved') throw new HttpError(400, 'Channel no longer eligible');
    const vs = (ch as unknown as { verification_status?: string }).verification_status;
    if (vs !== 'verified' && vs !== 'official') throw new HttpError(400, 'Channel is no longer verified');
    const now = new Date();
    let nextStatus: PromotionCampaignStatus;
    if (camp.end_at <= now) {
      // Already-expired campaign shouldn’t briefly activate.
      nextStatus = 'completed';
    } else if (camp.start_at <= now) {
      nextStatus = 'active';
    } else {
      nextStatus = 'scheduled';
    }
    await promotionCampaignRepo.setStatus(id, nextStatus, {
      reviewed_at: now,
      reviewed_by: actor.user.id,
      activated_at: nextStatus === 'active' ? now : null,
      completed_at: nextStatus === 'completed' ? now : null,
    });
    await recordAudit(actor.user.id, 'PROMOTION_APPROVED', id, { status: 'pending_review' }, { status: nextStatus });
    if (nextStatus === 'active') await recordAudit(actor.user.id, 'PROMOTION_ACTIVATED', id, null, { activated_at: now });
    return (await promotionCampaignRepo.findById(id))!;
  },

  async reject(actor: Actor | null, id: string, raw: unknown): Promise<PromotionCampaign> {
    if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin required');
    const parsed = rejectSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, 'Invalid rejection reason');
    const camp = await promotionCampaignRepo.findById(id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    if (camp.status !== 'pending_review') throw new HttpError(400, `Cannot reject from ${camp.status}`);
    const now = new Date();
    await promotionCampaignRepo.setStatus(id, 'rejected', {
      reviewed_at: now,
      reviewed_by: actor.user.id,
      rejection_reason: parsed.data.reason as PromotionRejectionReason,
      rejection_notes: parsed.data.notes ?? null,
    });
    await recordAudit(actor.user.id, 'PROMOTION_REJECTED', id, { status: 'pending_review' }, { reason: parsed.data.reason });
    return (await promotionCampaignRepo.findById(id))!;
  },
};
