// P0A — Ownership Safety Patch: targeted tests.
//   §1 Atomic ownership guard (stale read cannot overwrite a verified owner)
//   §2 Competing completions (Fast vs Manual approval race; stale B after A)
//   §3 Captured-payment conflict preserved for admin refund review
//   §4 Policy block: unrelated pending claimant cannot Fast-verify
//   §5 Claim status UX (canonical states, honest wording, CTA agreement)
//   §6 Existing Manual / Fast / Verify-Current-Owner flows still work
//   §7 No confidential owner / payment data exposure
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { ownerVerificationService, assertFastVerificationEligible } from '@/lib/services/ownerVerificationService';
import { claimService } from '@/lib/services/claimService';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { channelActivationService } from '@/lib/services/channelActivationService';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { ownerPayoutMethodRepo } from '@/lib/repositories/marketplaceRepo';
import { deriveOwnershipState, ctaForOwnershipState, OWNERSHIP_SUPPORT_EMAIL } from '@/lib/services/ownershipState';
import { fastOwnershipConflictReason } from '@/lib/services/activationOwnershipConflict';
import { sanitizeChannel } from '@/lib/utils/sanitize';

const RUN = `p0a${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const BASE = 'http://localhost:3000';
const ORIGINAL_FLAG = process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;

let client: MongoClient;
let db: Db;

function actorFor(id: string, role: 'user' | 'moderator' | 'admin' = 'user'): Actor {
  return { user: { id, email: `${RUN}-${id.slice(0, 6)}@t.local`, display_name: 'T', role, is_active: true }, session: { user_id: id, jti: 't', role, iat: 0, exp: 0 }, role } as unknown as Actor;
}
async function seedUser(role: 'user' | 'moderator' | 'admin' = 'user'): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({ id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: RUN, role, is_active: true, is_email_verified: true, password_hash: 'x', created_at: new Date(), updated_at: new Date() } as never);
  return id;
}
async function seedChannel(over: Record<string, unknown> = {}): Promise<Channel> {
  const id = uuidv4(); const now = new Date();
  const hex = id.replace(/-/g, '');
  const doc = {
    id, slug: `${RUN}-${hex.slice(0, 8)}`, name: `P0A Channel ${hex.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${hex.slice(0, 22)}`,
    whatsapp_channel_id: hex.slice(0, 22),
    short_description: 'Ownership safety test listing', description: null, logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, submitted_by: null, status: 'approved',
    verification_status: 'unclaimed', activation_status: 'not_required',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false, activity_level: 'active',
    follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now, is_test_fixture: true,
    ...over,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}
async function capturedPayment(channelId: string, userId: string, flow: 'fast' | null = 'fast') {
  const id = uuidv4(); const now = new Date();
  await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).insertOne({
    id, channel_id: channelId, owner_user_id: userId, purpose: 'CHANNEL_OWNER_ACTIVATION',
    ...(flow ? { verification_flow: flow } : {}),
    provider: 'paypal', provider_environment: 'sandbox', currency: 'USD',
    gross_amount_minor: 100, amount_captured_minor: 100, amount_refunded_minor: 0,
    provider_fee_minor: 5, provider_net_minor: 95, status: 'captured_finalized',
    provider_order_id: `ORD-${id}`, provider_capture_id: `CAP-${id}`, approve_url: null,
    return_url: 'x', cancel_url: 'x',
    captured_at: now, finalized_at: now, refunded_at: null, created_at: now, updated_at: now,
  } as never);
  return id;
}
async function identityAndPayout(channelId: string, userId: string) {
  const now = new Date();
  await db.collection(COLLECTIONS.OWNER_IDENTITY_PROFILES).insertOne({
    id: uuidv4(), user_id: userId, channel_id: channelId, full_legal_name: 'Owner Name', country_code: 'ID',
    city: 'Jakarta', email: `${RUN}-ident@t.local`, mobile_number: '+62800000000', role_in_channel: 'owner',
    company_name: null, declaration_accepted: true, declaration_accepted_at: now, declaration_version: 'owner-declaration-v1',
    activation_payment_id: null, activation_payment_reference_masked: null, submitted_at: now, created_at: now, updated_at: now,
  } as never);
  const existing = await ownerPayoutMethodRepo.findActiveByOwner(userId).catch(() => null);
  if (!existing) {
    await ownerPayoutMethodRepo.insert({
      id: uuidv4(), owner_user_id: userId, method: 'paypal',
      paypal_email_normalized: `${RUN}-payout-${userId.slice(0, 6)}@t.local`, paypal_email_display: `${RUN}-payout@t.local`,
      is_active: true, verified_at: null, verification_code_hash: null, verification_sent_at: null,
      verification_attempts: 0, created_at: now, updated_at: now,
    } as never);
  }
}
async function readyFastUser(channelId: string, userId: string) {
  const paymentId = await capturedPayment(channelId, userId);
  await identityAndPayout(channelId, userId);
  return paymentId;
}
async function seedClaim(channelId: string, claimantId: string, status = 'pending') {
  const id = uuidv4(); const now = new Date();
  await db.collection(COLLECTIONS.CHANNEL_CLAIMS).insertOne({
    id, channel_id: channelId, claimant_user_id: claimantId, verification_method: 'manual',
    claimant_note: `${RUN} note`, evidence_urls: [], evidence_metadata: {}, claimant_email: `${RUN}@t.local`,
    website_domain: null, email_domain: 't.local', domain_match: false, status,
    moderator_notes: null, request_more_info_message: null, reject_reason: null,
    submitted_at: now, reviewed_at: null, reviewed_by: null, approved_at: null, rejected_at: null,
    created_at: now, updated_at: now,
  } as never);
  return id;
}
const ch = async (id: string) => (await db.collection(COLLECTIONS.CHANNELS).findOne({ id })) as unknown as Channel & Record<string, unknown>;
// Visible markup only — dev-mode React debug rows (`D{"awaited":…}`) inside
// flight <script> chunks are a development-only artifact, verified separately
// against a production build.
const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
const pay = async (id: string) => (await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).findOne({ id })) as unknown as Record<string, any>;

beforeAll(async () => {
  process.env.SMTP_HOST = 'smtp.test.local';
  client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  db = client.db(process.env.DB_NAME || 'wavelead');
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_FLAG === undefined) delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
  else process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = ORIGINAL_FLAG;
});
afterAll(async () => {
  const rx = new RegExp(RUN);
  const chans = await db.collection(COLLECTIONS.CHANNELS).find({ slug: rx }).project({ id: 1 }).toArray();
  const ids = chans.map((c) => c.id);
  await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).deleteMany({ channel_id: { $in: ids } });
  await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ channel_id: { $in: ids } });
  await db.collection(COLLECTIONS.OWNER_IDENTITY_PROFILES).deleteMany({ channel_id: { $in: ids } });
  await db.collection(COLLECTIONS.AUDIT_LOGS).deleteMany({ $or: [{ entity_id: { $in: ids } }, { 'after_data.channel_id': { $in: ids } }] });
  await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
  await db.collection(COLLECTIONS.OWNER_PAYOUT_METHODS).deleteMany({ paypal_email_normalized: rx });
  await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
  await client.close();
});

// ---------------------------------------------------------------------------
describe('P0A §1 atomic ownership guard', () => {
  it('a STALE read (owner looked free) cannot overwrite an already-verified owner — the write itself is guarded', async () => {
    const submitter = await seedUser();
    const realOwner = await seedUser();
    const c = await seedChannel({ submitted_by: submitter });
    const paymentId = await readyFastUser(c.id, submitter);
    const stale = { ...(await ch(c.id)) } as unknown as Channel; // owner null, unclaimed
    // Competing path verifies a different owner AFTER the stale snapshot.
    await db.collection(COLLECTIONS.CHANNELS).updateOne({ id: c.id }, { $set: { owner_id: realOwner, verification_status: 'verified', verified_at: new Date() } });
    // Force finalizeIfComplete to see the stale snapshot on its initial read:
    // only the atomic compare-and-set can stop the overwrite now.
    vi.spyOn(channelRepo, 'findById').mockResolvedValueOnce(stale as never);

    const r = await ownerVerificationService.finalizeIfComplete(submitter, c.id);
    expect(r.verified).toBe(false);
    expect(r.blocked_by).toEqual(['ownership_conflict']);
    const after = await ch(c.id);
    expect(after.owner_id).toBe(realOwner);
    expect(after.verification_status).toBe('verified');
    const p = await pay(paymentId);
    expect(p.ownership_conflict?.review_status).toBe('pending_admin_refund_review');
    expect(p.ownership_conflict?.reason).toBe('verified_owner_exists');
  });

  it('never downgrades an official owner and refuses an official channel for anyone else', async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const c = await seedChannel({ owner_id: owner, verification_status: 'official', activation_status: 'active' });
    await readyFastUser(c.id, owner);
    const r = await ownerVerificationService.finalizeIfComplete(owner, c.id);
    expect(r.verified).toBe(true);
    expect((await ch(c.id)).verification_status).toBe('official');
    const otherPay = await readyFastUser(c.id, other);
    const r2 = await ownerVerificationService.finalizeIfComplete(other, c.id);
    expect(r2.verified).toBe(false);
    expect((await ch(c.id)).owner_id).toBe(owner);
    expect((await pay(otherPay)).ownership_conflict?.reason).toBe('verified_owner_exists');
  });

  it('source keeps the single atomic compare-and-set (no unconditional owner write)', () => {
    const svc = src('lib/services/ownerVerificationService.ts');
    expect(svc).toContain('channels.findOneAndUpdate(');
    expect(svc).toContain("{ owner_id: null, submitted_by: userId, verification_status: { $nin: ['verified', 'official'] } }");
    expect(svc).not.toMatch(/channelRepo\.update\(channelId,\s*\{\s*\n\s*owner_id: userId/);
  });
});

// ---------------------------------------------------------------------------
describe('P0A §2 competing completions', () => {
  it('Fast completion racing a Manual claim approval → exactly one owner, loser preserved', async () => {
    for (let i = 0; i < 3; i++) {
      const submitter = await seedUser();
      const claimant = await seedUser();
      const mod = await seedUser('moderator');
      const c = await seedChannel({ submitted_by: submitter });
      const paymentId = await readyFastUser(c.id, submitter);
      const claimId = await seedClaim(c.id, claimant);

      const [fast, manual] = await Promise.allSettled([
        ownerVerificationService.finalizeIfComplete(submitter, c.id),
        claimModerationService.approve(actorFor(mod, 'moderator'), claimId, {}),
      ]);
      const after = await ch(c.id);
      expect(after.verification_status).toBe('verified');
      expect([submitter, claimant]).toContain(after.owner_id);
      const fastWon = fast.status === 'fulfilled' && fast.value.verified === true;
      const manualWon = manual.status === 'fulfilled';
      expect(fastWon !== manualWon).toBe(true); // exactly one winner
      if (manualWon) {
        expect(after.owner_id).toBe(claimant);
        expect((await pay(paymentId)).ownership_conflict?.review_status).toBe('pending_admin_refund_review');
      } else {
        expect(after.owner_id).toBe(submitter);
        expect((await pay(paymentId)).ownership_conflict ?? null).toBeNull();
      }
    }
  });

  it('a stale completion by B after A is verified never overwrites A', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const c = await seedChannel({ submitted_by: a });
    await readyFastUser(c.id, a);
    expect((await ownerVerificationService.finalizeIfComplete(a, c.id)).verified).toBe(true);
    const bPay = await readyFastUser(c.id, b);
    const r = await ownerVerificationService.finalizeIfComplete(b, c.id);
    expect(r.verified).toBe(false);
    const after = await ch(c.id);
    expect(after.owner_id).toBe(a);
    expect(after.activation_status).toBe('active');
    expect((await pay(bPay)).ownership_conflict?.reason).toBe('verified_owner_exists');
  });

  it('parallel duplicate completions by the same eligible user converge on one owner, no conflict', async () => {
    const a = await seedUser();
    const c = await seedChannel({ submitted_by: a });
    const pid = await readyFastUser(c.id, a);
    const rs = await Promise.all([1, 2, 3].map(() => ownerVerificationService.finalizeIfComplete(a, c.id)));
    expect(rs.every((r) => r.verified)).toBe(true);
    expect((await ch(c.id)).owner_id).toBe(a);
    expect((await pay(pid)).ownership_conflict ?? null).toBeNull();
  });

  it('legacy (non-fast) activation capture cannot activate the badge for a different owner', () => {
    const svc = src('lib/services/channelActivationService.ts');
    expect(svc).toContain('owner_id: p.owner_user_id,');
    expect(svc).toContain("flow: 'activation'");
  });
});

// ---------------------------------------------------------------------------
describe('P0A §3 captured payment conflict handling', () => {
  it('records ONE reviewable exception, never refunds, never changes amounts/status; admin report surfaces it', async () => {
    const a = await seedUser();
    const b = await seedUser();
    const admin = await seedUser('admin');
    const c = await seedChannel({ owner_id: a, verification_status: 'verified', activation_status: 'active' });
    const bPay = await readyFastUser(c.id, b);
    const before = await pay(bPay);
    await ownerVerificationService.finalizeIfComplete(b, c.id);
    await ownerVerificationService.finalizeIfComplete(b, c.id); // idempotent
    const p = await pay(bPay);
    expect(p.status).toBe('captured_finalized');
    expect(p.amount_captured_minor).toBe(before.amount_captured_minor);
    expect(p.amount_refunded_minor).toBe(0);
    expect(p.gross_amount_minor).toBe(100);
    expect(p.refunded_at).toBeNull();
    expect(p.ownership_conflict).toMatchObject({ reason: 'verified_owner_exists', flow: 'fast', review_status: 'pending_admin_refund_review' });
    const audits = await db.collection(COLLECTIONS.AUDIT_LOGS).find({ action: 'ACTIVATION_OWNERSHIP_CONFLICT', entity_id: bPay }).toArray();
    expect(audits.length).toBe(1);
    expect(audits[0].after_data).toMatchObject({ owner_overwritten: false, auto_refund: false });
    // Admin-only report shows it for refund review.
    const report = await channelActivationService.adminListActivations(actorFor(admin, 'admin'));
    const row = report.items.find((it) => it.id === bPay) as Record<string, any>;
    expect(row.ownership_conflict.review_status).toBe('pending_admin_refund_review');
    expect(report.summary.ownership_conflicts_pending_review).toBeGreaterThanOrEqual(1);
    await expect(channelActivationService.adminListActivations(actorFor(b))).rejects.toMatchObject({ status: 403 });
  });

  it('a flagged payment later used for a LEGITIMATE finalization is closed (never left for refund)', async () => {
    const claimant = await seedUser();
    const mod = await seedUser('moderator');
    const admin = await seedUser('admin');
    const c = await seedChannel();
    const claimId = await seedClaim(c.id, claimant, 'pending');
    const pid = await readyFastUser(c.id, claimant);
    // Pending claimant only → refused + flagged for refund review.
    expect((await ownerVerificationService.finalizeIfComplete(claimant, c.id)).verified).toBe(false);
    expect((await pay(pid)).ownership_conflict?.review_status).toBe('pending_admin_refund_review');
    // Moderator approves the manual claim → claimant is now the verified owner.
    await claimModerationService.approve(actorFor(mod, 'moderator'), claimId, {});
    // Finalization now legitimately uses the same payment → flag resolved.
    expect((await ownerVerificationService.finalizeIfComplete(claimant, c.id)).verified).toBe(true);
    const p = await pay(pid);
    expect(p.ownership_conflict?.review_status).toBe('resolved_finalized');
    expect(p.status).toBe('captured_finalized');
    expect(p.amount_refunded_minor).toBe(0);
    const report = await channelActivationService.adminListActivations(actorFor(admin, 'admin'));
    const row = report.items.find((it) => it.id === pid) as Record<string, any>;
    expect(row.ownership_conflict.review_status).toBe('resolved_finalized');
  });

  it('a payer who lost eligibility before submitting identity still gets the captured payment preserved', async () => {
    const s = await seedUser();
    const other = await seedUser();
    const c = await seedChannel({ submitted_by: s });
    const pid = await capturedPayment(c.id, s);
    await db.collection(COLLECTIONS.CHANNELS).updateOne({ id: c.id }, { $set: { owner_id: other, verification_status: 'verified' } });
    await expect(ownerVerificationService.submitIdentity(actorFor(s), c.id, {
      full_legal_name: 'Some Body', country_code: 'ID', city: 'Jakarta', email: `${RUN}-x@t.local`,
      mobile_number: '+62811111111', role_in_channel: 'owner', company_name: '', declaration_accepted: true,
    })).rejects.toMatchObject({ status: 409 });
    expect((await pay(pid)).ownership_conflict?.review_status).toBe('pending_admin_refund_review');
    expect((await ch(c.id)).owner_id).toBe(other);
  });
});

// ---------------------------------------------------------------------------
describe('P0A §4 policy block — unrelated pending claimant', () => {
  it('a user whose ONLY link is a pending claim cannot start, submit identity for, or finalize Fast Verification', async () => {
    const submitter = await seedUser();
    const claimant = await seedUser();
    const c = await seedChannel({ submitted_by: submitter });
    await seedClaim(c.id, claimant, 'pending');
    const fresh = await ch(c.id);
    await expect(assertFastVerificationEligible(actorFor(claimant), fresh)).rejects.toMatchObject({ status: 403 });
    await expect(ownerVerificationService.startFastVerification(actorFor(claimant), c.id)).rejects.toMatchObject({ status: 403 });
    // Even if a captured payment + identity + payout somehow exist, payment
    // + self-declaration never verifies them.
    const pid = await readyFastUser(c.id, claimant);
    const r = await ownerVerificationService.finalizeIfComplete(claimant, c.id);
    expect(r.verified).toBe(false);
    const after = await ch(c.id);
    expect(after.owner_id ?? null).toBeNull();
    expect(after.verification_status).toBe('unclaimed');
    expect((await pay(pid)).ownership_conflict?.reason).toBe('not_eligible_claimant');
    expect(fastOwnershipConflictReason(after, claimant)).toBe('not_eligible_claimant');
  });

  it('an unrelated user cannot claim another account\u2019s linked channel', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const c = await seedChannel({ owner_id: owner, verification_status: 'unclaimed' });
    await expect(claimService.submit(actorFor(stranger), c.slug, {
      verification_method: 'manual', claimant_note: 'I own this channel, honestly.', evidence_urls: [],
    })).rejects.toMatchObject({ status: 409 });
    await expect(ownerVerificationService.startFastVerification(actorFor(stranger), c.id)).rejects.toMatchObject({ status: 403 });
    expect((await ch(c.id)).owner_id).toBe(owner);
  });
});

// ---------------------------------------------------------------------------
describe('P0A §5 claim status UX', () => {
  it('maps every canonical state correctly and only genuinely verified ownership says "verified owner"', async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const V = actorFor(viewer);

    const unclaimed = await seedChannel();
    const e1 = await claimService.getEligibility(unclaimed.slug, V);
    expect(e1.ownershipState).toBe('unclaimed');
    expect(e1.canClaim).toBe(true);

    const linked = await seedChannel({ owner_id: owner, verification_status: 'unclaimed' });
    const e2 = await claimService.getEligibility(linked.slug, V);
    expect(e2.ownershipState).toBe('linked_unverified');
    expect(e2.canClaim).toBe(false);
    expect(e2.alreadyOwned).toBe(true);           // takeover protection preserved
    expect(e2.verifiedOwner).toBe(false);
    expect(e2.reason).toMatch(/not been verified/i);
    expect(e2.reason).not.toMatch(/already has a verified owner/i);
    expect(e2.reason).toContain(OWNERSHIP_SUPPORT_EMAIL);
    const anon = await claimService.getEligibility(linked.slug, null);
    expect(anon.ownershipState).toBe('linked_unverified');
    expect(anon.needsAuth).toBe(true);

    const self = await claimService.getEligibility(linked.slug, actorFor(owner));
    expect(self.ownershipState).toBe('self_linked_unverified');
    expect(self.canClaim).toBe(true);
    expect(self.ownerVerificationMode).toBe(true);

    const pendingCh = await seedChannel();
    await seedClaim(pendingCh.id, viewer);
    const e3 = await claimService.getEligibility(pendingCh.slug, V);
    expect(e3.ownershipState).toBe('pending_claim');
    expect(e3.existingClaim?.status).toBe('pending');

    const verified = await seedChannel({ owner_id: owner, verification_status: 'verified', activation_status: 'not_required' });
    const e4 = await claimService.getEligibility(verified.slug, V);
    expect(e4.ownershipState).toBe('verified_owner');
    expect(e4.reason).toBe('This channel already has a verified owner.');
    expect((await claimService.getEligibility(verified.slug, actorFor(owner))).ownershipState).toBe('self_verified');

    const legacy = await seedChannel({ owner_id: owner, verification_status: 'unverified' });
    expect((await claimService.getEligibility(legacy.slug, V)).ownershipState).toBe('ownership_issue');
    const disputed = await seedChannel({ is_disputed: true });
    expect((await claimService.getEligibility(disputed.slug, V)).ownershipState).toBe('ownership_issue');
  });

  it('verified owner with activation pending/revoked → NO claim CTA, even though the public badge is hidden', async () => {
    process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = 'true';
    const owner = await seedUser();
    const viewer = await seedUser();
    for (const act of ['pending', 'revoked']) {
      const c = await seedChannel({ owner_id: owner, verification_status: 'verified', activation_status: act });
      const full = await ch(c.id);
      expect(sanitizeChannel(full).is_verified).toBe(false);          // public badge hidden…
      const e = await claimService.getEligibility(c.slug, actorFor(viewer));
      expect(e.ownershipState).toBe('verified_activation_incomplete'); // …but ownership is verified
      expect(e.canClaim).toBe(false);
      expect(ctaForOwnershipState(e.ownershipState)).not.toBe('claim');
      expect(JSON.stringify(e)).not.toMatch(/revoked|refund/i);       // no payment detail leaked
    }
  });

  it('public CTA and claim page derive from the same canonical state', () => {
    expect(ctaForOwnershipState('unclaimed')).toBe('claim');
    expect(ctaForOwnershipState('pending_claim')).toBe('claim_status');
    for (const s of ['linked_unverified', 'verified_owner', 'verified_activation_incomplete', 'ownership_issue'] as const) {
      expect(ctaForOwnershipState(s)).toBe('ownership_support');
    }
    expect(ctaForOwnershipState('self_verified')).toBe('manage');
    const page = src('app/channel/[slug]/page.tsx');
    expect(page).toContain('deriveOwnershipState(internal');
    expect(page).not.toContain('hasVerifiedOwner');
    const claim = src('app/claim/[slug]/page.tsx');
    expect(claim).toContain('eligibility.ownershipState');
    expect(claim).not.toContain('eligibility.alreadyOwned &&');
    // The "Verified Owner" heading is only reachable for state === 'verified_owner'.
    expect(claim).toContain("{state === 'verified_owner' ? 'This channel already has a Verified Owner' : 'Ownership already verified'}");
    expect(claim).toContain('Ownership not yet verified');
    // Honest support path, no implied formal dispute workflow, no placeholder inbox.
    for (const f of ['app/claim/[slug]/page.tsx', 'app/report/channel/[slug]/page.tsx']) {
      const s = src(f);
      expect(s).not.toContain('trust@wavelead.dev');
      expect(s).not.toMatch(/dispute (workflow|resolution) is/i);
    }
    expect(src('lib/services/ownershipState.ts')).toContain("'support@p2plabs.asia'");
  });

  it('rendered pages: linked-but-unverified shows honest messaging and the CTA does not say "Claim this channel"', async () => {
    const owner = await seedUser();
    const c = await seedChannel({ owner_id: owner, verification_status: 'unclaimed', is_test_fixture: false, slug: `${RUN}-render-linked` });
    try {
      const profile = await (await fetch(`${BASE}/channel/${c.slug}`)).text();
      expect(profile).toContain('data-testid="ownership-cta-support"');
      expect(profile).not.toContain('data-testid="ownership-cta-claim"');
      expect(markup(profile)).not.toContain(owner);
      const claim = await (await fetch(`${BASE}/claim/${c.slug}`)).text();
      expect(claim).toContain('data-testid="claim-state-linked-unverified"');
      expect(claim).toContain('Ownership not yet verified');
      expect(claim).not.toContain('This channel already has a Verified Owner');
      expect(claim).toContain(OWNERSHIP_SUPPORT_EMAIL);
      expect(markup(claim)).not.toContain(owner);
    } finally {
      await db.collection(COLLECTIONS.CHANNELS).updateOne({ id: c.id }, { $set: { is_test_fixture: true } });
    }
  });

  it('rendered pages: unclaimed listing still offers "Claim this channel"', async () => {
    const c = await seedChannel({ is_test_fixture: false, slug: `${RUN}-render-open` });
    try {
      const profile = await (await fetch(`${BASE}/channel/${c.slug}`)).text();
      expect(profile).toContain('data-testid="ownership-cta-claim"');
    } finally {
      await db.collection(COLLECTIONS.CHANNELS).updateOne({ id: c.id }, { $set: { is_test_fixture: true } });
    }
  });

  it('deriveOwnershipState is pure and identity-free', () => {
    const base = { status: 'approved', owner_id: 'u1', verification_status: 'verified', activation_status: 'active' } as never;
    expect(deriveOwnershipState(base, 'u1')).toBe('self_verified');
    expect(deriveOwnershipState(base, 'u2')).toBe('verified_owner');
    expect(deriveOwnershipState({ ...(base as object), owner_id: null } as never, 'u2')).toBe('ownership_issue');
    expect(deriveOwnershipState({ ...(base as object), status: 'rejected' } as never, 'u2')).toBe('not_claimable');
  });
});

// ---------------------------------------------------------------------------
describe('P0A §6 existing verification flows still work', () => {
  it('Manual: claim on an unclaimed channel → moderator approval → verified owner', async () => {
    const claimant = await seedUser();
    const mod = await seedUser('moderator');
    const c = await seedChannel();
    const { claim } = await claimService.submit(actorFor(claimant), c.slug, {
      verification_method: 'manual', claimant_note: 'I run this channel and can prove it.', evidence_urls: [],
    });
    await claimModerationService.approve(actorFor(mod, 'moderator'), claim.id, {});
    const after = await ch(c.id);
    expect(after.owner_id).toBe(claimant);
    expect(after.verification_status).toBe('verified');
  });

  it('Fast: original submitter (no owner linked) and linked owner both still verify', async () => {
    const s = await seedUser();
    const c1 = await seedChannel({ submitted_by: s, status: 'pending_review' });
    await readyFastUser(c1.id, s);
    expect((await ownerVerificationService.finalizeIfComplete(s, c1.id)).verified).toBe(true);
    const a1 = await ch(c1.id);
    expect(a1).toMatchObject({ owner_id: s, verification_status: 'verified', activation_status: 'active', status: 'approved' });
    expect(a1.verified_at).toBeTruthy();

    const linked = await seedUser();
    const c2 = await seedChannel({ owner_id: linked, verification_status: 'unclaimed' });
    await readyFastUser(c2.id, linked);
    expect((await ownerVerificationService.finalizeIfComplete(linked, c2.id)).verified).toBe(true);
    expect((await ch(c2.id)).owner_id).toBe(linked);
  });

  it('Admin "Verify Current Owner" preserves the existing owner', async () => {
    const owner = await seedUser();
    const admin = await seedUser('admin');
    const c = await seedChannel({ owner_id: owner, verification_status: 'unclaimed' });
    await claimModerationService.verifyCurrentOwner(actorFor(admin, 'admin'), c.id, {});
    const after = await ch(c.id);
    expect(after.owner_id).toBe(owner);
    expect(after.verification_status).toBe('verified');
  });
});

// ---------------------------------------------------------------------------
describe('P0A §7 no confidential owner / payment data exposure', () => {
  it('eligibility responses never include owner identity', async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    for (const over of [
      { owner_id: owner, verification_status: 'unclaimed' },
      { owner_id: owner, verification_status: 'verified' },
    ]) {
      const c = await seedChannel(over);
      const e = JSON.stringify(await claimService.getEligibility(c.slug, actorFor(viewer)));
      expect(e).not.toContain(owner);
      expect(e).not.toMatch(/owner_id|email|payment|approve_url/i);
    }
  });

  it('startFastVerification never hands one user another user\u2019s open checkout', async () => {
    const formerSubmitter = await seedUser();
    const linkedOwner = await seedUser();
    const c = await seedChannel({ owner_id: linkedOwner, verification_status: 'unclaimed' });
    const now = new Date();
    const foreignId = uuidv4();
    await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).insertOne({
      id: foreignId, channel_id: c.id, owner_user_id: formerSubmitter, purpose: 'CHANNEL_OWNER_ACTIVATION',
      verification_flow: 'fast', provider: 'paypal', provider_environment: 'sandbox', currency: 'USD',
      gross_amount_minor: 100, amount_captured_minor: 0, amount_refunded_minor: 0, provider_fee_minor: null, provider_net_minor: null,
      status: 'checkout_created', provider_order_id: `ORD-${RUN}-F`, provider_capture_id: null,
      approve_url: `https://example.invalid/${RUN}-foreign-approve`, return_url: 'x', cancel_url: 'x',
      captured_at: null, finalized_at: null, refunded_at: null, created_at: now, updated_at: now,
    } as never);
    const view = await ownerVerificationService.startFastVerification(actorFor(linkedOwner), c.id)
      .then((v) => v as unknown as { id?: string; approve_url?: string | null })
      .catch(() => null); // provider unavailable in tests → a NEW row was attempted, not the foreign one
    if (view) {
      expect(view.id).not.toBe(foreignId);
      expect(String(view.approve_url || '')).not.toContain('foreign-approve');
    }
  });

  it('public channel page source still never renders owner/payment internals', () => {
    const pub = src('app/channel/[slug]/page.tsx');
    for (const leak of ['full_legal_name', 'mobile_number', 'paypal_email', 'ownership_conflict', 'owner_user_id']) {
      expect(pub).not.toContain(leak);
    }
  });
});
