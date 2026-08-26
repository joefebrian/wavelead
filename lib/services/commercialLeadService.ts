// Pricing conversion — commercial lead service.
// Handles input validation, server-side derivation of user_id/status/timestamps,
// duplicate protection, and RBAC for admin surface.
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { HttpError, hasAtLeastRole, ROLES } from '../auth/rbac';
import { commercialLeadRepo } from '../repositories/commercialLeadRepo';
import {
  ENTERPRISE_COMPANY_TYPES,
  ENTERPRISE_INTERESTS,
  type Actor,
  type CommercialLead,
  type CommercialLeadStatus,
  type CommercialLeadType,
} from '@/lib/types';

const emailField = z.string().trim().toLowerCase().email().max(200);

// Waitlist input — Pro plan.
export const proWaitlistSchema = z.object({
  email: emailField,
  name: z.string().trim().min(1).max(120).optional(),
});
export type ProWaitlistInput = z.infer<typeof proWaitlistSchema>;

// Enterprise input — Contact Sales.
export const enterpriseLeadSchema = z.object({
  company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(120),
  email: emailField,
  company_type: z.enum(ENTERPRISE_COMPANY_TYPES as readonly [string, ...string[]]),
  channel_count: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  country: z.string().trim().length(2).toUpperCase().optional().nullable(),
  interest: z.array(z.enum(ENTERPRISE_INTERESTS as readonly [string, ...string[]])).min(1).max(ENTERPRISE_INTERESTS.length),
  message: z.string().trim().min(1).max(4000),
});
export type EnterpriseLeadInput = z.infer<typeof enterpriseLeadSchema>;

// Admin status-update input.
export const commercialLeadPatchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'won', 'lost']).optional(),
  admin_notes: z.string().trim().max(4000).nullable().optional(),
});

function requireAdmin(actor: Actor | null) {
  if (!actor) throw new HttpError(401, 'Unauthorized');
  if (!hasAtLeastRole(actor.user, ROLES.ADMIN)) throw new HttpError(403, 'Admin privileges required');
}

/**
 * Emit a public-safe copy of the lead. `admin_notes` is admin-only.
 */
function publicLead(lead: CommercialLead): Omit<CommercialLead, 'admin_notes'> {
  const { admin_notes: _drop, ...rest } = lead;
  void _drop;
  return rest;
}

export const commercialLeadService = {
  /** Public: submit a Pro waitlist entry. */
  async submitProWaitlist(actor: Actor | null, input: unknown): Promise<{ ok: true; lead: Omit<CommercialLead, 'admin_notes'>; duplicate?: boolean }> {
    const parsed = proWaitlistSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message || 'invalid'}`);
    const data = parsed.data;

    // Deduplicate: if a lead already exists for this (type, email), return it
    // idempotently instead of erroring. This makes the client-side duplicate
    // submit safe and the DB unique index a defense-in-depth.
    const existing = await commercialLeadRepo.findByTypeEmail('pro_waitlist', data.email);
    if (existing) return { ok: true, lead: publicLead(existing), duplicate: true };

    const now = new Date();
    const doc: CommercialLead = {
      id: uuidv4(),
      type: 'pro_waitlist',
      user_id: actor?.user?.id ?? null,
      email: data.email,
      name: data.name ?? actor?.user?.display_name ?? null,
      company_name: null,
      company_type: null,
      channel_count: null,
      country: actor?.user?.country_code ?? null,
      interest: [],
      message: null,
      source: 'pricing',
      status: 'new',
      admin_notes: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await commercialLeadRepo.insert(doc);
    } catch (e) {
      // Handle the race where two concurrent submits both passed the findByTypeEmail check.
      const msg = (e as Error).message || '';
      if (/E11000|duplicate key/i.test(msg)) {
        const dup = await commercialLeadRepo.findByTypeEmail('pro_waitlist', data.email);
        if (dup) return { ok: true, lead: publicLead(dup), duplicate: true };
      }
      throw e;
    }
    return { ok: true, lead: publicLead(doc) };
  },

  /** Public: submit an Enterprise inquiry. */
  async submitEnterpriseLead(actor: Actor | null, input: unknown): Promise<{ ok: true; lead: Omit<CommercialLead, 'admin_notes'>; duplicate?: boolean }> {
    const parsed = enterpriseLeadSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message || 'invalid'}`);
    const data = parsed.data;

    const existing = await commercialLeadRepo.findByTypeEmail('enterprise_sales', data.email);
    if (existing) return { ok: true, lead: publicLead(existing), duplicate: true };

    const now = new Date();
    const doc: CommercialLead = {
      id: uuidv4(),
      type: 'enterprise_sales',
      user_id: actor?.user?.id ?? null,
      email: data.email,
      name: data.contact_name,
      company_name: data.company_name,
      company_type: data.company_type as CommercialLead['company_type'],
      channel_count: data.channel_count ?? null,
      country: data.country ?? actor?.user?.country_code ?? null,
      interest: data.interest as CommercialLead['interest'],
      message: data.message,
      source: 'pricing',
      status: 'new',
      admin_notes: null,
      created_at: now,
      updated_at: now,
    };
    try {
      await commercialLeadRepo.insert(doc);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/E11000|duplicate key/i.test(msg)) {
        const dup = await commercialLeadRepo.findByTypeEmail('enterprise_sales', data.email);
        if (dup) return { ok: true, lead: publicLead(dup), duplicate: true };
      }
      throw e;
    }
    return { ok: true, lead: publicLead(doc) };
  },

  /** Admin+ list. */
  async listAdmin(actor: Actor, filter: { type?: 'pro_waitlist' | 'enterprise_sales'; status?: CommercialLeadStatus } = {}): Promise<CommercialLead[]> {
    requireAdmin(actor);
    return commercialLeadRepo.list(filter);
  },

  /** Admin+ counts. */
  async adminCounts(actor: Actor): Promise<{ by_type: Record<string, Record<string, number>>; kpi: { new: number; qualified: number; won: number } }> {
    requireAdmin(actor);
    const by_type = await commercialLeadRepo.statusCounts();
    const total = (status: string) => (by_type.pro_waitlist?.[status] || 0) + (by_type.enterprise_sales?.[status] || 0);
    return { by_type, kpi: { new: total('new'), qualified: total('qualified'), won: total('won') } };
  },

  /** Admin+ patch (status + admin_notes only). */
  async patchAdmin(actor: Actor, id: string, input: unknown): Promise<CommercialLead> {
    requireAdmin(actor);
    const parsed = commercialLeadPatchSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message || 'invalid'}`);
    const { status, admin_notes } = parsed.data;
    const existing = await commercialLeadRepo.findById(id);
    if (!existing) throw new HttpError(404, 'Lead not found');
    const updated = await commercialLeadRepo.updateStatus(id, status ?? existing.status, admin_notes);
    if (!updated) throw new HttpError(500, 'Failed to update lead');
    return updated;
  },
};

export type { CommercialLeadType };
