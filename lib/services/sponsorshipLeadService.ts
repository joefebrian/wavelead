// M07-Lite Sponsorship Leads service.
//
// Sales-assisted commercial funnel:
//   Brand → Discover Channel → Sponsor this Channel → SponsorshipLead
//     → WaveLead Admin sales pipeline → manual close.
//
// This service does NOT touch payments, ledger, or campaign funding.
// Leads are purely commercial intent records.
import { v4 as uuidv4 } from 'uuid';
import { channelService } from './channelService';
import { sponsorshipLeadRepo } from '../repositories/sponsorshipLeadRepo';
import { sponsorshipLeadCreateSchema, sponsorshipLeadPatchSchema } from '../validation/sponsorshipSchemas';
import { HttpError, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import type { Actor, SponsorshipLead, SponsorshipLeadStatus } from '@/lib/types';

const DUP_WINDOW_MS = 60 * 60 * 1000; // 1h — max 5 leads per email
const DUP_MAX = 5;

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
      status: 'new',
      admin_notes: null,
      created_at: now,
      updated_at: now,
    };
    return sponsorshipLeadRepo.insert(lead);
  },

  /** Own leads (for the requester_user_id owner of an authenticated submission). */
  async listMine(actor: Actor): Promise<SponsorshipLead[]> {
    return sponsorshipLeadRepo.list({ requester_user_id: actor.user.id });
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

  /** Owner (requester) detail — cross-user privacy enforced. */
  async getMine(actor: Actor, id: string): Promise<SponsorshipLead> {
    const lead = await sponsorshipLeadRepo.findById(id);
    if (!lead) throw new HttpError(404, 'Sponsorship lead not found');
    if (lead.requester_user_id !== actor.user.id) throw new HttpError(403, 'Not your sponsorship request');
    return lead;
  },

  /** Admin status/notes update. */
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
