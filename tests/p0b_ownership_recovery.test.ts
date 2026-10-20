// P0B — Staff-Sourced Ownership & Claim Recovery: targeted tests.
//   §1 Sourcing designation is admin-managed, audited, and grants nothing
//   §2 Staff-sourced submissions attribute without assigning ownership
//   §3 Fast Verification safeguards (sourcing is never ownership), incl. races
//   §4 Admin "Release Unverified Ownership Link" eligibility + atomicity
//   §5 Release audit trail & history preservation
//   §6 Claim-path metric definitions (mutually exclusive, sum to total)
//   §7 Build stamping & inventory snapshots (append-only, idempotent)
//   §8 P0A safeguards preserved (no loosening)
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { ownerVerificationService, assertFastVerificationEligible } from '@/lib/services/ownerVerificationService';
import { fastOwnershipConflictReason } from '@/lib/services/activationOwnershipConflict';
import { ownershipReleaseService } from '@/lib/services/ownershipReleaseService';
import { sourcingAgentService } from '@/lib/services/sourcingAgentService';
import { claimPathMetricsService } from '@/lib/services/claimPathMetricsService';
import { inventorySnapshotService } from '@/lib/services/inventorySnapshotService';
import { submissionService } from '@/lib/services/submissionService';
import { claimService } from '@/lib/services/claimService';
import { getBuildInfo, currentReleaseKey } from '@/lib/buildInfo';
import { sanitizeChannel } from '@/lib/utils/sanitize';
import { deriveOwnershipState, ctaForOwnershipState } from '@/lib/services/ownershipState';

