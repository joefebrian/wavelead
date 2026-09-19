// M17 — Owner Verification (Fast $1 path + Manual free path support).
//
// PRODUCT MODEL (three separate concepts, never conflated):
//   A. LISTING APPROVAL     — admin moderation of the submitted listing
//                             (channel.status === 'approved').
//   B. OWNER VERIFICATION   — Fast ($1) or Manual (free).
//   C. PAYOUT SETUP         — external payout destination for earnings.
//
// FAST VERIFICATION CONTRACT:
//   payment alone NEVER makes an account Owner Verified. All of the following
//   must be true before verification_status flips to 'verified':
//     1. listing approved by admin
//     2. authenticated eligible submitter/claimant
//     3. authoritative $1 capture finalized (existing Owner Activation domain)
//     4. Owner Identity Profile complete
//     5. owner declaration accepted
//     6. payout destination configured
//   No SECOND human ownership approval is required on the fast path.
//   Intermediate states: 'payment_completed' → 'identity_required' → verified.
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { HttpError, requireAuth, ROLES, rankOf } from '@/lib/auth/rbac';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { ownerPayoutMethodRepo } from '@/lib/repositories/marketplaceRepo';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { readActiveEnvironment } from '@/lib/services/payments/paypalConfigService';
import { getConfiguredOrigin } from '@/lib/utils/canonicalOrigin';
import { normalizeCountryCode } from '@/lib/constants/countries';
import { channelActivationService, ACTIVATION_AMOUNT_MINOR, ACTIVATION_CURRENCY, ACTIVATION_PURPOSE } from './channelActivationService';
import type { Actor, Channel, ChannelActivationPayment } from '@/lib/types';

export const OWNER_DECLARATION_TEXT =
  'I confirm that I am authorized to manage this WhatsApp Channel and that the information I provided is accurate.';
export const OWNER_DECLARATION_VERSION = 'owner-declaration-v1';

export type OwnerIdentityRole = 'owner' | 'manager' | 'authorized_representative';

export interface OwnerIdentityProfile {
  id: string;
  user_id: string;
  channel_id: string;
  full_legal_name: string;
  country_code: string;
  city: string;
  email: string;
  mobile_number: string;
  role_in_channel: OwnerIdentityRole;
  company_name: string | null;
  declaration_accepted: boolean;
  declaration_accepted_at: Date | null;
  declaration_version: string | null;
  activation_payment_id: string | null;
  activation_payment_reference_masked: string | null;
  submitted_at: Date;
  created_at: Date;
  updated_at: Date;
}

export const ownerIdentitySchema = z.object({
  full_legal_name: z.string().trim().min(3, 'Full legal name is required').max(160),
  country_code: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2, 'City is required').max(120),
  email: z.string().trim().toLowerCase().email('Valid email required').max(200),
  mobile_number: z.string().trim().min(6, 'Mobile / WhatsApp number is required').max(32)
    .regex(/^[+0-9][0-9\s()-]{5,31}$/, 'Enter a valid phone number'),
  role_in_channel: z.enum(['owner', 'manager', 'authorized_representative']),
  company_name: z.string().trim().max(200).optional().or(z.literal('')),
  declaration_accepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the owner declaration' }) }),
});

async function identityCol() { return getCollection<OwnerIdentityProfile>(COLLECTIONS.OWNER_IDENTITY_PROFILES); }
async function payCol() { return getCollection<ChannelActivationPayment>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS); }

async function currentEnvironment(): Promise<string> {
  try { const r = await readActiveEnvironment(); return (r?.environment as string) || 'sandbox'; } catch { return 'sandbox'; }
}

function maskRef(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length <= 6 ? `${v.slice(0, 2)}****` : `${v.slice(0, 4)}****${v.slice(-2)}`;
}

/** Listing approval is a precondition for ANY owner-verification path. */
function assertListingApproved(channel: Channel): void {
  if (channel.status !== 'approved') {
    throw new HttpError(409, 'This channel listing has not been approved yet. Owner verification opens once the listing is approved.');
  }
}

/**
 * Fast-verification eligibility. Deliberately strict: a random authenticated
 * visitor must NEVER be able to pay $1 against an arbitrary public channel.
 */
