// M19 — Campaign Commitment Deposit (5%) for Brand Campaigns.
//
// PRODUCT WORDING: "Campaign Commitment Deposit" + "Payment Protection".
// Never "escrow fee", "platform fee" or "commission".
//
// ACCOUNTING: this is NOT WaveLead revenue. It is a campaign-linked commitment
// credit, tracked separately from the marketplace 10%, provider fees, Brand
// Pro, Owner Activation and Founding Lifetime. No campaign commission is
// added in M19.
//
// PROVIDER ABSTRACTION: this service talks to the canonical WaveLead payment
// provider interface (getPaymentProvider()), never to PayPal directly. PayPal
// is only today's adapter.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError } from '@/lib/auth/rbac';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { brandCampaignRepo } from '@/lib/repositories/brandCampaignRepo';
import type { Actor } from '@/lib/types';

/** Dedicated payment purpose — keeps this money stream isolated in reporting. */
export const CAMPAIGN_COMMITMENT_DEPOSIT = 'CAMPAIGN_COMMITMENT_DEPOSIT' as const;

/** Server-authoritative commitment percentage. Never computed on the client. */
export const COMMITMENT_PERCENT = 5;

export type CommitmentStatus = 'created' | 'checkout_created' | 'pending' | 'captured' | 'failed' | 'cancelled';

