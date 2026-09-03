// M11-Batch2B — Verified Owner Activation ($1 SANDBOX).
//
// Domain contract:
//   • Ownership approval is authoritative (channel.verification_status /
//     channel.owner_id). Activation NEVER proves ownership.
//   • Only owners of an ownership-approved channel can start activation.
//   • Amount is server-derived (100 USD minor). Client cannot influence it.
//   • Browser return can trigger capture but MUST NOT authoritatively mark
//     the channel active — activation active is only set when
//     (payment.status === 'captured_finalized') which requires the actual
//     PayPal fee to be known and credit to be issued exactly once.
//   • Credit issuance is idempotent via a unique idempotency key on
//     wavelead_credit_events, protecting against duplicate browser-return,
//     webhook replay, or provider retries.
//   • Refund → activation_status='revoked'; ownership relationship untouched.
//   • SANDBOX-ONLY in Batch 2B. If PayPal is configured as live and the CTA
//     is called we refuse with 503. LIVE unlock is a separate release.
import { v4 as uuidv4 } from 'uuid';
import { HttpError, requireAuth, ROLES, rankOf } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { readActiveEnvironment } from '@/lib/services/payments/paypalConfigService';
import { isActivationRequired, isActivationLiveCheckoutEnabled } from '@/lib/services/payments/activationFlag';
import { getConfiguredOrigin } from '@/lib/utils/canonicalOrigin';
import type {
  Actor,
  Channel,
  ChannelActivationPayment,
  ActivationPaymentStatus,
  WaveLeadCreditEvent,
} from '@/lib/types';

// Server-owned activation amount. Client CANNOT influence this value.
export const ACTIVATION_AMOUNT_MINOR = 100;   // $1.00 USD
export const ACTIVATION_CURRENCY = 'USD' as const;
export const ACTIVATION_PURPOSE = 'CHANNEL_OWNER_ACTIVATION' as const;

async function payCol() { return getCollection<ChannelActivationPayment>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS); }
async function creditCol() { return getCollection<WaveLeadCreditEvent>(COLLECTIONS.WAVELEAD_CREDIT_EVENTS); }

async function currentEnvironment(): Promise<'sandbox' | 'live'> {
  const r = await readActiveEnvironment();
  return r.environment;
}

// M11-Batch2B controlled LIVE rollout. Owner-Activation checkout is allowed:
//   • SANDBOX — always (unchanged behavior).
//   • LIVE    — ONLY when the narrow capability flag
//               CHANNEL_OWNER_ACTIVATION_LIVE_ENABLED is ON. This is the sole
//               activation-domain unlock; global PayPal env/credential
//               protections (paypalConfigService fail-closed) are untouched,
//               and the Founding Lifetime domain is unaffected.
async function assertActivationCheckoutAllowed(): Promise<'sandbox' | 'live'> {
  const env = await currentEnvironment();
  if (env === 'live' && !isActivationLiveCheckoutEnabled()) {
    throw new HttpError(503, 'Verified Owner Activation LIVE checkout is not enabled yet. It unlocks only after the controlled $1 production smoke passes.');
  }
  return env;
}

function assertOwnershipApproved(channel: Channel): void {
  const approved = channel.verification_status === 'verified' || channel.verification_status === 'official';
  if (!approved || !channel.owner_id) {
    throw new HttpError(400, 'Ownership must be approved before activation. Complete ownership verification first.');
  }
}

async function assertOwner(actor: Actor | null, channel: Channel): Promise<void> {
  requireAuth(actor);
  const isOwner = channel.owner_id === actor!.user.id;
  const isAdmin = rankOf(actor!.user.role) >= rankOf(ROLES.ADMIN);
  if (!isOwner && !isAdmin) throw new HttpError(403, 'Only the verified channel owner can activate this channel');
}

