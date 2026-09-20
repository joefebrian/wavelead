// M18 — BRAND LAUNCH CAMPAIGNS (non-financial workflow).
//
// Brand publishes an opportunity → eligible channel owners apply → brand
// shortlists / approves / rejects → the approved creator is handed off to the
// EXISTING WaveLead marketplace booking + Payment Protection + 90/10 payout.
//
// DELIBERATELY ABSENT (deferred by the operator, do not add here):
//   • campaign commitment deposit / 5% deposit
//   • campaign wallet / funding balance / top-up / deposit ledger or refunds
//   • campaign-level PayPal funding of any kind
// This service therefore contains NO provider/PayPal dependency at all: the
// campaign domain never touches a payment provider, which also keeps it
// provider-agnostic by construction.
//
// Total Campaign Budget is PLANNING/DISPLAY data. It holds no money, creates
// no obligation and triggers no provider call. The only financial truth is an
// existing marketplace order.
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { HttpError, requireAuth } from '@/lib/auth/rbac';
import { brandCampaignRepo } from '@/lib/repositories/brandCampaignRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';
import { normalizeCountryCode } from '@/lib/constants/countries';
import type { Actor } from '@/lib/types';

/* ------------------------------------------------------------------ MODEL */

// M19 — `commitment_required` sits between draft and open: the campaign is
// complete but cannot be published until the 5% Campaign Commitment Deposit
// has been authoritatively captured.
export const CAMPAIGN_STATUSES = ['draft', 'commitment_required', 'open', 'in_selection', 'active', 'completed', 'cancelled'] as const;
export type BrandCampaignStatus = typeof CAMPAIGN_STATUSES[number];

export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'approved', 'rejected', 'withdrawn'] as const;
export type BrandCampaignApplicationStatus = typeof APPLICATION_STATUSES[number];

/** Statuses in which the brand may still edit campaign content / budget. */
export const EDITABLE_STATUSES: BrandCampaignStatus[] = ['draft', 'commitment_required', 'open', 'in_selection'];

/**
 * M19 D2/D3 — statuses in which a campaign is readable on CREATOR discovery
 * surfaces. Reaching any of them requires a captured commitment deposit.
 */
export const CREATOR_VISIBLE_STATUSES: BrandCampaignStatus[] = ['open', 'in_selection', 'active'];

export interface BudgetChange {
  previous_budget_usd_minor: number;
  new_budget_usd_minor: number;
  changed_at: Date;
  changed_by: string;
  reason: string | null;
}