const RUN = `p0b${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;

let client: MongoClient;
let db: Db;

function actorFor(id: string, role: 'user' | 'moderator' | 'admin' | 'super_admin' = 'user'): Actor {
  return {
    user: { id, email: `${RUN}-${id.slice(0, 6)}@t.local`, display_name: 'T', role, is_active: true },
    session: { user_id: id, jti: 't', role, iat: 0, exp: 0 }, role,
  } as unknown as Actor;
}

async function seedUser(role: 'user' | 'moderator' | 'admin' = 'user', over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: `${RUN}-user`, role,
    is_active: true, is_email_verified: true, password_hash: 'x',
    created_at: new Date(), updated_at: new Date(), ...over,
  } as never);
  return id;
}

/**
 * `visible: true` seeds a row that PASSES the canonical public visibility
 * filter (needed for metric tests). Those rows are removed in afterAll.
 */
async function seedChannel(over: Record<string, unknown> = {}, visible = false): Promise<Channel> {
  const id = uuidv4(); const now = new Date();
  const hex = id.replace(/-/g, '');
  const doc = {
    id, slug: `${RUN}-${hex.slice(0, 8)}`, name: `P0B Channel ${hex.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${hex.slice(0, 22)}`,
    whatsapp_channel_id: hex.slice(0, 22),
    short_description: 'Ownership recovery test listing', description: null,
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, submitted_by: null, status: 'approved',
    verification_status: 'unclaimed', activation_status: 'not_required',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false, activity_level: 'active',
    follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    ...(visible ? {} : { is_test_fixture: true }),
    ...over,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}

async function capturedPayment(channelId: string, userId: string) {
  const id = uuidv4(); const now = new Date();
  await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).insertOne({
    id, channel_id: channelId, owner_user_id: userId, purpose: 'CHANNEL_OWNER_ACTIVATION',
    verification_flow: 'fast', provider: 'paypal', provider_environment: 'sandbox', currency: 'USD',
    gross_amount_minor: 100, amount_captured_minor: 100, amount_refunded_minor: 0,
    provider_fee_minor: 5, provider_net_minor: 95, status: 'captured_finalized',
    provider_order_id: `ORD-${id}`, provider_capture_id: `CAP-${id}`, approve_url: null,
    return_url: 'x', cancel_url: 'x',
    captured_at: now, finalized_at: now, refunded_at: null, created_at: now, updated_at: now,
  } as never);
  return id;
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

const ch = async (id: string) =>
  (await db.collection(COLLECTIONS.CHANNELS).findOne({ id })) as unknown as Channel & Record<string, unknown>;

beforeAll(async () => {
  process.env.SMTP_HOST = 'smtp.test.local';
  client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  db = client.db(process.env.DB_NAME || 'wavelead');
});

afterAll(async () => {
  const rx = new RegExp(RUN);
  const chans = await db.collection(COLLECTIONS.CHANNELS).find({ slug: rx }).project({ id: 1 }).toArray();
  const ids = chans.map((c) => c.id);
  await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
  if (ids.length) {
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ channel_id: { $in: ids } });
    await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).deleteMany({ channel_id: { $in: ids } });
    await db.collection(COLLECTIONS.AUDIT_LOGS).deleteMany({ entity_id: { $in: ids } });
  }
  await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
  await db.collection(COLLECTIONS.INVENTORY_SNAPSHOTS).deleteMany({ release_key: rx });
  await client.close();
});

// ---------------------------------------------------------------------------
describe('P0B §1 sourcing designation is admin-managed and grants nothing', () => {
  it('a non-admin can never designate a sourcing agent', async () => {
    const target = await seedUser('user');
    const plainUser = await seedUser('user');
    await expect(sourcingAgentService.setDesignation(actorFor(plainUser, 'user'), target, true, 'trying to self-promote'))
      .rejects.toMatchObject({ status: expect.any(Number) });
    await expect(sourcingAgentService.setDesignation(null, target, true, 'anonymous attempt'))
      .rejects.toMatchObject({ status: expect.any(Number) });
    const after = await db.collection(COLLECTIONS.USERS).findOne({ id: target });
    expect(after?.is_sourcing_agent).toBeFalsy();
  });

  it('admin designation is audited, idempotent, and never changes the role', async () => {
    const target = await seedUser('user');
    const admin = await seedUser('admin');
    const res = await sourcingAgentService.setDesignation(actorFor(admin, 'admin'), target, true, 'Sourcing team member');
    expect(res).toMatchObject({ is_sourcing_agent: true, changed: true });

    const u = await db.collection(COLLECTIONS.USERS).findOne({ id: target });
    expect(u?.is_sourcing_agent).toBe(true);
    // The designation is an attribute, NOT a role or permission upgrade.
    expect(u?.role).toBe('user');

    const audit = await db.collection(COLLECTIONS.AUDIT_LOGS)
      .findOne({ entity_id: target, action: 'SOURCING_AGENT_DESIGNATED' });
    expect(audit).toBeTruthy();
    expect(audit?.actor_user_id).toBe(admin);

    // Idempotent: a second identical call writes nothing new.
    const again = await sourcingAgentService.setDesignation(actorFor(admin, 'admin'), target, true, 'Sourcing team member');
    expect(again.changed).toBe(false);
  });

  it('a reason is mandatory for a designation change', async () => {
    const target = await seedUser('user');
    const admin = await seedUser('admin');
    await expect(sourcingAgentService.setDesignation(actorFor(admin, 'admin'), target, true, 'x'))
      .rejects.toMatchObject({ status: 400 });
  });

  it('revoking the designation never rewrites historical attribution', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const sourced = await seedChannel({
      source: 'staff_sourced', sourced_by_user_id: agent, sourced_at: new Date(), submitted_by: agent, owner_id: null,
    });

    const res = await sourcingAgentService.setDesignation(actorFor(admin, 'admin'), agent, false, 'Left the sourcing team');
    expect(res).toMatchObject({ is_sourcing_agent: false, changed: true });

    // Attribution lives on the channel and must survive, so per-agent
    // reporting stays truthful after the person leaves the team.
    const after = await ch(sourced.id);
    expect(after.source).toBe('staff_sourced');
    expect(after.sourced_by_user_id).toBe(agent);
    expect(after.sourced_at).toBeTruthy();
    // And the safeguard still holds for that historical listing.
    expect(fastOwnershipConflictReason(after, agent)).toBe('sourcing_agent_not_owner');
  });

  it('existing listings are never auto-reclassified or migrated', async () => {
    // A legacy row has no sourcing fields at all. Nothing in P0B may backfill
    // them: reclassification must be an explicit, reviewed admin action.
    const legacyOwner = await seedUser('user');
    const legacy = await seedChannel({ owner_id: legacyOwner, verification_status: 'unclaimed' });
    await db.collection(COLLECTIONS.CHANNELS).updateOne(
      { id: legacy.id }, { $unset: { source: '', sourced_by_user_id: '', sourced_at: '', submitted_by: '' } },
    );

    const admin = await seedUser('admin');
    await claimPathMetricsService.compute();
    await ownershipReleaseService.getAssessment(actorFor(admin, 'admin'), legacy.id);
    await sourcingAgentService.dailySourcingCounts(actorFor(admin, 'admin'), 7);

    const after = await ch(legacy.id);
    expect(after.source).toBeUndefined();
    expect(after.sourced_by_user_id).toBeUndefined();
    expect(after.owner_id).toBe(legacyOwner);
    expect(after.verification_status).toBe('unclaimed');
  });
});

// ---------------------------------------------------------------------------
describe('P0B §2 staff-sourced submissions attribute without assigning ownership', () => {
  const submission = (name: string) => ({
    name,
    whatsapp_url: `https://whatsapp.com/channel/${uuidv4().replace(/-/g, '').slice(0, 22)}`,
    short_description: 'A sourced public channel listing for operational coverage.',
    category_slug: '',
    country_code: 'ID',
    primary_language: 'id',
  });

  async function anyCategorySlug(): Promise<string | null> {
    const c = await db.collection(COLLECTIONS.CATEGORIES).findOne({ is_active: true } as never);
    return (c?.slug as string) || null;
  }

  it('a sourcing agent submission keeps owner_id NULL and records attribution', async () => {
    const slug = await anyCategorySlug();
    if (!slug) return; // no categories in this environment
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const input = { ...submission(`${RUN} Sourced One`), category_slug: slug };
    const res = await submissionService.submit(actorFor(agent, 'user'), input);
    const created = await ch((res as { channel: { id: string } }).channel.id);

    expect(created.owner_id).toBeNull();
    expect(created.source).toBe('staff_sourced');
    expect(created.sourced_by_user_id).toBe(agent);
    expect(created.sourced_at).toBeTruthy();
    expect(created.submitted_by).toBe(agent);
    // Moderation is untouched by sourcing.
    expect(created.status).toBe('pending_review');
    expect(created.verification_status).toBe('unclaimed');
  });

  it('an ordinary creator submission still links the submitter as owner', async () => {
    const slug = await anyCategorySlug();
    if (!slug) return;
    const creator = await seedUser('user');
    const input = { ...submission(`${RUN} Self One`), category_slug: slug };
    const res = await submissionService.submit(actorFor(creator, 'user'), input);
    const created = await ch((res as { channel: { id: string } }).channel.id);

    expect(created.owner_id).toBe(creator);
    expect(created.source).toBe('owner_self');
    expect(created.sourced_by_user_id).toBeNull();
  });

  it('a client-supplied source/sourced_by is ignored (never trusted)', async () => {
    const slug = await anyCategorySlug();
    if (!slug) return;
    const attacker = await seedUser('user');
    const victim = await seedUser('user');
    const input = {
      ...submission(`${RUN} Injected`),
      category_slug: slug,
      source: 'staff_sourced',
      sourced_by_user_id: victim,
      owner_id: victim,
      is_test_fixture: true,
      status: 'approved',
      verification_status: 'verified',
    } as Record<string, unknown>;
    const res = await submissionService.submit(actorFor(attacker, 'user'), input);
    const created = await ch((res as { channel: { id: string } }).channel.id);

    // Server-authoritative: attacker is not a designated agent, so it is a
    // normal self-submission and none of the injected fields took effect.
    expect(created.source).toBe('owner_self');
    expect(created.sourced_by_user_id).toBeNull();
    expect(created.owner_id).toBe(attacker);
    expect(created.status).toBe('pending_review');
    expect(created.verification_status).toBe('unclaimed');
  });

  it('a staff-sourced listing reads as claimable on the public surface', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: null });
    const state = deriveOwnershipState(c, null, false);
    expect(state).toBe('unclaimed');
    expect(ctaForOwnershipState(state)).toBe('claim');
  });

  it('sourcing attribution never leaks to a public response', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent });
    const pub = sanitizeChannel(c) as unknown as Record<string, unknown>;
    for (const k of ['source', 'sourced_by_user_id', 'sourced_at', 'submitted_by', 'owner_id',
      'released_from_owner_id', 'ownership_released_by', 'ownership_released_at']) {
      expect(pub[k]).toBeUndefined();
    }
    expect(JSON.stringify(pub)).not.toContain(agent);
  });
});