// Public-safe projection returned to owners. Never includes provider raw.
export function toOwnerPaymentView(p: ChannelActivationPayment) {
  return {
    id: p.id,
    channel_id: p.channel_id,
    purpose: p.purpose,
    provider: p.provider,
    provider_environment: p.provider_environment,
    currency: p.currency,
    gross_amount_minor: p.gross_amount_minor,
    amount_captured_minor: p.amount_captured_minor,
    amount_refunded_minor: p.amount_refunded_minor,
    provider_fee_minor: p.provider_fee_minor,
    provider_net_minor: p.provider_net_minor,
    status: p.status,
    approve_url: p.approve_url,
    return_url: p.return_url,
    cancel_url: p.cancel_url,
    captured_at: p.captured_at,
    finalized_at: p.finalized_at,
    refunded_at: p.refunded_at,
    created_at: p.created_at,
  };
}

async function transition(
  id: string,
  fromStatuses: ActivationPaymentStatus[],
  toStatus: ActivationPaymentStatus,
  patch: Partial<ChannelActivationPayment> = {},
): Promise<ChannelActivationPayment | null> {
  const c = await payCol();
  const now = new Date();
  const res = await c.findOneAndUpdate(
    { id, status: { $in: fromStatuses } },
    { $set: { ...patch, status: toStatus, updated_at: now } },
    { returnDocument: 'after' } as { returnDocument: 'after' },
  );
  const doc = ((res as unknown as { value?: ChannelActivationPayment }).value ?? (res as unknown as ChannelActivationPayment | null));
  return doc || null;
}

// Idempotently issue exactly one ACTIVATION_CREDIT_ISSUED event per payment.
// The unique index on `idempotency_key` guarantees no duplicate row survives.
async function issueActivationCredit(payment: ChannelActivationPayment): Promise<'issued' | 'already_issued' | 'blocked_no_fee'> {
  if (payment.provider_fee_minor === null || payment.provider_net_minor === null) return 'blocked_no_fee';
  const credit_minor = payment.provider_net_minor;
  if (credit_minor <= 0) return 'blocked_no_fee';
  const doc: WaveLeadCreditEvent = {
    id: uuidv4(),
    user_id: payment.owner_user_id,
    currency: 'USD',
    amount_minor: credit_minor,
    event_type: 'ACTIVATION_CREDIT_ISSUED',
    source_type: 'channel_activation_payment',
    source_id: payment.id,
    provider_capture_id: payment.provider_capture_id,
    idempotency_key: `activation_credit:${payment.id}`,
    created_at: new Date(),
  };
  try {
    const c = await creditCol();
    await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<WaveLeadCreditEvent>);
    return 'issued';
  } catch (e) {
    const msg = (e as { message?: string })?.message || '';
    if (msg.includes('E11000') || msg.includes('duplicate key')) return 'already_issued';
    throw e;
  }
}

// Idempotently append exactly ONE ACTIVATION_CREDIT_REVERSED event with a
// negative amount equal to the original issuance. The unique index on
// idempotency_key = 'activation_credit_reversal:{payment_id}' is the load-
// bearing invariant that prevents duplicates under refund webhook replay,
// browser callback, admin reconcile retries, or provider retry storms.
//
// If no prior ACTIVATION_CREDIT_ISSUED row exists for this payment (e.g., the
// fee was never reconciled before the refund), we skip \u2014 the credit
// balance was never incremented for this payment, so nothing to reverse.
async function ensureCreditReversedForPayment(payment: ChannelActivationPayment): Promise<'reversed' | 'already_reversed' | 'no_credit_to_reverse'> {
  const c = await creditCol();
  const issued = await c.findOne({
    source_type: 'channel_activation_payment',
    source_id: payment.id,
    event_type: 'ACTIVATION_CREDIT_ISSUED',
  });
  if (!issued) return 'no_credit_to_reverse';
  const reversalDoc: WaveLeadCreditEvent = {
    id: uuidv4(),
    user_id: issued.user_id,
    currency: issued.currency,
    amount_minor: -Math.abs(issued.amount_minor),   // strict negative mirror
    event_type: 'ACTIVATION_CREDIT_REVERSED',
    source_type: 'channel_activation_payment',
    source_id: payment.id,
    provider_capture_id: payment.provider_capture_id,
    idempotency_key: `activation_credit_reversal:${payment.id}`,
    created_at: new Date(),
  };
  try {
    await c.insertOne(reversalDoc as unknown as import('mongodb').OptionalUnlessRequiredId<WaveLeadCreditEvent>);
    return 'reversed';
  } catch (e) {
    const msg = (e as { message?: string })?.message || '';
    if (msg.includes('E11000') || msg.includes('duplicate key')) return 'already_reversed';
    throw e;
  }
}