export async function assertFastVerificationEligible(actor: Actor, channel: Channel): Promise<void> {
  assertListingApproved(channel);
  const suspended = (channel as unknown as { is_suspended?: boolean; is_disputed?: boolean });
  if (suspended.is_suspended || suspended.is_disputed) {
    throw new HttpError(409, 'This channel is under review and cannot start owner verification right now.');
  }
  const alreadyVerifiedOwner = (channel.verification_status === 'verified' || channel.verification_status === 'official') && !!channel.owner_id;
  if (alreadyVerifiedOwner && channel.owner_id !== actor.user.id) {
    throw new HttpError(409, 'This channel already belongs to a verified owner.');
  }
  if (channel.owner_id && channel.owner_id !== actor.user.id) {
    throw new HttpError(403, 'Only the original submitter or the eligible claimant can verify this channel.');
  }
  const submittedBy = (channel as unknown as { submitted_by?: string | null }).submitted_by || null;
  const isSubmitter = !!submittedBy && submittedBy === actor.user.id;
  const isCurrentOwner = channel.owner_id === actor.user.id;
  if (!isSubmitter && !isCurrentOwner) {
    // Fall back to an approved/pending claim by this user, if the claim
    // architecture already recognises them as an eligible claimant.
    const claims = await getCollection<{ channel_id: string; claimant_user_id?: string; user_id?: string; status: string }>(COLLECTIONS.CHANNEL_CLAIMS);
    const claim = await claims.findOne({
      channel_id: channel.id,
      $or: [{ claimant_user_id: actor.user.id }, { user_id: actor.user.id }],
      status: { $in: ['pending', 'needs_information', 'approved'] },
    } as never);
    if (!claim) {
      throw new HttpError(403, 'Only the original submitter or an eligible claimant can start Fast Verification for this channel.');
    }
  }
}

async function payoutConfigured(userId: string): Promise<boolean> {
  const m = await ownerPayoutMethodRepo.findActiveByOwner(userId).catch(() => null);
  return !!m;
}

async function latestFastPayment(channelId: string, userId: string): Promise<ChannelActivationPayment | null> {
  const c = await payCol();
  return c.find({ channel_id: channelId, owner_user_id: userId } as never)
    .sort({ created_at: -1 }).limit(1).next();
}

export type FastVerificationStep =
  | 'ineligible'
  | 'ready_to_pay'
  | 'payment_pending'
  | 'payment_completed'
  | 'identity_required'
  | 'payout_required'
  | 'verified';