// ---------------------------------------------------------------------------
describe('P0B §3 Fast Verification: sourcing is never ownership', () => {
  it('the sourcing agent of a staff-sourced listing is NOT fast-eligible', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: null });
    expect(fastOwnershipConflictReason(c, agent)).toBe('sourcing_agent_not_owner');
    await expect(assertFastVerificationEligible(actorFor(agent, 'user'), c))
      .rejects.toMatchObject({ status: 403 });
  });

  it('the $1 payment cannot finalize ownership for the sourcing agent', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: null });
    const paymentId = await capturedPayment(c.id, agent);

    const res = await ownerVerificationService.finalizeIfComplete(agent, c.id);
    expect(res.verified).toBe(false);
    expect(res.blocked_by).toContain('ownership_conflict');

    const after = await ch(c.id);
    expect(after.owner_id).toBeNull();
    expect(after.verification_status).toBe('unclaimed');

    // The captured payment is preserved for admin refund review, never auto-refunded.
    const p = await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).findOne({ id: paymentId });
    expect((p as Record<string, any>)?.ownership_conflict?.reason).toBe('sourcing_agent_not_owner');
    expect((p as Record<string, any>)?.ownership_conflict?.review_status).toBe('pending_admin_refund_review');
    expect((p as Record<string, any>)?.amount_refunded_minor).toBe(0);
  });

  it('concurrent finalize attempts by the sourcing agent all fail closed', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: null });
    await capturedPayment(c.id, agent);
    const results = await Promise.all([
      ownerVerificationService.finalizeIfComplete(agent, c.id),
      ownerVerificationService.finalizeIfComplete(agent, c.id),
      ownerVerificationService.finalizeIfComplete(agent, c.id),
    ]);
    expect(results.every((r) => r.verified === false)).toBe(true);
    const after = await ch(c.id);
    expect(after.owner_id).toBeNull();
  });

  it('an ordinary self-submitter keeps the original-submitter fast path', async () => {
    const creator = await seedUser('user');
    const c = await seedChannel({ source: 'owner_self', submitted_by: creator, owner_id: null });
    expect(fastOwnershipConflictReason(c, creator)).toBeNull();
    await expect(assertFastVerificationEligible(actorFor(creator, 'user'), c)).resolves.toBeUndefined();
  });

  it('once a moderator makes the agent the real owner, eligibility returns', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    // Ownership granted through the reviewed claim path sets owner_id.
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: agent });
    expect(fastOwnershipConflictReason(c, agent)).toBeNull();
  });

  it('the rightful owner can still claim a staff-sourced listing', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const owner = await seedUser('user');
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, owner_id: null });
    const elig = await claimService.getEligibility(c.slug, actorFor(owner, 'user'));
    expect(elig.canClaim).toBe(true);
    expect(elig.ownershipState).toBe('unclaimed');
  });
});