async function tryFinalize(paymentId: string): Promise<ChannelActivationPayment | null> {  const c = await payCol();
  const p = await c.findOne({ id: paymentId });
  if (!p) return null;
  if (p.status === 'captured_finalized') return p;
  if (p.status !== 'captured_pending_fee') return p;
  if (p.provider_fee_minor === null || p.provider_net_minor === null) return p;
  const credit = await issueActivationCredit(p);
  if (credit === 'blocked_no_fee') return p;
  // Flip payment to captured_finalized (idempotent under the transition guard).
  const finalized = await transition(paymentId, ['captured_pending_fee'], 'captured_finalized', { finalized_at: new Date() });
  // Flip the channel to activation_status='active' (idempotent).
  await channelRepo.update(p.channel_id, {
    activation_status: 'active',
    activation_active_at: new Date(),
    activation_revoked_at: null,
  } as unknown as Partial<Channel>);
  return finalized || (await c.findOne({ id: paymentId }));
}

export const channelActivationService = {
  ACTIVATION_AMOUNT_MINOR,
  ACTIVATION_CURRENCY,
  ACTIVATION_PURPOSE,

  // Snapshot for the owner dashboard: latest payment + activation state + credit balance.
  async getStateForOwner(actor: Actor | null, channelId: string) {
    requireAuth(actor);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    await assertOwner(actor, channel);
    const c = await payCol();
    const latest = await c.find({ channel_id: channelId }).sort({ created_at: -1 }).limit(1).next();
    const activation_status = channel.activation_status || 'not_required';
    const ownershipApproved = channel.verification_status === 'verified' || channel.verification_status === 'official';
    return {
      channel_id: channel.id,
      ownership_status: ownershipApproved ? 'approved' : 'pending',
      activation_status,
      activation_active_at: channel.activation_active_at || null,
      activation_revoked_at: channel.activation_revoked_at || null,
      environment: await currentEnvironment(),
      activation_required: isActivationRequired(),
      activation_amount_minor: ACTIVATION_AMOUNT_MINOR,
      currency: ACTIVATION_CURRENCY,
      latest_payment: latest ? toOwnerPaymentView(latest) : null,
    };
  },

  // Kick off the sandbox activation checkout.
  async startActivation(actor: Actor | null, channelId: string, requestOrigin?: string) {
    await assertActivationCheckoutAllowed();
    requireAuth(actor);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    await assertOwner(actor, channel);
    assertOwnershipApproved(channel);
    if (channel.activation_status === 'active') throw new HttpError(409, 'Activation already active for this channel');
    // Refuse a second checkout if a non-terminal one already exists.
    const c = await payCol();
    const openOne = await c.find({
      channel_id: channelId,
      status: { $in: ['created', 'checkout_created', 'pending', 'captured_pending_fee'] },
    }).limit(1).next();
    if (openOne) return toOwnerPaymentView(openOne);

    const id = uuidv4();
    const now = new Date();
    const base = (requestOrigin || getConfiguredOrigin() || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/dashboard/channels/${channelId}?activation=${id}&status=paid`;
    const cancel_url = `${base}/dashboard/channels/${channelId}?activation=${id}&status=cancelled`;
    const provider = getPaymentProvider();
    const doc: ChannelActivationPayment = {
      id, channel_id: channelId, owner_user_id: channel.owner_id!,
      purpose: ACTIVATION_PURPOSE,
      provider: 'paypal',
      provider_environment: await currentEnvironment(),
      currency: ACTIVATION_CURRENCY,
      gross_amount_minor: ACTIVATION_AMOUNT_MINOR,
      amount_captured_minor: 0,
      amount_refunded_minor: 0,
      provider_fee_minor: null,
      provider_net_minor: null,
      status: 'created',
      provider_order_id: null,
      provider_capture_id: null,
      approve_url: null,
      return_url,
      cancel_url,
      captured_at: null, finalized_at: null, refunded_at: null,
      created_at: now, updated_at: now,
    };
    await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<ChannelActivationPayment>);
    // The earlier guard already rejected activation_status === 'active'.
    // Flip channel activation to pending on the first checkout attempt.
    await channelRepo.update(channelId, { activation_status: 'pending' } as unknown as Partial<Channel>);
    try {
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: ACTIVATION_AMOUNT_MINOR,
        currency: ACTIVATION_CURRENCY,
        description: `WaveLead Verified Owner Activation — ${channel.name.slice(0, 60)}`,
        return_url, cancel_url,
        // Payment provider metadata reuses the campaign_id slot for domain isolation
        // (activation_id is stored here so mock/test providers can find the row).
        metadata: { campaign_id: id, owner_user_id: channel.owner_id! },
      });
      const updated = await transition(id, ['created'], 'checkout_created', {
        provider_order_id: created.provider_order_id,
        approve_url: created.approve_url,
      });
      return toOwnerPaymentView(updated || (await c.findOne({ id }))!);
    } catch (err) {
      await transition(id, ['created', 'checkout_created', 'pending'], 'failed');
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  // Server-side capture. Callable from browser-return AND webhook — both
  // idempotent because status transitions guard against re-entry AND credit
  // insert is idempotent on a unique key.
  //
  // IMPORTANT: browser-return path does NOT authoritatively flip activation
  // to 'active'; it only advances the payment lifecycle to `captured_pending_fee`
  // or (if the PayPal capture response happens to include fee/net) all the
  // way to `captured_finalized` on the SAME server code path. Either way,
  // activation → 'active' requires fee/net to be non-null and credit to be
  // issued. Missing fee → the row stays `captured_pending_fee` and the admin
  // reconciler picks it up.
  async captureAndReconcile(paymentId: string): Promise<ChannelActivationPayment | null> {
    const c = await payCol();
    const p = await c.findOne({ id: paymentId });
    if (!p) throw new HttpError(404, 'Activation payment not found');
    if (p.status === 'captured_finalized' || p.status === 'refunded' || p.status === 'partially_refunded') return p;
    if (!p.provider_order_id) throw new HttpError(400, 'No provider order id on this activation payment');
    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: p.provider_order_id });
    if (cap.internal_status !== 'paid') {
      const next: ActivationPaymentStatus = cap.internal_status === 'failed' ? 'failed' : cap.internal_status === 'cancelled' ? 'cancelled' : 'pending';
      await transition(paymentId, ['created', 'checkout_created', 'pending'], next, {
        provider_capture_id: cap.provider_capture_id,
        amount_captured_minor: cap.amount_captured_minor,
      });
      return c.findOne({ id: paymentId });
    }
    // Paid. Move to captured_pending_fee unless fee is inline.
    const fee = cap.provider_fee_minor ?? null;
    const net = cap.provider_net_minor ?? (fee === null ? null : Math.max(0, cap.amount_captured_minor - fee));
    await transition(paymentId, ['created', 'checkout_created', 'pending'], 'captured_pending_fee', {
      provider_capture_id: cap.provider_capture_id,
      amount_captured_minor: cap.amount_captured_minor,
      provider_fee_minor: fee,
      provider_net_minor: net,
      captured_at: new Date(),
    });
    // If fee already known, finalize immediately in the same request.
    if (fee !== null && net !== null) {
      return tryFinalize(paymentId);
    }
    return c.findOne({ id: paymentId });
  },

  // Admin-triggered fee backfill for captures whose fee wasn't inline.
  // Reuses the payment provider's retrieveCapture endpoint when available.
  async adminReconcileFeeFromProvider(actor: Actor | null, paymentId: string) {
    requireAuth(actor);
    if (rankOf(actor!.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin only');
    const c = await payCol();
    const p = await c.findOne({ id: paymentId });
    if (!p) throw new HttpError(404, 'Activation payment not found');
    if (!p.provider_capture_id) throw new HttpError(400, 'Payment has no capture id yet');
    if (p.status !== 'captured_pending_fee') throw new HttpError(400, `Nothing to reconcile in status ${p.status}`);
    const provider = getPaymentProvider();
    if (!provider.retrieveCapture) throw new HttpError(400, 'Provider does not support capture retrieval');
    const details = await provider.retrieveCapture({ provider_capture_id: p.provider_capture_id });
    if (details.provider_fee_minor === null || details.provider_net_minor === null) {
      throw new HttpError(409, 'Provider did not return a seller_receivable_breakdown yet — try again later');
    }
    await c.updateOne({ id: paymentId, provider_fee_minor: null }, {
      $set: { provider_fee_minor: details.provider_fee_minor, provider_net_minor: details.provider_net_minor, updated_at: new Date() },
    });
    return tryFinalize(paymentId);
  },

  // Refund path. Applies the activation-only revocation: activation flips to
  // 'revoked' and public "Owner Verified" state stops rendering, but the
  // channel.owner_id + verification_status stay intact.
  //
  // If credit was already issued for this activation, we MUST append exactly
  // ONE reversing WaveLead Credit event so the derived balance returns to
  // its pre-activation amount. The ledger stays append-only \u2014 we never
  // mutate or delete the original ACTIVATION_CREDIT_ISSUED row.
  //
  // Reversal is idempotent via the unique index on `idempotency_key`
  // (`activation_credit_reversal:{payment_id}`). Duplicate refund webhooks,
  // browser callbacks, and provider retries all coalesce to one -N event.
  async recordRefund(paymentId: string, refund_amount_minor: number): Promise<ChannelActivationPayment | null> {
    const c = await payCol();
    const p = await c.findOne({ id: paymentId });
    if (!p) return null;
    if (p.status === 'refunded') {
      // Still ensure a reversal event exists in case the previous refund
      // record was written without one (defensive; idempotent by unique key).
      await ensureCreditReversedForPayment(p);
      return p;
    }
    const newRefunded = p.amount_refunded_minor + refund_amount_minor;
    const nextStatus: ActivationPaymentStatus = newRefunded >= p.amount_captured_minor ? 'refunded' : 'partially_refunded';
    await c.updateOne({ id: paymentId }, { $set: { amount_refunded_minor: newRefunded, status: nextStatus, refunded_at: new Date(), updated_at: new Date() } });
    // Activation revocation policy: any refund of an activation flips the
    // channel back out of 'active'. Ownership remains authoritative.
    await channelRepo.update(p.channel_id, {
      activation_status: 'revoked',
      activation_revoked_at: new Date(),
    } as unknown as Partial<Channel>);
    // Reverse the credit exactly once. If credit was never issued (fee was
    // not yet reconciled at refund time), we skip \u2014 the balance was
    // never incremented for this payment.
    await ensureCreditReversedForPayment({ ...p, amount_refunded_minor: newRefunded, status: nextStatus });
    return c.findOne({ id: paymentId });
  },

  // Read-only utility used by tests + the owner-return route.
  async findByProviderOrderId(provider_order_id: string): Promise<ChannelActivationPayment | null> {
    const c = await payCol();
    return c.findOne({ provider_order_id });
  },
};

export const waveLeadCreditService = {
  async getBalance(userId: string): Promise<{ currency: 'USD'; balance_minor: number; events_count: number }> {
    const c = await creditCol();
    const rows = await c.find({ user_id: userId }).toArray();
    let sum = 0;
    for (const r of rows) sum += r.amount_minor;
    return { currency: 'USD', balance_minor: sum, events_count: rows.length };
  },
  async listMyEvents(actor: Actor | null, limit = 50) {
    requireAuth(actor);
    const c = await creditCol();
    const rows = await c.find({ user_id: actor!.user.id }).sort({ created_at: -1 }).limit(limit).toArray();
    return rows.map((r) => ({
      id: r.id,
      currency: r.currency,
      amount_minor: r.amount_minor,
      event_type: r.event_type,
      source_type: r.source_type,
      source_id: r.source_id,
      created_at: r.created_at,
    }));
  },
};
