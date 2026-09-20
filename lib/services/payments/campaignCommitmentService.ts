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

// `refunded` = the captured deposit was fully refunded/reversed by the
// provider. It stays in the collection (never deleted) so the campaign's
// funding history remains auditable.
export type CommitmentStatus = 'created' | 'checkout_created' | 'pending' | 'captured' | 'failed' | 'cancelled' | 'refunded';

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
  /** M19 D6 — refunded/reversed part of THIS capture (never negative). */
  refunded_amount_minor?: number;
  /** Provider refund/reversal references already applied (idempotency keys). */
  refund_refs?: string[];
  /**
   * Set when an authoritative provider event did not match the server
   * snapshot (amount/currency). Such a row is NEVER counted as paid.
   */
  finalization_mismatch?: string | null;
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
  paid_commitment_minor: number;     // EFFECTIVE: captured − refunded/reversed
  refunded_commitment_minor: number; // M19 D6 — refunded/reversed total
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

  /**
   * EFFECTIVE captured commitment of one row: captured − refunded/reversed.
   * A row flagged with a finalization mismatch never counts.
   */
  effectivePaidMinor(row: CampaignCommitment): number {
    if (row.finalization_mismatch) return 0;
    if (!['captured', 'refunded'].includes(row.status)) return 0;
    return Math.max(0, (row.captured_amount_minor || 0) - (row.refunded_amount_minor || 0));
  },

  /** Server-authoritative commitment picture for a campaign. */
  async summary(campaignId: string): Promise<CommitmentSummary> {
    const campaign = await brandCampaignRepo.findById(campaignId);
    const budget = campaign?.budget_total_usd_minor ?? 0;
    const required = requiredCommitmentMinor(budget);
    const rows = await this.listForCampaign(campaignId);
    const paid = rows.reduce((s, r) => s + this.effectivePaidMinor(r), 0);
    const refunded = rows.reduce((s, r) => s + (r.refunded_amount_minor || 0), 0);
    const open = rows.find((r) => ['created', 'checkout_created', 'pending'].includes(r.status)) || null;
    // Budget that is actually backed by captured commitment (used to cap
    // approvals while a top-up is outstanding).
    const fundedLimit = Math.floor((paid * 100) / COMMITMENT_PERCENT);
    return {
      commitment_percent: COMMITMENT_PERCENT,
      campaign_budget_usd_minor: budget,
      required_commitment_minor: required,
      paid_commitment_minor: paid,
      refunded_commitment_minor: refunded,
      topup_required_minor: Math.max(0, required - paid),
      excess_commitment_minor: Math.max(0, paid - required),
      funded: required > 0 && paid >= required,
      funded_campaign_limit_minor: fundedLimit,
      open_checkout_id: open?.id ?? null,
    };
  },

  /**
   * M19 D2/D3/D7 — batch creator-discovery check. One query for the whole
   * candidate list instead of a summary() per campaign.
   *
   * A campaign is discoverable when it is backed by REAL captured commitment
   * (effective paid > 0). The PUBLISH gate is stricter and separate: `open()`
   * requires the FULL required 5%. This split is deliberate — after a budget
   * INCREASE the campaign keeps running (creators may still apply, the brand
   * may still review, shortlist and approve) while the outstanding top-up
   * caps the FUNDED CAMPAIGN CAPACITY (D7) for any NEW booking. A campaign
   * with no captured commitment at all (legacy / fully refunded) is never
   * discoverable, and a refund shortfall additionally sets a funding issue
   * flag which hides the campaign.
   */
  async commitmentBackedCampaignIds(campaigns: { id: string; budget_total_usd_minor: number }[]): Promise<Set<string>> {
    const ids = campaigns.map((c) => c.id);
    const backed = new Set<string>();
    if (!ids.length) return backed;
    const c = await coll();
    const rows = (await c.find({ campaign_id: { $in: ids } }, { projection: { _id: 0 } }).toArray()) as CampaignCommitment[];
    const paid = new Map<string, number>();
    for (const r of rows) {
      paid.set(r.campaign_id, (paid.get(r.campaign_id) || 0) + this.effectivePaidMinor(r));
    }
    for (const camp of campaigns) {
      if ((paid.get(camp.id) || 0) > 0) backed.add(camp.id);
    }
    return backed;
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
      refunded_amount_minor: 0,
      refund_refs: [],
      finalization_mismatch: null,
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
    if (row.status === 'captured' || row.status === 'refunded') { await this.publishIfFunded(row.campaign_id); return row; }   // idempotent
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
    // M19 D6 — the provider result must match the SERVER snapshot before it is
    // allowed to count as paid (amount + currency). A mismatch is recorded and
    // the campaign is NOT published.
    const mismatch = this.snapshotMismatch(row, cap.amount_captured_minor, cap.currency);
    if (mismatch) {
      await c.updateOne(
        { id: commitmentId, status: { $in: ['created', 'checkout_created', 'pending'] } },
        { $set: {
          status: 'pending',
          provider_capture_id: cap.provider_capture_id,
          finalization_mismatch: mismatch,
          updated_at: new Date(),
        } },
      );
      throw new HttpError(409, `Campaign Commitment Deposit could not be finalized: ${mismatch}`);
    }
    await c.updateOne(
      { id: commitmentId, status: { $in: ['created', 'checkout_created', 'pending'] } },
      { $set: {
        status: 'captured',
        provider_capture_id: cap.provider_capture_id,
        captured_amount_minor: cap.amount_captured_minor,
        finalization_mismatch: null,
        captured_at: new Date(), updated_at: new Date(),
      } },
    );
    await this.publishIfFunded(row.campaign_id);
    return (await c.findOne({ id: commitmentId }, { projection: { _id: 0 } })) as CampaignCommitment;
  },

  /** Server snapshot verification shared by the return route and the webhook. */
  snapshotMismatch(row: CampaignCommitment, amountMinor: number, currency?: string | null): string | null {
    if (currency && String(currency).toUpperCase() !== row.currency) {
      return `currency mismatch (expected ${row.currency})`;
    }
    if (!Number.isFinite(amountMinor) || Math.round(amountMinor) !== row.amount_minor) {
      return `amount mismatch (expected ${(row.amount_minor / 100).toFixed(2)} ${row.currency})`;
    }
    return null;
  },

  /**
   * M19 D6 — AUTHORITATIVE PROVIDER EVENT finalization. Used by the verified
   * provider webhook when the money is already captured on the provider side,
   * so the campaign never depends on the brand returning to WaveLead.
   *
   * Idempotent, snapshot-verified and provider-agnostic: the caller passes
   * canonical values (order id, capture id, amount, currency), never a raw
   * provider payload.
   */
  async finalizeCapturedFromProviderEvent(
    providerOrderId: string, providerCaptureId: string, amountMinor: number, currency: string,
  ): Promise<CampaignCommitment | null> {
    const c = await coll();
    const row = (await c.findOne({ provider_order_id: providerOrderId }, { projection: { _id: 0 } })) as CampaignCommitment | null;
    if (!row) return null;                                   // not a commitment order
    if (row.payment_purpose !== CAMPAIGN_COMMITMENT_DEPOSIT) return null;
    if (!row.campaign_id) return null;

    if (row.status === 'captured' || row.status === 'refunded') {
      await this.publishIfFunded(row.campaign_id);            // idempotent
      return row;
    }
    const mismatch = this.snapshotMismatch(row, amountMinor, currency);
    if (mismatch) {
      await c.updateOne({ id: row.id }, { $set: { finalization_mismatch: mismatch, updated_at: new Date() } });
      return (await c.findOne({ id: row.id }, { projection: { _id: 0 } })) as CampaignCommitment;
    }
    await c.updateOne(
      { id: row.id, status: { $in: ['created', 'checkout_created', 'pending'] } },
      { $set: {
        status: 'captured',
        provider_capture_id: providerCaptureId || row.provider_capture_id,
        captured_amount_minor: amountMinor,
        finalization_mismatch: null,
        captured_at: new Date(), updated_at: new Date(),
      } },
    );
    await this.publishIfFunded(row.campaign_id);
    return (await c.findOne({ id: row.id }, { projection: { _id: 0 } })) as CampaignCommitment;
  },

  /**
   * M19 D6 — refund / reversal of a Campaign Commitment Deposit.
   *
   * Idempotent per provider refund reference. NEVER cancels creator bookings
   * and never erases marketplace obligations: it only recomputes the campaign
   * funding state (see reconcileFundingState).
   */
  async recordRefundOrReversal(
    providerOrderId: string, amountMinor: number, refundRef: string,
  ): Promise<CampaignCommitment | null> {
    const c = await coll();
    const row = (await c.findOne({ provider_order_id: providerOrderId }, { projection: { _id: 0 } })) as CampaignCommitment | null;
    if (!row) return null;
    if (row.payment_purpose !== CAMPAIGN_COMMITMENT_DEPOSIT) return null;
    const refs = row.refund_refs || [];
    if (refundRef && refs.includes(refundRef)) return row;    // duplicate delivery → no-op
    const amt = Math.max(0, Math.round(Number(amountMinor) || 0));
    const refundedTotal = Math.min(row.captured_amount_minor || 0, (row.refunded_amount_minor || 0) + amt);
    const fully = refundedTotal >= (row.captured_amount_minor || 0) && (row.captured_amount_minor || 0) > 0;
    await c.updateOne({ id: row.id }, {
      $set: {
        refunded_amount_minor: refundedTotal,
        status: (fully ? 'refunded' : row.status) as CommitmentStatus,
        refund_refs: refundRef ? [...refs, refundRef] : refs,
        updated_at: new Date(),
      },
    });
    await this.reconcileFundingState(row.campaign_id);
    return (await c.findOne({ id: row.id }, { projection: { _id: 0 } })) as CampaignCommitment;
  },

  /**
   * Financial-state-aware funding reconciliation. Called after a refund /
   * reversal, after a budget change and lazily from brand/admin reads — which
   * is also how PRE-M19 legacy campaigns are normalised (NO GRANDFATHERING):
   * a legacy `open` campaign with no captured deposit falls back to
   * `commitment_required`, keeps all of its data and gets the normal 5%
   * funding path. Idempotent: it writes only when something changes and it
   * never deletes a campaign, an application, an order or any history.
   *
   *  • effective paid ≥ required          → healthy, any issue flag cleared
   *  • shortfall, NO creator bookings yet → the campaign leaves Open and
   *                                         returns to `commitment_required`
   *  • shortfall WITH creator bookings    → obligations are PRESERVED and the
   *                                         lifecycle kept; the campaign is
   *                                         flagged with a funding issue
   *
   * ISSUE FLAG (hard block on NEW obligations) is set only when the shortfall
   * comes from a refund/reversal (`refund_shortfall`) or from a campaign with
   * NO captured commitment at all (`commitment_shortfall`, e.g. legacy). A
   * pure top-up shortfall after a budget INCREASE is not an issue: there the
   * funded campaign capacity (D7) is the control, so bookings that still fit
   * inside the already funded capacity remain possible.
   */
  async reconcileFundingState(campaignId: string): Promise<{ shortfall_minor: number; issue: string | null; status: string | null }> {
    const campaign = await brandCampaignRepo.findById(campaignId);
    if (!campaign) return { shortfall_minor: 0, issue: null, status: null };
    const sum = await this.summary(campaignId);
    const shortfall = sum.topup_required_minor;
    const patch: Record<string, unknown> = {};
    const want = (k: string, v: unknown, current: unknown) => {
      if (JSON.stringify(v ?? null) !== JSON.stringify(current ?? null)) patch[k] = v;
    };

    if (shortfall <= 0) {
      want('commitment_issue_state', null, campaign.commitment_issue_state);
      want('commitment_issue_shortfall_minor', 0, campaign.commitment_issue_shortfall_minor);
      want('commitment_topup_required_minor', 0, campaign.commitment_topup_required_minor);
      if (campaign.commitment_issue_state) patch.commitment_issue_detected_at = null;
      if (Object.keys(patch).length) await brandCampaignRepo.update(campaignId, patch as never);
      return { shortfall_minor: 0, issue: null, status: campaign.status };
    }

    const { brandCampaignService } = await import('@/lib/services/brandCampaignService');
    const committed = await brandCampaignService.committedBookingValueMinor(campaignId);
    // Cause of the shortfall decides whether NEW obligations are hard-blocked.
    const cause: 'refund_shortfall' | 'commitment_shortfall' | null =
      sum.refunded_commitment_minor > 0 ? 'refund_shortfall'
        : sum.paid_commitment_minor === 0 ? 'commitment_shortfall'
          : null;                                   // pure top-up shortfall → D7 capacity governs

    want('commitment_topup_required_minor', shortfall, campaign.commitment_topup_required_minor);
    want('commitment_issue_state', cause, campaign.commitment_issue_state);
    want('commitment_issue_shortfall_minor', cause ? shortfall : 0, campaign.commitment_issue_shortfall_minor);
    if (cause && !campaign.commitment_issue_detected_at) patch.commitment_issue_detected_at = new Date();

    let nextStatus = campaign.status as string;
    // Only a genuine funding ISSUE takes a live campaign out of Open. A pure
    // top-up shortfall after a budget increase keeps the campaign running
    // (applications, review, shortlist, approve) — the funded campaign
    // capacity (D7) is what limits NEW bookings there.
    if (cause && committed.total_minor === 0 && ['open', 'in_selection'].includes(campaign.status)) {
      // No creator obligation exists yet → the campaign simply stops being Open.
      patch.status = 'commitment_required';
      patch.commitment_funded_at = null;
      nextStatus = 'commitment_required';
    }
    // With existing bookings the lifecycle is preserved on purpose: the
    // obligations, payouts and Payment Protection of those bookings stay valid.
    if (Object.keys(patch).length) await brandCampaignRepo.update(campaignId, patch as never);
    return { shortfall_minor: shortfall, issue: cause, status: nextStatus };
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
    // A previously flagged funding shortfall is resolved by this capture.
    if (campaign.commitment_issue_state) {
      await brandCampaignRepo.update(campaignId, {
        commitment_issue_state: null,
        commitment_issue_shortfall_minor: 0,
        commitment_issue_detected_at: null,
        commitment_topup_required_minor: 0,
      } as never);
    }
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