export const ownerVerificationService = {
  OWNER_DECLARATION_TEXT,
  OWNER_DECLARATION_VERSION,
  FAST_AMOUNT_MINOR: ACTIVATION_AMOUNT_MINOR,
  FAST_CURRENCY: ACTIVATION_CURRENCY,

  /** Owner-facing state machine for the dashboard. Never exposes private PII of others. */
  async getState(actor: Actor | null, channelId: string) {
    requireAuth(actor);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const isSelf = channel.owner_id === actor!.user.id
      || (channel as unknown as { submitted_by?: string }).submitted_by === actor!.user.id;
    const isAdmin = rankOf(actor!.user.role) >= rankOf(ROLES.ADMIN);
    if (!isSelf && !isAdmin) throw new HttpError(403, 'Not authorized for this channel');

    const ic = await identityCol();
    const identity = await ic.findOne({ channel_id: channelId, user_id: actor!.user.id });
    const payment = await latestFastPayment(channelId, actor!.user.id);
    const payout = await payoutConfigured(actor!.user.id);
    const verified = channel.verification_status === 'verified' || channel.verification_status === 'official';
    const paymentFinalized = payment?.status === 'captured_finalized';
    const identityComplete = !!identity && identity.declaration_accepted;

    let step: FastVerificationStep = 'ready_to_pay';
    if (channel.status !== 'approved') step = 'ineligible';
    else if (verified && channel.activation_status === 'active') step = 'verified';
    else if (!payment || ['failed', 'cancelled'].includes(payment.status)) step = 'ready_to_pay';
    else if (!paymentFinalized) step = 'payment_pending';
    else if (!identityComplete) step = 'identity_required';
    else if (!payout) step = 'payout_required';
    else step = 'payment_completed';

    return {
      channel_id: channel.id,
      channel_name: channel.name,
      listing_approved: channel.status === 'approved',
      step,
      fast_amount_minor: ACTIVATION_AMOUNT_MINOR,
      currency: ACTIVATION_CURRENCY,
      manual_path_free: true,
      requirements: {
        listing_approved: channel.status === 'approved',
        payment_finalized: paymentFinalized,
        identity_complete: identityComplete,
        declaration_accepted: !!identity?.declaration_accepted,
        payout_configured: payout,
      },
      verification_status: channel.verification_status || null,
      activation_status: channel.activation_status || 'not_required',
      declaration_text: OWNER_DECLARATION_TEXT,
      environment: await currentEnvironment(),
      approve_url: payment && ['checkout_created', 'pending'].includes(payment.status) ? payment.approve_url : null,
    };
  },

  /**
   * Start the $1 Fast Verification checkout. Reuses the EXISTING Owner
   * Activation payment domain (same collection, purpose, amount, provider).
   * Rows are tagged verification_flow='fast' so finalization does NOT flip
   * the channel to active before identity + payout are complete.
   */
  async startFastVerification(actor: Actor | null, channelId: string, requestOrigin?: string) {
    requireAuth(actor);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    await assertFastVerificationEligible(actor!, channel);

    const c = await payCol();
    const open = await c.find({
      channel_id: channelId,
      status: { $in: ['created', 'checkout_created', 'pending', 'captured_pending_fee'] },
    } as never).sort({ created_at: -1 }).limit(1).next();
    if (open) return this.toPaymentView(open);
    // Duplicate protection — one finalized $1 activation per channel is enough.
    const finalized = await c.findOne({ channel_id: channelId, status: 'captured_finalized' } as never);
    if (finalized) return this.toPaymentView(finalized);

    const id = uuidv4();
    const now = new Date();
    const base = (requestOrigin || getConfiguredOrigin() || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/dashboard/channels/${channelId}/verify?activation=${id}&status=paid`;
    const cancel_url = `${base}/dashboard/channels/${channelId}/verify?activation=${id}&status=cancelled`;
    const doc = {
      id, channel_id: channelId, owner_user_id: actor!.user.id,
      purpose: ACTIVATION_PURPOSE,
      // M17 marker — fast-verification rows must NOT auto-activate on capture.
      verification_flow: 'fast',
      submitter_user_id: actor!.user.id,
      provider: 'paypal',
      provider_environment: await currentEnvironment(),
      currency: ACTIVATION_CURRENCY,
      gross_amount_minor: ACTIVATION_AMOUNT_MINOR,
      amount_captured_minor: 0,
      amount_refunded_minor: 0,
      provider_fee_minor: null, provider_net_minor: null,
      status: 'created',
      provider_order_id: null, provider_capture_id: null, approve_url: null,
      return_url, cancel_url,
      captured_at: null, finalized_at: null, refunded_at: null,
      created_at: now, updated_at: now,
    } as unknown as ChannelActivationPayment;
    await c.insertOne(doc as never);
    try {
      const provider = getPaymentProvider();
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: ACTIVATION_AMOUNT_MINOR,
        currency: ACTIVATION_CURRENCY,
        description: `WaveLead Fast Owner Verification — ${channel.name.slice(0, 60)}`,
        return_url, cancel_url,
        metadata: { campaign_id: id, owner_user_id: actor!.user.id },
      });
      await c.updateOne({ id, status: 'created' } as never, {
        $set: { status: 'checkout_created', provider_order_id: created.provider_order_id, approve_url: created.approve_url, updated_at: new Date() },
      });
      return this.toPaymentView((await c.findOne({ id } as never))!);
    } catch (err) {
      await c.updateOne({ id } as never, { $set: { status: 'failed', updated_at: new Date() } });
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  toPaymentView(p: ChannelActivationPayment) {
    return {
      id: p.id,
      status: p.status,
      gross_amount_minor: p.gross_amount_minor,
      currency: p.currency,
      approve_url: p.approve_url,
      provider_environment: p.provider_environment,
      provider_order_id_masked: maskRef(p.provider_order_id),
    };
  },

  /**
   * AUTHORITATIVE capture (browser-return or webhook). Delegates to the
   * existing activation capture pipeline; for fast rows the channel is NOT
   * activated here — finalizeIfComplete() owns that decision.
   */
  async captureFastPayment(paymentId: string) {
    const p = await channelActivationService.captureAndReconcile(paymentId);
    if (p && p.status === 'captured_finalized') {
      await this.finalizeIfComplete(p.owner_user_id, p.channel_id).catch(() => null);
    }
    return p;
  },

  /** Private Owner Identity Profile + declaration. Never public. */
  async submitIdentity(actor: Actor | null, channelId: string, input: unknown) {
    requireAuth(actor);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    await assertFastVerificationEligible(actor!, channel);
    const parsed = ownerIdentitySchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new HttpError(400, `${first?.path?.join('.') || 'field'}: ${first?.message || 'invalid'}`);
    }
    const d = parsed.data;
    const country = normalizeCountryCode(d.country_code);
    if (!country) throw new HttpError(400, 'country_code: unknown country');

    const payment = await latestFastPayment(channelId, actor!.user.id);
    const now = new Date();
    const c = await identityCol();
    const existing = await c.findOne({ channel_id: channelId, user_id: actor!.user.id });
    const doc: OwnerIdentityProfile = {
      id: existing?.id || uuidv4(),
      user_id: actor!.user.id,
      channel_id: channelId,
      full_legal_name: d.full_legal_name,
      country_code: country,
      city: d.city,
      email: d.email,
      mobile_number: d.mobile_number,
      role_in_channel: d.role_in_channel,
      company_name: d.company_name?.trim() ? d.company_name.trim() : null,
      declaration_accepted: true,
      declaration_accepted_at: now,
      declaration_version: OWNER_DECLARATION_VERSION,
      activation_payment_id: payment?.id || null,
      activation_payment_reference_masked: maskRef(payment?.provider_capture_id || payment?.provider_order_id || null),
      submitted_at: existing?.submitted_at || now,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    if (existing) await c.updateOne({ id: existing.id }, { $set: { ...doc } } as never);
    else await c.insertOne(doc as never);

    const finalized = await this.finalizeIfComplete(actor!.user.id, channelId).catch(() => null);
    return { identity: this.toPrivateView(doc), verification: finalized };
  },

  /** Owner-only private projection (admins may also read via admin surfaces). */
  toPrivateView(p: OwnerIdentityProfile) {
    return {
      id: p.id, channel_id: p.channel_id,
      full_legal_name: p.full_legal_name, country_code: p.country_code, city: p.city,
      email: p.email, mobile_number: p.mobile_number,
      role_in_channel: p.role_in_channel, company_name: p.company_name,
      declaration_accepted: p.declaration_accepted,
      declaration_accepted_at: p.declaration_accepted_at,
      declaration_version: p.declaration_version,
      submitted_at: p.submitted_at,
    };
  },

  async getIdentity(actor: Actor | null, channelId: string) {
    requireAuth(actor);
    const c = await identityCol();
    const isAdmin = rankOf(actor!.user.role) >= rankOf(ROLES.ADMIN);
    const row = isAdmin
      ? await c.find({ channel_id: channelId }).sort({ created_at: -1 }).limit(1).next()
      : await c.findOne({ channel_id: channelId, user_id: actor!.user.id });
    return row ? this.toPrivateView(row) : null;
  },

  /**
   * THE gate. Flips the channel to Owner Verified ONLY when every condition
   * is satisfied. Server-authoritative: never trusts client state. Idempotent.
   * No second admin ownership approval on the fast path.
   */
  async finalizeIfComplete(userId: string, channelId: string): Promise<{
    verified: boolean;
    blocked_by: string[];
  }> {
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const blocked: string[] = [];
    if (channel.status !== 'approved') blocked.push('listing_approval');

    const c = await payCol();
    const payment = await c.findOne({ channel_id: channelId, owner_user_id: userId, status: 'captured_finalized' } as never);
    if (!payment) blocked.push('payment');

    const ic = await identityCol();
    const identity = await ic.findOne({ channel_id: channelId, user_id: userId });
    if (!identity) blocked.push('identity');
    else if (!identity.declaration_accepted) blocked.push('declaration');

    if (!(await payoutConfigured(userId))) blocked.push('payout');

    if (blocked.length > 0) return { verified: false, blocked_by: blocked };

    const now = new Date();
    await channelRepo.update(channelId, {
      owner_id: userId,
      verification_status: 'verified',
      activation_status: 'active',
      activation_active_at: now,
      activation_revoked_at: null,
    } as unknown as Partial<Channel>);

    // Audit trail (best-effort, never blocks the commercial state).
    try {
      const audit = await getCollection<Record<string, unknown>>(COLLECTIONS.AUDIT_LOGS);
      await audit.insertOne({
        id: uuidv4(),
        action: 'owner_fast_verification_completed',
        entity_type: 'channel',
        entity_id: channelId,
        actor_user_id: userId,
        after_data: {
          verification_status: 'verified',
          activation_status: 'active',
          path: 'fast_verification',
          second_admin_approval_required: false,
          activation_payment_id: (payment as unknown as { id: string })?.id || null,
        },
        created_at: now,
      } as never);
    } catch { /* audit-only */ }

    return { verified: true, blocked_by: [] };
  },
};