export interface CampaignCommitment {
  id: string;
  campaign_id: string;
  brand_user_id: string;
  payment_purpose: typeof CAMPAIGN_COMMITMENT_DEPOSIT;
  provider: string;
  provider_order_id: string | null;
  provider_capture_id: string | null;
  currency: 'USD';
  campaign_budget_snapshot_minor: number;      // budget when this deposit was created
  commitment_percent: number;                  // 5
  required_commitment_amount_minor: number;    // total required at snapshot time
  amount_minor: number;                        // THIS payment (initial or top-up)
  captured_amount_minor: number;
  status: CommitmentStatus;
  approve_url: string | null;
  return_url: string;
  cancel_url: string;
  captured_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CommitmentSummary {
  commitment_percent: number;
  campaign_budget_usd_minor: number;
  required_commitment_minor: number;
  paid_commitment_minor: number;
  topup_required_minor: number;      // > 0 after a budget increase
  excess_commitment_minor: number;   // > 0 after a budget decrease — never revenue
  funded: boolean;                   // required fully captured → campaign may open
  funded_campaign_limit_minor: number; // budget backed by captured commitment
  open_checkout_id: string | null;
}

/** required = budget * 5% (integer minor units, rounded up so we never under-collect). */
export function requiredCommitmentMinor(budgetMinor: number, percent = COMMITMENT_PERCENT): number {
  const b = Number(budgetMinor);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.ceil((b * percent) / 100);
}

async function coll() { return getCollection<CampaignCommitment>(COLLECTIONS.BRAND_CAMPAIGN_COMMITMENTS); }

export const campaignCommitmentService = {
  CAMPAIGN_COMMITMENT_DEPOSIT,
  COMMITMENT_PERCENT,
  requiredCommitmentMinor,

  async listForCampaign(campaignId: string): Promise<CampaignCommitment[]> {
    const c = await coll();
    return (await c.find({ campaign_id: campaignId }, { projection: { _id: 0 } }).sort({ created_at: 1 }).toArray()) as CampaignCommitment[];
  },

  /** Server-authoritative commitment picture for a campaign. */
  async summary(campaignId: string): Promise<CommitmentSummary> {
    const campaign = await brandCampaignRepo.findById(campaignId);
    const budget = campaign?.budget_total_usd_minor ?? 0;
    const required = requiredCommitmentMinor(budget);
    const rows = await this.listForCampaign(campaignId);
    const paid = rows.filter((r) => r.status === 'captured')
      .reduce((s, r) => s + (r.captured_amount_minor || 0), 0);
    const open = rows.find((r) => ['created', 'checkout_created', 'pending'].includes(r.status)) || null;
    // Budget that is actually backed by captured commitment (used to cap
    // approvals while a top-up is outstanding).
    const fundedLimit = Math.floor((paid * 100) / COMMITMENT_PERCENT);
    return {
      commitment_percent: COMMITMENT_PERCENT,
      campaign_budget_usd_minor: budget,
      required_commitment_minor: required,
      paid_commitment_minor: paid,
      topup_required_minor: Math.max(0, required - paid),
      excess_commitment_minor: Math.max(0, paid - required),
      funded: required > 0 && paid >= required,
      funded_campaign_limit_minor: fundedLimit,
      open_checkout_id: open?.id ?? null,
    };
  },

  /**
   * Start (or top up) the Campaign Commitment Deposit checkout. The amount is
   * always derived server-side from the stored campaign budget.
   */
  async createCheckout(actor: Actor | null, campaignId: string, requestOrigin?: string): Promise<CampaignCommitment> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const campaign = await brandCampaignRepo.findById(campaignId);
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    if (campaign.brand_user_id !== actor.user.id) throw new HttpError(403, 'This campaign belongs to another brand');
    if (['completed', 'cancelled'].includes(campaign.status)) {
      throw new HttpError(409, `A ${campaign.status} campaign cannot be funded`);
    }

    const sum = await this.summary(campaignId);
    if (sum.required_commitment_minor <= 0) throw new HttpError(400, 'Set a campaign budget before funding the commitment deposit');
    if (sum.topup_required_minor <= 0) throw new HttpError(409, 'The Campaign Commitment Deposit is already fully funded');
    if (sum.open_checkout_id) throw new HttpError(409, 'A Campaign Commitment Deposit checkout is already in progress');

    const id = uuidv4();
    const now = new Date();
    const base = (requestOrigin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/dashboard/campaigns/${campaignId}?commitment=${id}&status=paid`;
    const cancel_url = `${base}/dashboard/campaigns/${campaignId}?commitment=${id}&status=cancelled`;
    const provider = getPaymentProvider();
    const doc: CampaignCommitment = {
      id, campaign_id: campaignId, brand_user_id: actor.user.id,
      payment_purpose: CAMPAIGN_COMMITMENT_DEPOSIT,
      provider: provider.id, provider_order_id: null, provider_capture_id: null,
      currency: 'USD',
      campaign_budget_snapshot_minor: sum.campaign_budget_usd_minor,
      commitment_percent: COMMITMENT_PERCENT,
      required_commitment_amount_minor: sum.required_commitment_minor,
      amount_minor: sum.topup_required_minor,
      captured_amount_minor: 0,
      status: 'created',
      approve_url: null, return_url, cancel_url,
      captured_at: null, created_at: now, updated_at: now,
    };
    const c = await coll();
    await c.insertOne(doc as never);

    try {
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: doc.amount_minor,
        currency: doc.currency,
        description: `WaveLead Campaign Commitment Deposit — "${campaign.name.slice(0, 70)}"`,
        return_url, cancel_url,
        // Provider metadata shape is defined by the canonical interface; the
        // campaign domain never depends on a provider-specific field set.
        metadata: { campaign_id: campaignId, owner_user_id: actor.user.id },
      });
      await c.updateOne({ id }, { $set: { status: 'checkout_created', provider_order_id: created.provider_order_id, approve_url: created.approve_url, updated_at: new Date() } });
      return (await c.findOne({ id }, { projection: { _id: 0 } })) as CampaignCommitment;
    } catch (err) {
      await c.updateOne({ id }, { $set: { status: 'failed', updated_at: new Date() } });
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  /**
   * AUTHORITATIVE, IDEMPOTENT finalization. A browser return alone never
   * unlocks a campaign: this always asks the provider for the real capture.
   * When the required commitment is fully captured the campaign is published.
   */
  async captureAndFinalize(commitmentId: string): Promise<CampaignCommitment> {
    const c = await coll();
    const row = (await c.findOne({ id: commitmentId }, { projection: { _id: 0 } })) as CampaignCommitment | null;
    if (!row) throw new HttpError(404, 'Commitment deposit not found');
    if (row.status === 'captured') { await this.publishIfFunded(row.campaign_id); return row; }   // idempotent
    if (!row.provider_order_id) throw new HttpError(400, 'No provider order to capture');

    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: row.provider_order_id });
    if (cap.internal_status !== 'paid') {
      const next: CommitmentStatus = cap.internal_status === 'failed' ? 'failed'
        : cap.internal_status === 'cancelled' ? 'cancelled' : 'pending';
      await c.updateOne({ id: commitmentId, status: { $in: ['created', 'checkout_created', 'pending'] } },
        { $set: { status: next, provider_capture_id: cap.provider_capture_id, updated_at: new Date() } });
      return (await c.findOne({ id: commitmentId }, { projection: { _id: 0 } })) as CampaignCommitment;
    }

    // Conditional transition = idempotency guard: a concurrent/duplicate
    // finalize cannot double-count the captured amount.
    await c.updateOne(
      { id: commitmentId, status: { $in: ['created', 'checkout_created', 'pending'] } },
      { $set: {
        status: 'captured',
        provider_capture_id: cap.provider_capture_id,
        captured_amount_minor: cap.amount_captured_minor,
        captured_at: new Date(), updated_at: new Date(),
      } },
    );
    await this.publishIfFunded(row.campaign_id);
    return (await c.findOne({ id: commitmentId }, { projection: { _id: 0 } })) as CampaignCommitment;
  },

  /** Same pipeline for the provider webhook branch — one source of truth. */
  async captureByProviderOrderId(providerOrderId: string): Promise<CampaignCommitment | null> {
    const c = await coll();
    const row = (await c.findOne({ provider_order_id: providerOrderId }, { projection: { _id: 0 } })) as CampaignCommitment | null;
    if (!row) return null;
    return this.captureAndFinalize(row.id);
  },

  /**
   * Publish gate: a campaign only becomes `open` (and therefore visible in
   * creator Campaign Opportunities) once the required commitment is captured.
   * Idempotent and safe to call repeatedly.
   */
  async publishIfFunded(campaignId: string): Promise<boolean> {
    const sum = await this.summary(campaignId);
    if (!sum.funded) return false;
    const campaign = await brandCampaignRepo.findById(campaignId);
    if (!campaign) return false;
    if (campaign.status === 'draft' || campaign.status === 'commitment_required') {
      await brandCampaignRepo.update(campaignId, {
        status: 'open',
        commitment_funded_at: new Date(),
        opened_at: campaign.opened_at ?? new Date(),
      } as never);
    }
    return true;
  },
};