// ---------------------------------------------------------------------------
describe('P0B §4 admin release of an unverified ownership link', () => {
  const RELEASE = { reason: 'Reviewed sourcing evidence: linked account is a sourcing agent.', evidence_ref: 'TICKET-1234' };

  it('is refused for non-admins', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ owner_id: agent, verification_status: 'unclaimed' });
    const mod = await seedUser('moderator');
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(mod, 'moderator'), c.id, {
      ...RELEASE, expected_owner_user_id: agent,
    })).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(ownershipReleaseService.releaseUnverifiedLink(null, c.id, {
      ...RELEASE, expected_owner_user_id: agent,
    })).rejects.toMatchObject({ status: expect.any(Number) });
    expect((await ch(c.id)).owner_id).toBe(agent);
  });

  it('requires a reason and an evidence reference', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ owner_id: agent });
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      reason: 'short', evidence_ref: 'T-1', expected_owner_user_id: agent,
    })).rejects.toMatchObject({ status: 400 });
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      reason: RELEASE.reason, evidence_ref: '', expected_owner_user_id: agent,
    })).rejects.toMatchObject({ status: 400 });
    expect((await ch(c.id)).owner_id).toBe(agent);
  });

  it('NEVER releases a verified or official ownership record', async () => {
    const admin = await seedUser('admin');
    const owner = await seedUser('user');
    for (const vs of ['verified', 'official']) {
      const c = await seedChannel({ owner_id: owner, verification_status: vs, verified_at: new Date() });
      await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
        ...RELEASE, expected_owner_user_id: owner, acknowledge_warnings: true,
      })).rejects.toMatchObject({ status: 409 });
      const after = await ch(c.id);
      expect(after.owner_id).toBe(owner);
      expect(after.verification_status).toBe(vs);
    }
  });

  it('refuses when activation is active or a captured payment exists', async () => {
    const admin = await seedUser('admin');
    const owner = await seedUser('user');

    const active = await seedChannel({ owner_id: owner, activation_status: 'active' });
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), active.id, {
      ...RELEASE, expected_owner_user_id: owner, acknowledge_warnings: true,
    })).rejects.toMatchObject({ status: 409 });

    const paid = await seedChannel({ owner_id: owner });
    await capturedPayment(paid.id, owner);
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), paid.id, {
      ...RELEASE, expected_owner_user_id: owner, acknowledge_warnings: true,
    })).rejects.toMatchObject({ status: 409 });

    expect((await ch(active.id)).owner_id).toBe(owner);
    expect((await ch(paid.id)).owner_id).toBe(owner);
  });

  it('refuses when the stated expected owner does not match (stale review)', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const someoneElse = await seedUser('user');
    const c = await seedChannel({ owner_id: agent });
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      ...RELEASE, expected_owner_user_id: someoneElse, acknowledge_warnings: true,
    })).rejects.toMatchObject({ status: 409 });
    expect((await ch(c.id)).owner_id).toBe(agent);
  });

  it('requires explicit acknowledgement when findings exist (pending claim)', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const claimant = await seedUser('user');
    const c = await seedChannel({ owner_id: agent, source: 'staff_sourced', sourced_by_user_id: agent });
    await seedClaim(c.id, claimant, 'pending');

    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      ...RELEASE, expected_owner_user_id: agent,
    })).rejects.toMatchObject({ status: 409 });

    const done = await ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      ...RELEASE, expected_owner_user_id: agent, acknowledge_warnings: true,
    });
    expect(done.released).toBe(true);
  });

  it('releases a genuine staff-sourced link and makes it claimable again', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const realOwner = await seedUser('user');
    const c = await seedChannel({ owner_id: agent, submitted_by: agent, verification_status: 'unclaimed' });

    const assessment = await ownershipReleaseService.getAssessment(actorFor(admin, 'admin'), c.id);
    expect(assessment.label).toBe('likely_staff_sourced');
    expect(assessment.eligible).toBe(true);
    expect(assessment.evidence.linked_owner_is_designated_sourcing_agent).toBe(true);

    const res = await ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      ...RELEASE, expected_owner_user_id: agent, acknowledge_warnings: true,
    });
    expect(res.released).toBe(true);
    expect(res.previous_owner_user_id).toBe(agent);

    const after = await ch(c.id);
    expect(after.owner_id).toBeNull();
    expect(after.verification_status).toBe('unclaimed');
    // Ownership is NOT handed to anyone; the rightful owner must still claim.
    expect(after.released_from_owner_id).toBe(agent);
    expect(after.submitted_by).toBe(agent); // submission history preserved
    expect(ctaForOwnershipState(deriveOwnershipState(after, null, false))).toBe('claim');

    const elig = await claimService.getEligibility(c.slug, actorFor(realOwner, 'user'));
    expect(elig.canClaim).toBe(true);
    expect(elig.ownershipState).toBe('unclaimed');
  });

  it('concurrent releases apply exactly once and never corrupt state', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ owner_id: agent, submitted_by: agent });
    const attempts = await Promise.allSettled([
      ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, { ...RELEASE, expected_owner_user_id: agent, acknowledge_warnings: true }),
      ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, { ...RELEASE, expected_owner_user_id: agent, acknowledge_warnings: true }),
      ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, { ...RELEASE, expected_owner_user_id: agent, acknowledge_warnings: true }),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const after = await ch(c.id);
    expect(after.owner_id).toBeNull();
    const audits = await db.collection(COLLECTIONS.AUDIT_LOGS)
      .find({ entity_id: c.id, action: 'OWNERSHIP_LINK_RELEASED' }).toArray();
    expect(audits).toHaveLength(1);
  });

  it('there is no bulk release surface', async () => {
    const svc = ownershipReleaseService as unknown as Record<string, unknown>;
    for (const k of Object.keys(svc)) {
      expect(k.toLowerCase()).not.toMatch(/bulk|all|many|batch/);
    }
  });

  it('the candidate queue never lists a verified record', async () => {
    const admin = await seedUser('admin');
    const owner = await seedUser('user');
    const verified = await seedChannel({ owner_id: owner, verification_status: 'verified', verified_at: new Date() }, true);
    const res = await ownershipReleaseService.listCandidates(actorFor(admin, 'admin'), { limit: 100 });
    expect(res.items.find((i) => i.channel_id === verified.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('P0B §5 release audit trail', () => {
  it('records admin, channel, previous owner, reason and evidence', async () => {
    const admin = await seedUser('admin');
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ owner_id: agent, submitted_by: agent });
    await ownershipReleaseService.releaseUnverifiedLink(actorFor(admin, 'admin'), c.id, {
      reason: 'Confirmed sourcing agent, not the channel owner.',
      evidence_ref: 'REVIEW-77',
      expected_owner_user_id: agent,
      acknowledge_warnings: true,
    });
    const audit = await db.collection(COLLECTIONS.AUDIT_LOGS)
      .findOne({ entity_id: c.id, action: 'OWNERSHIP_LINK_RELEASED' });
    expect(audit).toBeTruthy();
    expect(audit?.actor_user_id).toBe(admin);
    expect((audit?.before_data as Record<string, unknown>)?.owner_id).toBe(agent);
    const after = audit?.after_data as Record<string, unknown>;
    expect(after?.previous_owner_user_id).toBe(agent);
    expect(after?.evidence_ref).toBe('REVIEW-77');
    expect(after?.reassigned_to_claimant).toBe(false);
    expect(after?.bulk_operation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('P0B §6 claim-path metric definitions', () => {
  it('buckets are mutually exclusive and sum to the public approved total', async () => {
    const m = await claimPathMetricsService.compute();
    expect(m.sum_matches_total).toBe(true);
    expect(m.claimable + m.linked_unverified + m.verified_ownership + m.needs_review)
      .toBe(m.public_approved_total);
  });

  it('counts a newly visible claimable / linked / verified listing in the right bucket', async () => {
    const before = await claimPathMetricsService.compute();
    const owner = await seedUser('user');
    await seedChannel({ owner_id: null, verification_status: 'unclaimed' }, true);                          // claimable
    await seedChannel({ owner_id: owner, verification_status: 'unclaimed' }, true);                         // linked
    await seedChannel({ owner_id: owner, verification_status: 'verified', verified_at: new Date() }, true); // verified
    await seedChannel({ owner_id: null, verification_status: 'verified', verified_at: new Date() }, true);  // exception

    const after = await claimPathMetricsService.compute();
    expect(after.claimable - before.claimable).toBe(1);
    expect(after.linked_unverified - before.linked_unverified).toBe(1);
    expect(after.verified_ownership - before.verified_ownership).toBe(1);
    expect(after.needs_review - before.needs_review).toBe(1);
    expect(after.public_approved_total - before.public_approved_total).toBe(4);
    expect(after.sum_matches_total).toBe(true);
  });

  it('never counts an owner link alone as verified ownership', async () => {
    const before = await claimPathMetricsService.compute();
    const owner = await seedUser('user');
    await seedChannel({ owner_id: owner, verification_status: 'claimed' }, true);
    const after = await claimPathMetricsService.compute();
    expect(after.verified_ownership).toBe(before.verified_ownership);
    expect(after.linked_unverified - before.linked_unverified).toBe(1);
  });

  it('excludes test fixtures from the public counts', async () => {
    const before = await claimPathMetricsService.compute();
    await seedChannel({ owner_id: null }, false); // is_test_fixture: true
    const after = await claimPathMetricsService.compute();
    expect(after.public_approved_total).toBe(before.public_approved_total);
  });
});

// ---------------------------------------------------------------------------
describe('P0B §7 build stamping and inventory snapshots', () => {
  it('build info exposes identity only — never secrets', () => {
    const b = getBuildInfo() as unknown as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(
      ['build_time', 'commit', 'commit_short', 'environment', 'release_id', 'stamped'].sort(),
    );
    const blob = JSON.stringify(b);
    expect(blob).not.toMatch(/mongodb(\+srv)?:\/\//);
    expect(blob).not.toMatch(/secret|password|api[_-]?key|token/i);
  });

  it('snapshot capture is admin-only', async () => {
    const mod = await seedUser('moderator');
    await expect(inventorySnapshotService.capture(actorFor(mod, 'moderator'), 'pre_deploy', { release_key: `${RUN}-x` }))
      .rejects.toMatchObject({ status: expect.any(Number) });
    await expect(inventorySnapshotService.capture(null, 'pre_deploy', { release_key: `${RUN}-x` }))
      .rejects.toMatchObject({ status: expect.any(Number) });
  });

  it('is idempotent per release key + phase and stores counts only', async () => {
    const admin = await seedUser('admin');
    const key = `${RUN}-rel1`;
    const first = await inventorySnapshotService.capture(actorFor(admin, 'admin'), 'pre_deploy', { release_key: key });
    const second = await inventorySnapshotService.capture(actorFor(admin, 'admin'), 'pre_deploy', { release_key: key });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);

    const rows = await db.collection(COLLECTIONS.INVENTORY_SNAPSHOTS).find({ release_key: key }).toArray();
    expect(rows).toHaveLength(1);
    // Aggregate counts only — no channel export, no personal data.
    const blob = JSON.stringify(rows[0]);
    expect(blob).not.toContain('whatsapp.com/channel');
    expect(typeof first.snapshot.metrics.public_approved_total).toBe('number');
  });

  it('diff reports deltas without declaring a defect, and refuses to invent a baseline', async () => {
    const admin = await seedUser('admin');
    const key = `${RUN}-rel2`;
    await inventorySnapshotService.capture(actorFor(admin, 'admin'), 'pre_deploy', { release_key: key });

    const partial = await inventorySnapshotService.diff(actorFor(admin, 'admin'), key);
    expect(partial.deltas).toBeNull();
    expect(partial.note).toMatch(/post-deploy/i);

    await seedChannel({ owner_id: null, verification_status: 'unclaimed' }, true);
    await inventorySnapshotService.capture(actorFor(admin, 'admin'), 'post_deploy', { release_key: key });
    const full = await inventorySnapshotService.diff(actorFor(admin, 'admin'), key);
    expect(full.deltas?.claimable).toBe(1);
    expect(full.note).toMatch(/not by itself a deployment defect/i);

    // A release with no pre-deploy baseline is never back-filled.
    const orphan = `${RUN}-rel3`;
    await inventorySnapshotService.capture(actorFor(admin, 'admin'), 'post_deploy', { release_key: orphan });
    const noBaseline = await inventorySnapshotService.diff(actorFor(admin, 'admin'), orphan);
    expect(noBaseline.pre).toBeNull();
    expect(noBaseline.deltas).toBeNull();
    expect(noBaseline.note).toMatch(/never reconstructed/i);
  });

  it('exposes a stable release key', () => {
    expect(typeof currentReleaseKey()).toBe('string');
    expect(currentReleaseKey().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('P0B §8 P0A safeguards are preserved (no loosening)', () => {
  it('a verified owner still cannot be overwritten by another payer', async () => {
    const realOwner = await seedUser('user');
    const attacker = await seedUser('user');
    const c = await seedChannel({
      owner_id: realOwner, verification_status: 'verified', verified_at: new Date(), activation_status: 'active',
    });
    await capturedPayment(c.id, attacker);
    const res = await ownerVerificationService.finalizeIfComplete(attacker, c.id);
    expect(res.verified).toBe(false);
    const after = await ch(c.id);
    expect(after.owner_id).toBe(realOwner);
    expect(after.verification_status).toBe('verified');
  });

  it('an unrelated pending claimant is still not fast-eligible', async () => {
    const claimant = await seedUser('user');
    const c = await seedChannel({ owner_id: null, submitted_by: null, verification_status: 'unclaimed' });
    await seedClaim(c.id, claimant, 'pending');
    expect(fastOwnershipConflictReason(c, claimant)).toBe('not_eligible_claimant');
  });

  it('blocked listings and disputes still refuse fast verification', async () => {
    const u = await seedUser('user');
    const blocked = await seedChannel({ status: 'suspended', submitted_by: u });
    expect(fastOwnershipConflictReason(blocked, u)).toBe('listing_blocked');
    const disputed = await seedChannel({ is_disputed: true, submitted_by: u });
    expect(fastOwnershipConflictReason(disputed, u)).toBe('ownership_under_review');
  });
});
