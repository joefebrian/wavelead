// M07-Lite Sponsorship Leads service.
//
// M15 update — direct brand ↔ channel-owner workflow:
//   • Owner of the target channel can view + Accept/Decline a lead directly.
//   • No admin approval step is required before the owner can see or act.
//   • Admin retains view/patch capability for oversight and abuse handling.
//   • WaveLead remains the platform of record; commercial/payment workflow
//     (Marketplace) is unchanged.
import { v4 as uuidv4 } from 'uuid';
import { channelService } from './channelService';
import { channelRepo } from '../repositories/channelRepo';
import { sponsorshipLeadRepo } from '../repositories/sponsorshipLeadRepo';
import { sponsorshipLeadCreateSchema, sponsorshipLeadPatchSchema } from '../validation/sponsorshipSchemas';
import { HttpError, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import type { Actor, SponsorshipLead, SponsorshipLeadStatus } from '@/lib/types';

const DUP_WINDOW_MS = 60 * 60 * 1000; // 1h — max 5 leads per email
const DUP_MAX = 5;

async function assertCanView(actor: Actor, lead: SponsorshipLead): Promise<'owner' | 'requester' | 'admin'> {
  if (hasAtLeastRole(actor.user, ROLES.MODERATOR)) return 'admin';
  if (lead.requester_user_id && lead.requester_user_id === actor.user.id) return 'requester';
  const channel = await channelRepo.findById(lead.channel_id);
  if (channel && channel.owner_id && channel.owner_id === actor.user.id) return 'owner';
  throw new HttpError(403, 'Not authorized to view this sponsorship request');
}

export const sponsorshipLeadService = {
  /**
   * Public creation — anyone (auth or not) can submit a sponsorship lead
   * against an APPROVED, publicly-visible channel. Server resolves the
   * channel from the slug; the client never supplies channel_id.
   */
  async create(actor: Actor | null, input: unknown): Promise<SponsorshipLead> {
    const parsed = sponsorshipLeadCreateSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new HttpError(400, `Invalid input: ${first?.path?.join('.') || 'field'} — ${first?.message || 'invalid'}`);
    }
    const data = parsed.data;
    // Resolve channel via public-visibility policy. Private/pending/rejected
    // channels cannot receive public sponsorship leads.
    const channel = await channelService.getPublicBySlug(data.channel_slug);
    if (!channel) throw new HttpError(404, 'Channel is not available for sponsorship');
    // Rate limit per work_email to avoid duplicate/spam floods.
    const recent = await sponsorshipLeadRepo.recentByEmailCount(data.work_email, DUP_WINDOW_MS);
    if (recent >= DUP_MAX) throw new HttpError(429, 'Too many sponsorship requests from this email. Please try again later.');
    const now = new Date();
    const lead: SponsorshipLead = {
      id: uuidv4(),
      channel_id: channel.id,
      channel_slug_snapshot: channel.slug,
      channel_name_snapshot: channel.name,
      requester_user_id: actor?.user.id ?? null,
      requester_role: actor?.user.role ?? null,
      company_name: data.company_name,
      contact_name: data.contact_name,
      work_email: data.work_email,
      objective: data.objective,
      budget_range: data.budget_range,
      target_country: data.target_country,
      desired_start_at: data.desired_start_at ? new Date(data.desired_start_at) : null,
      brief: data.brief,
      materials_url: data.materials_url ?? null,
      // M15 — no admin approval gate. Request is immediately visible to the
      // target channel owner. Status remains 'new' which the brand-facing UI
      // now labels "Awaiting Owner Response".
      status: 'new',
      admin_notes: null,
      owner_responded_at: null,
      created_at: now,
      updated_at: now,
    };
    return sponsorshipLeadRepo.insert(lead);
  },

  /** Own leads (for the requester_user_id owner of an authenticated submission). */
  async listMine(actor: Actor): Promise<SponsorshipLead[]> {
    return sponsorshipLeadRepo.list({ requester_user_id: actor.user.id });
  },

  /** M15 — leads addressed to channels this user owns (target owner view). */
  async listForOwnedChannels(actor: Actor): Promise<SponsorshipLead[]> {
    const owned = await channelRepo.listByOwner(actor.user.id);
    const ids = owned.map((c) => c.id);
    if (ids.length === 0) return [];
    return sponsorshipLeadRepo.list({ channel_id: { $in: ids } }, { limit: 200 });
  },

  /** Admin listing with optional filters. */
  async listAdmin(actor: Actor, opts: { status?: SponsorshipLeadStatus; budget_range?: string; channel_id?: string } = {}): Promise<SponsorshipLead[]> {
    if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) throw new HttpError(403, 'Admin privileges required');
    const filter: Record<string, unknown> = {};
    if (opts.status) filter.status = opts.status;
    if (opts.budget_range) filter.budget_range = opts.budget_range;
    if (opts.channel_id) filter.channel_id = opts.channel_id;
    return sponsorshipLeadRepo.list(filter, { limit: 200 });
  },

  /** Admin detail. */
  async getAdmin(actor: Actor, id: string): Promise<SponsorshipLead> {
    if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) throw new HttpError(403, 'Admin privileges required');
    const lead = await sponsorshipLeadRepo.findById(id);
    if (!lead) throw new HttpError(404, 'Sponsorship lead not found');
    return lead;
  },

  /**
   * M15 — unified detail authorization used by both brand (requester) and
   * target channel owner. Admins are also authorized. Any other user →
   * HttpError(403). Replaces the previous requester-only `getMine`.
   */
  async getForViewer(actor: Actor, id: string): Promise<{ lead: SponsorshipLead; viewer: 'owner' | 'requester' | 'admin' }> {
    const lead = await sponsorshipLeadRepo.findById(id);
    if (!lead) throw new HttpError(404, 'Sponsorship request not found');
    const viewer = await assertCanView(actor, lead);
    return { lead, viewer };
  },

  /** Back-compat shim — requester-only path preserved for old callers. */
  async getMine(actor: Actor, id: string): Promise<SponsorshipLead> {
    const lead = await sponsorshipLeadRepo.findById(id);
    if (!lead) throw new HttpError(404, 'Sponsorship request not found');
    if (lead.requester_user_id !== actor.user.id) throw new HttpError(403, 'Not your sponsorship request');
    return lead;
  },

  /**
   * M15 — owner responds to a sponsorship request (Accept / Decline). Only
   * the target channel owner may call. WaveLead remains the system of record
   * — this only records the response; commercial/booking/payment lifecycle
   * (Marketplace) is untouched.
   */
  async respondAsOwner(actor: Actor, id: string, action: 'accept' | 'decline'): Promise<SponsorshipLead> {
    const lead = await sponsorshipLeadRepo.findById(id);
    if (!lead) throw new HttpError(404, 'Sponsorship request not found');
    const channel = await channelRepo.findById(lead.channel_id);
    if (!channel || channel.owner_id !== actor.user.id) throw new HttpError(403, 'Only the target channel owner can respond to this request');
    if (lead.status === 'accepted_by_owner' || lead.status === 'declined_by_owner') {
      throw new HttpError(409, `Request already ${lead.status.replace('_by_owner', '')} by the owner`);
    }
    const nextStatus: SponsorshipLeadStatus = action === 'accept' ? 'accepted_by_owner' : 'declined_by_owner';
    const updated = await sponsorshipLeadRepo.setOwnerResponse(id, nextStatus, new Date());
    if (!updated) throw new HttpError(500, 'Failed to update request');
    return updated;
  },

  /** Admin status/notes update. Retained for oversight / abuse handling. */
  async patch(actor: Actor, id: string, input: unknown): Promise<SponsorshipLead> {
    if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) throw new HttpError(403, 'Admin privileges required');
    const parsed = sponsorshipLeadPatchSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid patch: ${parsed.error.issues[0]?.message || 'invalid'}`);
    const { status, admin_notes } = parsed.data;
    const existing = await sponsorshipLeadRepo.findById(id);
    if (!existing) throw new HttpError(404, 'Sponsorship lead not found');
    const updated = await sponsorshipLeadRepo.updateStatus(id, status ?? existing.status, admin_notes === undefined ? existing.admin_notes : admin_notes);
    return updated as SponsorshipLead;
  },

  async adminStatusCounts(actor: Actor) {
    if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) throw new HttpError(403, 'Admin privileges required');
    return sponsorshipLeadRepo.statusCounts();
  },
};