export interface BrandCampaign {
  id: string;
  brand_user_id: string;
  name: string;
  brand_name: string;
  objective: string;
  brief: string;
  target_country_codes: string[];
  target_category_slugs: string[];
  start_date: Date | null;
  end_date: Date | null;
  application_deadline: Date | null;
  /** PLANNING ONLY. Never escrow, deposit, wallet or held funds. */
  budget_total_usd_minor: number;
  budget_history: BudgetChange[];
  creator_requirements: string | null;
  expected_creator_count: number | null;
  deliverables: string | null;
  materials_url: string | null;      // external HTTPS link; WaveLead hosts no files
  status: BrandCampaignStatus;
  opened_at: Date | null;
  // M19 — commitment-deposit bookkeeping (brand/admin only, never creator-facing).
  commitment_funded_at?: Date | null;
  commitment_topup_required_minor?: number;
  /**
   * M19 D6 — set when an authoritative provider refund/reversal left the
   * Campaign Commitment Deposit short. Existing marketplace obligations are
   * preserved; the campaign is hidden from creator discovery and blocked from
   * creating NEW bookings until the deposit is restored.
   */
  commitment_issue_state?: 'refund_shortfall' | 'commitment_shortfall' | null;
  commitment_issue_shortfall_minor?: number;
  commitment_issue_detected_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BrandCampaignApplication {
  id: string;
  campaign_id: string;
  channel_id: string;
  creator_user_id: string;
  proposed_rate_usd_minor: number | null;
  pitch: string;
  audience_note: string | null;
  message_to_brand: string | null;
  materials_url: string | null;
  status: BrandCampaignApplicationStatus;
  shortlisted_at: Date | null;
  decided_at: Date | null;
  /** Set when the brand continues into the existing marketplace booking. */
  marketplace_order_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/* ---------------------------------------------------------------- SCHEMAS */

const httpsUrl = z.string().trim().url().max(500).refine((u) => /^https:\/\//i.test(u), 'Must be an https:// link');

export const campaignInputSchema = z.object({
  name: z.string().trim().min(3).max(140),
  brand_name: z.string().trim().min(2).max(140),
  objective: z.string().trim().min(3).max(300),
  brief: z.string().trim().min(20).max(6_000),
  target_country_codes: z.array(z.string().trim().min(2).max(64)).max(50).default([]),
  target_category_slugs: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  start_date: z.string().datetime().optional().nullable(),
  end_date: z.string().datetime().optional().nullable(),
  application_deadline: z.string().datetime().optional().nullable(),
  /**
   * M19 D12 — a campaign that requires a 5% Campaign Commitment Deposit can
   * never carry a zero or negative budget: $0 would render a "0.00 required"
   * deposit and a campaign that is funded by nothing.
   */
  budget_total_usd_minor: z.number().int().min(1, 'Enter a campaign budget greater than $0.').max(100_000_000),
  creator_requirements: z.string().trim().max(2_000).optional().nullable(),
  expected_creator_count: z.number().int().min(1).max(10_000).optional().nullable(),
  deliverables: z.string().trim().max(2_000).optional().nullable(),
  materials_url: httpsUrl.optional().nullable(),
});

export const applicationInputSchema = z.object({
  channel_id: z.string().trim().min(1).max(64),
  proposed_rate_usd_minor: z.number().int().min(0).max(10_000_000).optional().nullable(),
  pitch: z.string().trim().min(20).max(2_000),
  audience_note: z.string().trim().max(1_000).optional().nullable(),
  message_to_brand: z.string().trim().max(1_000).optional().nullable(),
  materials_url: httpsUrl.optional().nullable(),
});

export const budgetChangeSchema = z.object({
  // M19 D12 — an existing campaign can never be edited down to $0 either.
  budget_total_usd_minor: z.number().int().min(1, 'Enter a campaign budget greater than $0.').max(100_000_000),
  reason: z.string().trim().max(300).optional().nullable(),
});

/* ---------------------------------------------------------------- HELPERS */

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.join('.')}: ${first.message}`);
  }
  return r.data;
}

async function ownedCampaign(actor: Actor | null, id: string): Promise<BrandCampaign> {
  requireAuth(actor);
  const c = await brandCampaignRepo.findById(id);
  if (!c) throw new HttpError(404, 'Campaign not found');
  if (c.brand_user_id !== actor.user.id) throw new HttpError(403, 'Only the brand that created this campaign can manage it');
  return c;
}

function normalizeCountries(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const code = normalizeCountryCode(raw);
    if (code) out.add(code);
  }
  return [...out];
}

function toDate(v: string | null | undefined): Date | null { return v ? new Date(v) : null; }

/** USD minor units → display string, for server-side error messages. */
function money(m: number): string { return `${(m / 100).toFixed(2)} USD`; }

/**
 * M19 D4 — CREATOR-FACING DTO.
 *
 * Creators never receive a raw brand_campaigns document. This projection is an
 * explicit allow-list: it deliberately omits `brand_user_id`, Mongo `_id`, the
 * whole `budget_history` audit trail (including `changed_by`), every
 * commitment / payment / provider reference and every internal funding or
 * accounting field. Brand and Admin surfaces keep their own richer payloads.
 */
export interface CreatorOpportunity {
  id: string;
  brand_name: string;
  brand_logo_url: string | null;
  name: string;
  objective: string;
  brief: string;
  target_country_codes: string[];
  target_category_slugs: string[];
  start_date: Date | null;
  end_date: Date | null;
  application_deadline: Date | null;
  creator_requirements: string | null;
  expected_creator_count: number | null;
  deliverables: string | null;
  materials_url: string | null;
  /** Compensation context only — the campaign budget holds no money. */
  budget_total_usd_minor: number;
  status: BrandCampaignStatus;
  opened_at: Date | null;
}

export function toCreatorOpportunity(c: BrandCampaign): CreatorOpportunity {
  return {
    id: c.id,
    brand_name: c.brand_name,
    brand_logo_url: null,                 // no brand logo field exists in this domain yet
    name: c.name,
    objective: c.objective,
    brief: c.brief,
    target_country_codes: c.target_country_codes || [],
    target_category_slugs: c.target_category_slugs || [],
    start_date: c.start_date ?? null,
    end_date: c.end_date ?? null,
    application_deadline: c.application_deadline ?? null,
    creator_requirements: c.creator_requirements ?? null,
    expected_creator_count: c.expected_creator_count ?? null,
    deliverables: c.deliverables ?? null,
    materials_url: c.materials_url ?? null,
    budget_total_usd_minor: c.budget_total_usd_minor,
    status: c.status,
    opened_at: c.opened_at ?? null,
  };
}

/* ---------------------------------------------------------------- SERVICE */

export const brandCampaignService = {
  CAMPAIGN_STATUSES,
  APPLICATION_STATUSES,

  async createDraft(actor: Actor | null, input: unknown): Promise<BrandCampaign> {
    requireAuth(actor);
    const d = parse(campaignInputSchema, input);
    const now = new Date();
    const row: BrandCampaign = {
      id: uuidv4(),
      brand_user_id: actor.user.id,          // server-derived, never from payload
      name: d.name,
      brand_name: d.brand_name,
      objective: d.objective,
      brief: d.brief,
      target_country_codes: normalizeCountries(d.target_country_codes),
      target_category_slugs: d.target_category_slugs,
      start_date: toDate(d.start_date),
      end_date: toDate(d.end_date),
      application_deadline: toDate(d.application_deadline),
      budget_total_usd_minor: d.budget_total_usd_minor,
      budget_history: [],
      creator_requirements: d.creator_requirements ?? null,
      expected_creator_count: d.expected_creator_count ?? null,
      deliverables: d.deliverables ?? null,
      materials_url: d.materials_url ?? null,
      status: 'draft',
      opened_at: null,
      created_at: now,
      updated_at: now,
    };
    await brandCampaignRepo.insert(row);
    return row;
  },

  async update(actor: Actor | null, id: string, input: unknown): Promise<BrandCampaign> {
    const c = await ownedCampaign(actor, id);
    if (!EDITABLE_STATUSES.includes(c.status)) throw new HttpError(409, `A ${c.status} campaign can no longer be edited`);
    const d = parse(campaignInputSchema, input);
    // Budget is handled by changeBudget() so history + commitment safety apply.
    const patch: Partial<BrandCampaign> = {
      name: d.name, brand_name: d.brand_name, objective: d.objective, brief: d.brief,
      target_country_codes: normalizeCountries(d.target_country_codes),
      target_category_slugs: d.target_category_slugs,
      start_date: toDate(d.start_date), end_date: toDate(d.end_date),
      application_deadline: toDate(d.application_deadline),
      creator_requirements: d.creator_requirements ?? null,
      expected_creator_count: d.expected_creator_count ?? null,
      deliverables: d.deliverables ?? null,
      materials_url: d.materials_url ?? null,
    };
    await brandCampaignRepo.update(id, patch);
    return { ...c, ...patch, updated_at: new Date() };
  },

  /** Publish: the campaign becomes visible to eligible creators. No payment. */
  /**
   * M19 PUBLISH GATE — a campaign only becomes publicly visible to creators
   * once the required 5% Campaign Commitment Deposit is CAPTURED. The gate is
   * server-authoritative; a browser return cannot open a campaign.
   */
  async open(actor: Actor | null, id: string): Promise<BrandCampaign> {
    const c = await ownedCampaign(actor, id);
    if (c.status === 'open') return c;
    if (!['draft', 'commitment_required'].includes(c.status)) {
      throw new HttpError(409, `Only a draft campaign can be opened (current: ${c.status})`);
    }
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    const sum = await campaignCommitmentService.summary(id);
    if (!sum.funded) {
      // Park the campaign in commitment_required and tell the brand what is due.
      if (c.status === 'draft') await brandCampaignRepo.update(id, { status: 'commitment_required' } as never);
      throw new HttpError(402,
        `Campaign Commitment Deposit required before this campaign can open: ${(sum.required_commitment_minor / 100).toFixed(2)} USD required, ${(sum.paid_commitment_minor / 100).toFixed(2)} USD paid (${(sum.topup_required_minor / 100).toFixed(2)} USD outstanding).`);
    }
    const patch = { status: 'open' as BrandCampaignStatus, opened_at: new Date() };
    await brandCampaignRepo.update(id, patch);
    return { ...c, ...patch };
  },

  /** Commitment picture for brand/admin surfaces (never shown to creators). */
  async commitmentSummary(actor: Actor | null, id: string) {
    await ownedCampaign(actor, id);
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    // Normalises legacy / refunded / topped-up state before reporting (idempotent).
    await campaignCommitmentService.reconcileFundingState(id);
    const sum = await campaignCommitmentService.summary(id);
    const cap = await this.fundedCapacity(id);
    return { ...sum, ...cap };
  },

  /**
   * M19 D2 — status transitions may never move a campaign into a
   * CREATOR-VISIBLE state without an authoritatively captured commitment
   * deposit. `open` goes through open(); `in_selection` / `active` are gated
   * the same way; `completed` / `cancelled` are always allowed.
   */
  async setStatus(actor: Actor | null, id: string, status: BrandCampaignStatus): Promise<BrandCampaign> {
    const c = await ownedCampaign(actor, id);
    if (!CAMPAIGN_STATUSES.includes(status)) throw new HttpError(400, 'Unknown campaign status');
    if (status === 'open') return this.open(actor, id);
    if (status === c.status) return c;
    if (!['in_selection', 'active', 'completed', 'cancelled'].includes(status)) {
      throw new HttpError(409, `A campaign cannot be moved back to ${status}`);
    }
    if (CREATOR_VISIBLE_STATUSES.includes(status)) {
      const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
      const sum = await campaignCommitmentService.summary(id);
      if (!sum.funded || c.commitment_issue_state) {
        throw new HttpError(402,
          `Campaign Commitment Deposit required before this campaign can become ${status}: ${(sum.topup_required_minor / 100).toFixed(2)} USD outstanding.`);
      }
    }
    await brandCampaignRepo.update(id, { status });
    return { ...c, status };
  },

  async listMine(actor: Actor | null): Promise<BrandCampaign[]> {
    requireAuth(actor);
    return brandCampaignRepo.listForBrand(actor.user.id);
  },

  /**
   * CREATOR-FACING opportunities.
   *
   * M19 D2/D3 — an unfunded campaign is never discoverable: the caller must be
   * an authenticated user (enforced at the route), and every row must have an
   * authoritatively captured commitment deposit with no funding issue. Closed
   * deadlines and non-open statuses are filtered out as before.
   */
  async listOpportunities(): Promise<CreatorOpportunity[]> {
    const rows = await brandCampaignRepo.listOpen();
    const now = Date.now();
    const live = rows.filter((c) => !c.commitment_issue_state
      && (!c.application_deadline || new Date(c.application_deadline).getTime() >= now));
    if (!live.length) return [];
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    const backed = await campaignCommitmentService.commitmentBackedCampaignIds(
      live.map((c) => ({ id: c.id, budget_total_usd_minor: c.budget_total_usd_minor })),
    );
    // D4 — safe creator projection, never the raw campaign document.
    return live.filter((c) => backed.has(c.id)).map(toCreatorOpportunity);
  },

  /**
   * INTERNAL creator-visibility gate. Returns the raw campaign for server-side
   * checks only — it is never returned to a creator (see getOpportunity).
   *
   * A campaign is readable by creators only while it is backed by REAL
   * captured commitment and carries no funding issue. Publishing itself is
   * gated separately and more strictly by open() (full required 5%).
   */
  async assertCreatorVisible(id: string): Promise<BrandCampaign> {
    const c = await brandCampaignRepo.findById(id);
    if (!c) throw new HttpError(404, 'Campaign not found');
    if (!CREATOR_VISIBLE_STATUSES.includes(c.status)) throw new HttpError(404, 'Campaign is not open');
    if (c.commitment_issue_state) throw new HttpError(404, 'Campaign is not open');
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    const sum = await campaignCommitmentService.summary(id);
    if (sum.paid_commitment_minor <= 0) throw new HttpError(404, 'Campaign is not open');
    return c;
  },

  /**
   * CREATOR-FACING campaign detail. Same gate as the list, so a direct
   * campaign id / URL can never bypass the funding gate, and the payload is
   * the safe D4 projection.
   */
  async getOpportunity(id: string): Promise<CreatorOpportunity> {
    return toCreatorOpportunity(await this.assertCreatorVisible(id));
  },

  /**
   * COMMITTED BOOKING VALUE (M19 D1) — the only financially authoritative
   * obligation a campaign can carry.
   *
   * Source of truth = EXISTING marketplace orders, resolved from the durable
   * association written at order creation:
   *   • every order with `source_brand_campaign_id === campaignId`, UNION
   *   • every order referenced by `application.marketplace_order_id` for an
   *     application of this campaign (back-link safety net for orders created
   *     before the link existed), accepted only when that order carries no
   *     different campaign id — so no unrelated order is ever counted.
   * Orders are de-duplicated by order id.
   *
   * NON-OBLIGATING orders are excluded using the existing marketplace
   * financial semantics — the same terminal set the duplicate-booking guard
   * uses: `owner_rejected` (owner declined) and `cancelled` (voided).
   *
   * Value per order = `snapshot.gross_price_minor` (authoritative accepted
   * price) when present, otherwise the server-derived `quoted_price_minor`.
   *
   * Application status (applied / shortlisted / approved) is NEVER used: an
   * approval creates no obligation, only a marketplace order does.
   */
  async committedBookingValueMinor(campaignId: string): Promise<{ total_minor: number; order_ids: string[] }> {
    const NON_OBLIGATING = ['owner_rejected', 'cancelled'];
    const byId = new Map<string, number>();

    // (a) authoritative: orders that carry this campaign's source reference.
    const direct = await marketplaceOrderRepo.listBySourceCampaign(campaignId);
    for (const o of direct) {
      if (NON_OBLIGATING.includes(o.status as string)) continue;
      byId.set(o.id, o.snapshot?.gross_price_minor ?? o.quoted_price_minor ?? 0);
    }

    // (b) safety net: orders linked back from this campaign's applications.
    const apps = await brandCampaignRepo.listApplicationsForCampaign(campaignId);
    for (const a of apps) {
      const oid = a.marketplace_order_id;
      if (!oid || byId.has(oid)) continue;
      const o = await marketplaceOrderRepo.findById(oid);
      if (!o) continue;
      // Never count an order that belongs to a different campaign.
      if (o.source_brand_campaign_id && o.source_brand_campaign_id !== campaignId) continue;
      if (NON_OBLIGATING.includes(o.status as string)) continue;
      byId.set(o.id, o.snapshot?.gross_price_minor ?? o.quoted_price_minor ?? 0);
    }

    let total = 0;
    for (const v of byId.values()) total += v;
    return { total_minor: total, order_ids: [...byId.keys()] };
  },

  /**
   * M19 D7 — FUNDED CAMPAIGN CAPACITY (server-authoritative).
   *
   *   funded_campaign_limit_minor  = captured commitment ÷ 5%   (i.e. the
   *                                  budget actually backed by real money)
   *   funded_campaign_capacity_minor = min(funded limit, current budget)
   *   available_funded_capacity_minor = capacity − committed booking value
   *
   * Inputs are all server-side: the authoritative captured (minus refunded)
   * commitment, the stored commitment percentage, the stored campaign budget
   * and committedBookingValueMinor(). Application status is never used.
   */
  async fundedCapacity(campaignId: string) {
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    const sum = await campaignCommitmentService.summary(campaignId);
    const committed = await this.committedBookingValueMinor(campaignId);
    const capacity = Math.max(0, Math.min(sum.funded_campaign_limit_minor, sum.campaign_budget_usd_minor));
    return {
      commitment_percent: sum.commitment_percent,
      campaign_budget_usd_minor: sum.campaign_budget_usd_minor,
      required_commitment_minor: sum.required_commitment_minor,
      paid_commitment_minor: sum.paid_commitment_minor,
      commitment_shortfall_minor: sum.topup_required_minor,
      funded_campaign_limit_minor: sum.funded_campaign_limit_minor,
      funded_campaign_capacity_minor: capacity,
      committed_booking_value_minor: committed.total_minor,
      available_funded_capacity_minor: Math.max(0, capacity - committed.total_minor),
      committed_order_ids: committed.order_ids,
    };
  },

  /**
   * Hard financial gate for a NEW marketplace obligation created from a
   * campaign: existing committed booking value + the new booking must fit
   * inside the funded campaign capacity. Approving an applicant never reaches
   * this gate — approval creates no obligation.
   */
  async assertNewObligationAllowed(campaignId: string, newObligationMinor: number) {
    const cap = await this.fundedCapacity(campaignId);
    const add = Math.max(0, Math.round(Number(newObligationMinor) || 0));
    if (cap.committed_booking_value_minor + add > cap.funded_campaign_capacity_minor) {
      throw new HttpError(409,
        `This booking of ${money(add)} exceeds the funded campaign capacity of ${money(cap.funded_campaign_capacity_minor)} `
        + `(${money(cap.committed_booking_value_minor)} already committed, ${money(cap.available_funded_capacity_minor)} available). `
        + `Capture the ${money(cap.commitment_shortfall_minor)} Campaign Commitment Deposit top-up before creating this obligation.`);
    }
    return cap;
  },

  /**
   * Budget edit with lightweight version history. The budget may never drop
   * below the value already committed through real marketplace bookings.
   */
  async changeBudget(actor: Actor | null, id: string, input: unknown): Promise<BrandCampaign> {
    const c = await ownedCampaign(actor, id);
    if (!EDITABLE_STATUSES.includes(c.status) && c.status !== 'active') {
      throw new HttpError(409, `A ${c.status} campaign budget can no longer be changed`);
    }
    const d = parse(budgetChangeSchema, input);
    if (d.budget_total_usd_minor === c.budget_total_usd_minor) return c;

    const committed = await this.committedBookingValueMinor(id);
    if (d.budget_total_usd_minor < committed.total_minor) {
      throw new HttpError(409,
        `Budget cannot be lower than the ${(committed.total_minor / 100).toFixed(2)} USD already committed through marketplace bookings for this campaign`);
    }
    const change: BudgetChange = {
      previous_budget_usd_minor: c.budget_total_usd_minor,
      new_budget_usd_minor: d.budget_total_usd_minor,
      changed_at: new Date(),
      changed_by: actor!.user.id,
      reason: d.reason ?? null,
    };
    const history = [...(c.budget_history || []), change];
    await brandCampaignRepo.update(id, { budget_total_usd_minor: d.budget_total_usd_minor, budget_history: history });
    // M19 — a budget INCREASE raises the required 5%: the campaign stays
    // visible, but the FUNDED CAMPAIGN CAPACITY stays at the budget actually
    // backed by captured commitment (D7), so no new obligation beyond it can
    // be created until the top-up is captured. A DECREASE can leave excess
    // commitment, tracked as a campaign-linked credit and NEVER recognised as
    // WaveLead revenue. One source of truth: reconcileFundingState().
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    await campaignCommitmentService.reconcileFundingState(id);
    return { ...c, budget_total_usd_minor: d.budget_total_usd_minor, budget_history: history };
  },

  /* ------------------------------------------------------- APPLICATIONS */

  /**
   * Creator applies with a channel they legitimately own. Ownership follows
   * WaveLead's existing rule (channel.owner_id === actor), so an unrelated
   * user gets 403 and can never apply on someone else's channel.
   */
  async apply(actor: Actor | null, campaignId: string, input: unknown): Promise<BrandCampaignApplication> {
    requireAuth(actor);
    const campaign = await this.assertCreatorVisible(campaignId);
    if (campaign.status !== 'open') throw new HttpError(409, 'This campaign is no longer accepting applications');
    if (campaign.application_deadline && new Date(campaign.application_deadline).getTime() < Date.now()) {
      throw new HttpError(409, 'The application deadline for this campaign has passed');
    }
    if (campaign.brand_user_id === actor.user.id) throw new HttpError(409, 'You cannot apply to your own campaign');

    const d = parse(applicationInputSchema, input);
    const channel = await channelRepo.findById(d.channel_id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.owner_id !== actor.user.id) throw new HttpError(403, 'You can only apply with a channel you own on WaveLead');
    if (channel.status !== 'approved') throw new HttpError(409, 'Only an approved channel listing can apply to a campaign');

    const dup = await brandCampaignRepo.findLiveApplication(campaignId, channel.id);
    if (dup) throw new HttpError(409, 'This channel has already applied to this campaign');

    const now = new Date();
    const row: BrandCampaignApplication = {
      id: uuidv4(),
      campaign_id: campaignId,
      channel_id: channel.id,
      creator_user_id: actor.user.id,
      proposed_rate_usd_minor: d.proposed_rate_usd_minor ?? null,
      pitch: d.pitch,
      audience_note: d.audience_note ?? null,
      message_to_brand: d.message_to_brand ?? null,
      materials_url: d.materials_url ?? null,
      status: 'applied',
      shortlisted_at: null,
      decided_at: null,
      marketplace_order_id: null,
      created_at: now,
      updated_at: now,
    };
    await brandCampaignRepo.insertApplication(row);
    // M19 — best-effort notifications; never allowed to corrupt state.
    try {
      const { campaignNotificationService } = await import('@/lib/services/campaignNotificationService');
      await campaignNotificationService.applicationSubmitted(campaign, row, channel.name);
    } catch { /* notifications are best-effort */ }
    return row;
  },

  async withdraw(actor: Actor | null, applicationId: string): Promise<BrandCampaignApplication> {
    requireAuth(actor);
    const app = await brandCampaignRepo.findApplication(applicationId);
    if (!app) throw new HttpError(404, 'Application not found');
    if (app.creator_user_id !== actor.user.id) throw new HttpError(403, 'Only the applicant can withdraw this application');
    if (app.marketplace_order_id) throw new HttpError(409, 'This application already has a marketplace booking and cannot be withdrawn');
    await brandCampaignRepo.updateApplication(applicationId, { status: 'withdrawn', decided_at: new Date() });
    return { ...app, status: 'withdrawn' };
  },

  /**
   * Creator's own applications, enriched for display (M19 — Applications
   * clarity): every row carries the Brand name, Campaign name and the channel
   * used, so the creator never has to open a detail view to know which brand
   * and campaign an application belongs to. Read-only enrichment — no new
   * notification scope, no private brand data.
   */
  async listMyApplications(actor: Actor | null): Promise<(BrandCampaignApplication & {
    campaign_name: string | null; brand_name: string | null; campaign_status: string | null;
    channel_name: string | null; channel_slug: string | null;
  })[]> {
    requireAuth(actor);
    const rows = await brandCampaignRepo.listApplicationsForCreator(actor.user.id);
    const campaigns = new Map<string, BrandCampaign | null>();
    const channels = new Map<string, { name: string; slug: string } | null>();
    const out = [];
    for (const a of rows) {
      if (!campaigns.has(a.campaign_id)) campaigns.set(a.campaign_id, await brandCampaignRepo.findById(a.campaign_id));
      if (!channels.has(a.channel_id)) {
        const ch = await channelRepo.findById(a.channel_id);
        channels.set(a.channel_id, ch ? { name: ch.name, slug: ch.slug } : null);
      }
      const c = campaigns.get(a.campaign_id) || null;
      const ch = channels.get(a.channel_id) || null;
      out.push({
        ...a,
        campaign_name: c?.name ?? null,
        brand_name: c?.brand_name ?? null,
        campaign_status: c?.status ?? null,
        channel_name: ch?.name ?? null,
        channel_slug: ch?.slug ?? null,
      });
    }
    return out;
  },

  /**
   * Brand workspace: campaign + applicants enriched with PUBLIC channel data
   * (M19 D9 — applicant pool). Only existing public/authorised domains are
   * reused: the public rate card (marketplaceService.getPublicRateCard) and
   * public Sample Work (sampleWorkService.listPublic). Nothing is duplicated
   * or re-stored, and no private creator identity, contact or payment data is
   * exposed — the brand sees the same channel facts a public visitor sees,
   * plus the applicant's own submission.
   */
  async getForBrand(actor: Actor | null, id: string) {
    await ownedCampaign(actor, id);
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    // Legacy / refund / top-up normalisation before the brand sees the state.
    await campaignCommitmentService.reconcileFundingState(id);
    const campaign = await brandCampaignRepo.findById(id) as BrandCampaign;
    const apps = await brandCampaignRepo.listApplicationsForCampaign(id);

    const { categoryRepo } = await import('@/lib/repositories/categoryRepo');
    const categories = await categoryRepo.listActive().catch(() => []);
    const categoryName = new Map(categories.map((c) => [c.id, c.name] as const));
    const { marketplaceService } = await import('@/lib/services/marketplaceService');
    const { sampleWorkService } = await import('@/lib/services/sampleWorkService');

    const enriched = [];
    for (const a of apps) {
      const ch = await channelRepo.findById(a.channel_id);
      let rateCardPackages = 0;
      let sampleWorks = 0;
      if (ch) {
        const card = await marketplaceService.getPublicRateCard(ch.id).catch(() => null);
        rateCardPackages = card?.packages?.length || 0;
        sampleWorks = (await sampleWorkService.listPublic(ch.id).catch(() => [])).length;
      }
      enriched.push({
        ...a,
        channel: ch ? {
          id: ch.id, slug: ch.slug, name: ch.name,
          logo_url: ch.logo_url ?? null,
          country_code: ch.country_code, category_id: ch.category_id,
          category_name: ch.category_id ? (categoryName.get(ch.category_id) ?? null) : null,
          follower_count: ch.follower_count,
          public_followers_count: ch.public_followers_count ?? null,
          verification_status: ch.verification_status,
          profile_url: `/channel/${ch.slug}`,
          has_rate_card: rateCardPackages > 0,
          rate_card_packages: rateCardPackages,
          rate_card_url: rateCardPackages > 0 ? `/channel/${ch.slug}#rate-card` : null,
          has_sample_work: sampleWorks > 0,
          sample_work_count: sampleWorks,
          sample_work_url: sampleWorks > 0 ? `/channel/${ch.slug}#sample-work` : null,
        } : null,
      });
    }
    const capacity = await this.fundedCapacity(id);
    return {
      campaign,
      applications: enriched,
      committed_booking_value_minor: capacity.committed_booking_value_minor,
      capacity,
    };
  },

  /**
   * Brand decision. Shortlisting/approving/rejecting NEVER touches a payment
   * provider: no order is created, nothing is charged or captured, and no
   * WaveLead admin approval gate is involved.
   */
  async decide(
    actor: Actor | null, applicationId: string, decision: 'shortlisted' | 'approved' | 'rejected',
  ): Promise<BrandCampaignApplication> {
    requireAuth(actor);
    const app = await brandCampaignRepo.findApplication(applicationId);
    if (!app) throw new HttpError(404, 'Application not found');
    const campaign = await ownedCampaign(actor, app.campaign_id);
    if (app.status === 'withdrawn') throw new HttpError(409, 'This application was withdrawn by the applicant');

    const patch: Partial<BrandCampaignApplication> = { status: decision };
    if (decision === 'shortlisted') patch.shortlisted_at = new Date();
    else patch.decided_at = new Date();
    await brandCampaignRepo.updateApplication(applicationId, patch);

    // Reviewing applicants moves the campaign into selection — display only.
    if (campaign.status === 'open') await brandCampaignRepo.update(campaign.id, { status: 'in_selection' });
    if (decision === 'approved') {
      try {
        const { campaignNotificationService } = await import('@/lib/services/campaignNotificationService');
        await campaignNotificationService.applicationApproved(campaign, { ...app, ...patch } as BrandCampaignApplication);
      } catch { /* notifications are best-effort */ }
    }
    return { ...app, ...patch } as BrandCampaignApplication;
  },

  /**
   * MARKETPLACE HANDOFF. Returns everything the brand needs to continue into
   * the EXISTING booking flow. It deliberately does NOT create an order or a
   * payment: the brand must explicitly submit the existing booking form.
   * Repeated continuation resolves the SAME existing order.
   */
  async continueToBooking(actor: Actor | null, applicationId: string) {
    requireAuth(actor);
    const app = await brandCampaignRepo.findApplication(applicationId);
    if (!app) throw new HttpError(404, 'Application not found');
    const campaign = await ownedCampaign(actor, app.campaign_id);
    if (app.status !== 'approved') throw new HttpError(409, 'Only an approved applicant can be taken to booking');

    const channel = await channelRepo.findById(app.channel_id);
    if (!channel) throw new HttpError(404, 'Channel not found');

    // Duplicate protection: reuse the existing booking if one already exists.
    let existingOrderId = app.marketplace_order_id;
    if (!existingOrderId) {
      const found = await marketplaceOrderRepo.findActiveBySourceCampaignApplication(app.id);
      if (found) {
        existingOrderId = found.id;
        await brandCampaignRepo.updateApplication(app.id, { marketplace_order_id: found.id });
      }
    }

    // M19 D6 — a refund/reversal (or a wholly unfunded legacy campaign) blocks
    // NEW obligations only. An already existing booking stays fully accessible.
    if (!existingOrderId && campaign.commitment_issue_state) {
      throw new HttpError(409,
        `This campaign has an unresolved Campaign Commitment Deposit shortfall of ${((campaign.commitment_issue_shortfall_minor || 0) / 100).toFixed(2)} USD. Restore the deposit before creating new bookings. Existing bookings are unaffected.`);
    }
    // M19 D7 — funded campaign capacity pre-flight. The authoritative gate
    // runs again when the marketplace order is actually created.
    const capacity = await this.fundedCapacity(campaign.id);
    if (!existingOrderId && capacity.available_funded_capacity_minor <= 0) {
      throw new HttpError(409,
        `No funded campaign capacity left: ${money(capacity.committed_booking_value_minor)} of ${money(capacity.funded_campaign_capacity_minor)} is already committed. `
        + `Capture the ${money(capacity.commitment_shortfall_minor)} Campaign Commitment Deposit top-up to raise the funded capacity.`);
    }

    return {
      application_id: app.id,
      campaign: { id: campaign.id, name: campaign.name, brand_name: campaign.brand_name, objective: campaign.objective, brief: campaign.brief },
      channel: { id: channel.id, slug: channel.slug, name: channel.name },
      proposed_rate_usd_minor: app.proposed_rate_usd_minor,
      existing_order_id: existingOrderId,
      // M19 D7 — funded capacity context for the brand (display + pre-flight).
      funded_campaign_capacity_minor: capacity.funded_campaign_capacity_minor,
      committed_booking_value_minor: capacity.committed_booking_value_minor,
      available_funded_capacity_minor: capacity.available_funded_capacity_minor,
      // The brand continues in the existing marketplace booking surface.
      booking_url: existingOrderId
        ? `/dashboard/sponsorships`
        : `/channel/${channel.slug}/book?campaign=${campaign.id}&application=${app.id}`,
      payment_created: false,   // explicit: approval never creates a payment
    };
  },

  /** Links an existing marketplace order back to its application (idempotent). */
  async attachOrder(applicationId: string, orderId: string): Promise<void> {
    const app = await brandCampaignRepo.findApplication(applicationId);
    if (!app) return;
    if (app.marketplace_order_id && app.marketplace_order_id !== orderId) return;   // never re-point
    await brandCampaignRepo.updateApplication(applicationId, { marketplace_order_id: orderId });
  },

  /** Admin oversight only — no approval gate, no campaign mutation. */
  async adminOverview() {
    const rows = await brandCampaignRepo.listAll();
    const { campaignCommitmentService } = await import('@/lib/services/payments/campaignCommitmentService');
    const out = [];
    for (const c of rows) {
      const apps = await brandCampaignRepo.listApplicationsForCampaign(c.id);
      // Normalise legacy / refunded state so admin always sees the real
      // effective funding state (idempotent, non-destructive).
      await campaignCommitmentService.reconcileFundingState(c.id);
      const fresh = (await brandCampaignRepo.findById(c.id)) || c;
      const cap = await this.fundedCapacity(c.id);
      const sum = await campaignCommitmentService.summary(c.id);
      out.push({
        id: c.id,
        name: c.name,
        brand_name: c.brand_name,
        brand_user_id: c.brand_user_id,
        status: fresh.status,
        budget_total_usd_minor: fresh.budget_total_usd_minor,
        // M19 — commitment oversight (NOT WaveLead revenue).
        required_commitment_minor: sum.required_commitment_minor,
        paid_commitment_minor: sum.paid_commitment_minor,
        refunded_commitment_minor: sum.refunded_commitment_minor,
        commitment_shortfall_minor: sum.topup_required_minor,
        commitment_funded: sum.funded,
        commitment_issue_state: fresh.commitment_issue_state ?? null,
        funded_campaign_capacity_minor: cap.funded_campaign_capacity_minor,
        available_funded_capacity_minor: cap.available_funded_capacity_minor,
        applications: apps.length,
        shortlisted: apps.filter((a) => a.status === 'shortlisted').length,
        approved: apps.filter((a) => a.status === 'approved').length,
        marketplace_bookings: cap.committed_order_ids.length,
        committed_booking_value_minor: cap.committed_booking_value_minor,
        created_at: c.created_at,
      });
    }
    return out;
  },
};
