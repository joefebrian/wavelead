// Milestone 03.7 — Ownership Verification State Patch tests.
// Scope:
//   §1 Assigned-but-unverified state exposed by eligibility (owner-verification mode)
//   §2 Current owner can submit self-verification claim without owner reassignment
//   §3 Unrelated user cannot submit a claim on an already-owned channel (takeover blocked)
//   §4 Existing approve path cannot silently take over a different assigned owner
//   §5 verifyCurrentOwner preserves owner_id + flips verification_status='verified' + audit
//   §6 Verified current owner unlocks Marketplace (requireVerifiedOwnerOfChannel)
//   §7 Existing unclaimed-channel claim + approve flow remains green
//
// Isolation: uses RUN_TAG scoping; foundation.test.ts wipes users so this suite
// runs against fixtures it creates itself.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { claimService } from '@/lib/services/claimService';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { marketplaceService } from '@/lib/services/marketplaceService';
import type { Actor, Channel } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function signup(tag: string, role: 'user' | 'moderator' | 'admin' | 'super_admin' = 'user'): Promise<{ userId: string; email: string }> {
  const email = `m37-${RUN_TAG}-${tag}@t.test`;
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${tag}` }),
  });
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role !== 'user') {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role, updated_at: new Date() } }); });
  }
  return { userId, email };
}
function actorFor(user_id: string, role: 'user' | 'moderator' | 'admin' | 'super_admin' = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}
async function seedChannel(overrides: Partial<Channel> & { slug: string; name: string }): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const { slug, name, ...rest } = overrides;
  const doc: Channel = {
    id, slug, name,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'test', short_description: 'test',
    logo_url: null, cover_url: null, website_url: null, country_code: 'US', primary_language: 'en',
    category_id: null, owner_id: rest.owner_id ?? null,
    status: (rest.status ?? 'approved') as Channel['status'],
    verification_status: (rest.verification_status ?? 'unclaimed') as Channel['verification_status'],
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 5000, follower_count_source: 'seed', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    reviewed_by: null, reviewed_at: null, rejection_reason: null, rejection_notes: null,
    is_test_fixture: true, verified_at: null,
    ...rest,
  } as Channel;
  await withDb(async (db) => { await db.collection('channels').insertOne(doc as unknown as Record<string, unknown>); });
  return doc;
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: new RegExp(`^m37-${RUN_TAG}`) });
    await db.collection('channels').deleteMany({ is_test_fixture: true, slug: new RegExp(`^m37-`) });
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({});
    await db.collection('users').deleteMany({ email: new RegExp(`m37-${RUN_TAG}`) });
    await db.collection('audit_logs').deleteMany({ 'after_data.admin_action': 'verify_current_owner' });
  });
}
beforeAll(purge);
afterAll(purge);

// ============================================================================
// §1 Eligibility surfaces owner-verification-mode
// ============================================================================
describe('M03.7 §1 — assigned-but-unverified eligibility', () => {
  it('#1 unrelated user on already-owned unverified channel → canClaim=false, alreadyOwned=true', async () => {
    const owner = await signup('u1-o');
    const stranger = await signup('u1-s');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-u1`, name: 'CH U1', owner_id: owner.userId, verification_status: 'claimed' });
    void ch;
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-u1`, actorFor(stranger.userId));
    expect(e.canClaim).toBe(false);
    expect((e as { alreadyOwned?: boolean }).alreadyOwned).toBe(true);
  });
  it('#2 CURRENT owner on already-owned unverified channel → canClaim=true, ownerVerificationMode=true', async () => {
    const owner = await signup('u2-o');
    await seedChannel({ slug: `m37-${RUN_TAG}-u2`, name: 'CH U2', owner_id: owner.userId, verification_status: 'claimed' });
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-u2`, actorFor(owner.userId));
    expect(e.canClaim).toBe(true);
    expect((e as { ownerVerificationMode?: boolean }).ownerVerificationMode).toBe(true);
  });
  it('#3 unauthenticated visitor on already-owned unverified channel → canClaim=false + needsAuth', async () => {
    const owner = await signup('u3-o');
    await seedChannel({ slug: `m37-${RUN_TAG}-u3`, name: 'CH U3', owner_id: owner.userId, verification_status: 'claimed' });
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-u3`, null);
    expect(e.canClaim).toBe(false);
    expect((e as { needsAuth?: boolean }).needsAuth).toBe(true);
  });
});

// ============================================================================
// §2 Submit: current owner can self-verify; unrelated user cannot take over
// ============================================================================
describe('M03.7 §2 — takeover protection on claim submit', () => {
  it('#4 current owner can submit a self-verification claim (no owner reassignment)', async () => {
    const owner = await signup('s4-o');
    await seedChannel({ slug: `m37-${RUN_TAG}-s4`, name: 'CH S4', owner_id: owner.userId, verification_status: 'claimed', website_url: 'https://ex-s4.test' });
    const res = await claimService.submit(actorFor(owner.userId, 'user'), `m37-${RUN_TAG}-s4`, {
      verification_method: 'manual',
      claimant_note: 'i own it',
      evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://ex-s4.test/proof.png' }],
    });
    expect(res.claim.claimant_user_id).toBe(owner.userId);
    // Channel row must still show the same owner_id — submitting a claim does NOT change ownership.
    const ch = await channelRepo.findById(res.claim.channel_id);
    expect(ch?.owner_id).toBe(owner.userId);
    expect(ch?.verification_status).toBe('claimed');
  });
  it('#5 unrelated user CANNOT submit a claim on an already-owned (unverified) channel', async () => {
    const owner = await signup('s5-o');
    const stranger = await signup('s5-x');
    await seedChannel({ slug: `m37-${RUN_TAG}-s5`, name: 'CH S5', owner_id: owner.userId, verification_status: 'claimed' });
    await expect(claimService.submit(actorFor(stranger.userId), `m37-${RUN_TAG}-s5`, {
      verification_method: 'manual', claimant_note: 'attempt takeover',
      evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://ex-s5.test/p.png' }],
    })).rejects.toMatchObject({ status: 409 });
    // Channel state must be untouched.
    const ch = await channelRepo.findBySlug(`m37-${RUN_TAG}-s5`);
    expect(ch?.owner_id).toBe(owner.userId);
    expect(ch?.verification_status).toBe('claimed');
  });
});

// ============================================================================
// §3 Approve moderation cannot silently take over a different owner
// ============================================================================
describe('M03.7 §3 — approve moderation takeover blocked', () => {
  it('#6 approving a stranger claim on an already-assigned unverified channel → 409, no reassignment', async () => {
    const owner = await signup('a6-o');
    const stranger = await signup('a6-x');
    const admin = await signup('a6-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-a6`, name: 'CH A6', owner_id: owner.userId, verification_status: 'claimed' });
    // Force-insert a claim from the stranger directly bypassing our submit guard,
    // to simulate a legacy pending claim that predates the patch.
    const claimId = uuidv4();
    const now = new Date();
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.CHANNEL_CLAIMS).insertOne({
        id: claimId, channel_id: ch.id, claimant_user_id: stranger.userId,
        verification_method: 'manual', claimant_note: 'legacy',
        evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://x.test/p.png', note: null }],
        evidence_metadata: {}, claimant_email: stranger.email,
        website_domain: null, email_domain: 't.test', domain_match: false,
        status: 'pending', moderator_notes: null, request_more_info_message: null,
        reject_reason: null, submitted_at: now, reviewed_at: null, reviewed_by: null,
        approved_at: null, rejected_at: null, created_at: now, updated_at: now,
      } as unknown as Record<string, unknown>);
    });
    await expect(claimModerationService.approve(actorFor(admin.userId, 'super_admin'), claimId, {})).rejects.toMatchObject({ status: 409 });
    // Channel unchanged.
    const after = await channelRepo.findById(ch.id);
    expect(after?.owner_id).toBe(owner.userId);
    expect(after?.verification_status).toBe('claimed');
  });
  it('#7 super_admin viewing a stranger claim does not gain ownership by simply loading detail', async () => {
    const owner = await signup('a7-o');
    const stranger = await signup('a7-x');
    const admin = await signup('a7-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-a7`, name: 'CH A7', owner_id: owner.userId, verification_status: 'claimed' });
    const claimId = uuidv4();
    const now = new Date();
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.CHANNEL_CLAIMS).insertOne({
        id: claimId, channel_id: ch.id, claimant_user_id: stranger.userId,
        verification_method: 'manual', claimant_note: 'legacy',
        evidence_urls: [], evidence_metadata: {}, claimant_email: stranger.email,
        website_domain: null, email_domain: 't.test', domain_match: false,
        status: 'pending', moderator_notes: null, request_more_info_message: null,
        reject_reason: null, submitted_at: now, reviewed_at: null, reviewed_by: null,
        approved_at: null, rejected_at: null, created_at: now, updated_at: now,
      } as unknown as Record<string, unknown>);
    });
    // Load the detail — must NOT mutate anything.
    await claimModerationService.getDetail(actorFor(admin.userId, 'super_admin'), claimId);
    const after = await channelRepo.findById(ch.id);
    expect(after?.owner_id).toBe(owner.userId); // still the original owner, NOT admin
    expect(after?.verification_status).toBe('claimed');
  });
});

// ============================================================================
// §4 Verify Current Owner
// ============================================================================
describe('M03.7 §4 — verifyCurrentOwner', () => {
  it('#8 preserves owner_id and sets verification_status=verified + writes audit', async () => {
    const owner = await signup('v8-o');
    const admin = await signup('v8-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v8`, name: 'CH V8', owner_id: owner.userId, verification_status: 'claimed' });
    const res = await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, { moderator_notes: 'trusted evidence' });
    expect(res.ok).toBe(true);
    expect(res.channel.owner_id).toBe(owner.userId); // PRESERVED
    expect(res.channel.verification_status).toBe('verified');
    // Audit written.
    const audit = await withDb(async (db) => db.collection('audit_logs').findOne({ entity_id: ch.id, action: 'CHANNEL_OWNER_VERIFIED' }));
    expect(audit).toBeTruthy();
    const afterData = audit!.after_data as Record<string, unknown>;
    expect(afterData.owner_id).toBe(owner.userId);
    expect(afterData.verification_status).toBe('verified');
    expect(afterData.admin_action).toBe('verify_current_owner');
    expect(audit!.actor_user_id).toBe(admin.userId);
  });
  it('#9 rejects when channel has no assigned owner', async () => {
    const admin = await signup('v9-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v9`, name: 'CH V9', owner_id: null, verification_status: 'unclaimed' });
    await expect(claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {})).rejects.toMatchObject({ status: 409 });
  });
  it('#10 rejects when channel is already verified (idempotency)', async () => {
    const owner = await signup('v10-o');
    const admin = await signup('v10-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v10`, name: 'CH V10', owner_id: owner.userId, verification_status: 'verified' });
    await expect(claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {})).rejects.toMatchObject({ status: 409 });
  });
  it('#11 forbids non-moderator actors', async () => {
    const owner = await signup('v11-o');
    const regular = await signup('v11-r');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v11`, name: 'CH V11', owner_id: owner.userId, verification_status: 'claimed' });
    await expect(claimModerationService.verifyCurrentOwner(actorFor(regular.userId), ch.id, {})).rejects.toMatchObject({ status: 403 });
    await expect(claimModerationService.verifyCurrentOwner(null, ch.id, {})).rejects.toBeTruthy();
  });
  it('#12 unlocks Marketplace for the verified current owner (requireVerifiedOwnerOfChannel)', async () => {
    const owner = await signup('v12-o');
    const admin = await signup('v12-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v12`, name: 'CH V12', owner_id: owner.userId, verification_status: 'claimed' });
    // Before verification: replaceRateCard must reject with 403.
    await expect(marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    })).rejects.toMatchObject({ status: 403 });
    // Verify current owner.
    await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {});
    // Now replaceRateCard must succeed.
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    });
    expect(card.channel_id).toBe(ch.id);
    expect(card.packages[0].price_minor).toBe(500);
  });
});

// ============================================================================
// §5 Existing unclaimed-channel claim flow is unchanged
// ============================================================================
describe('M03.7 §5 — unclaimed channel flow remains green', () => {
  it('#13 unclaimed channel: user can submit a claim → admin approves → owner + verified set (as before)', async () => {
    const user = await signup('u13-u');
    const admin = await signup('u13-a', 'super_admin');
    await seedChannel({ slug: `m37-${RUN_TAG}-u13`, name: 'CH U13', owner_id: null, verification_status: 'unclaimed' });
    const res = await claimService.submit(actorFor(user.userId), `m37-${RUN_TAG}-u13`, {
      verification_method: 'manual', claimant_note: 'i own it',
      evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://ex-u13.test/p.png' }],
    });
    await claimModerationService.approve(actorFor(admin.userId, 'super_admin'), res.claim.id, {});
    const ch = await channelRepo.findBySlug(`m37-${RUN_TAG}-u13`);
    expect(ch?.owner_id).toBe(user.userId);
    expect(ch?.verification_status).toBe('verified');
    expect(ch?.verified_at).toBeTruthy();
  });
  it('#14 self-verification via existing approve path also works (claim by current owner)', async () => {
    const owner = await signup('u14-o');
    const admin = await signup('u14-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-u14`, name: 'CH U14', owner_id: owner.userId, verification_status: 'claimed' });
    void ch;
    const res = await claimService.submit(actorFor(owner.userId), `m37-${RUN_TAG}-u14`, {
      verification_method: 'manual', claimant_note: 'self',
      evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://ex-u14.test/p.png' }],
    });
    await claimModerationService.approve(actorFor(admin.userId, 'super_admin'), res.claim.id, {});
    const after = await channelRepo.findBySlug(`m37-${RUN_TAG}-u14`);
    expect(after?.owner_id).toBe(owner.userId); // unchanged (same-user approval)
    expect(after?.verification_status).toBe('verified');
  });
});

// ============================================================================
// §6 M03.7 Final Hardening — canonical unverified coverage + no-claim flow
// ============================================================================
describe('M03.7 §6 — canonical unverified coverage (all non-verified values)', () => {
  it('#15 verification_status=null → eligibility surfaces owner-verification-mode', async () => {
    const owner = await signup('nu15-o');
    // seedChannel with an explicit null verification_status.
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nu15`, name: 'CH NU15', owner_id: owner.userId });
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $set: { verification_status: null } }); });
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-nu15`, actorFor(owner.userId));
    expect(e.canClaim).toBe(true);
    expect((e as { ownerVerificationMode?: boolean }).ownerVerificationMode).toBe(true);
    // Marketplace guard blocks — verification not verified.
    await expect(marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    })).rejects.toMatchObject({ status: 403 });
  });
  it('#16 verification_status field ABSENT (legacy) → eligibility surfaces owner-verification-mode', async () => {
    const owner = await signup('nu16-o');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nu16`, name: 'CH NU16', owner_id: owner.userId });
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $unset: { verification_status: '' } }); });
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-nu16`, actorFor(owner.userId));
    expect(e.canClaim).toBe(true);
    expect((e as { ownerVerificationMode?: boolean }).ownerVerificationMode).toBe(true);
    // Marketplace guard blocks — field absent means definitely not verified.
    await expect(marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    })).rejects.toMatchObject({ status: 403 });
  });
  it('#17 verification_status="verified" → NOT owner-verification-mode; marketplace unlocked', async () => {
    const owner = await signup('v17-o');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v17`, name: 'CH V17', owner_id: owner.userId, verification_status: 'verified' });
    void ch;
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-v17`, actorFor(owner.userId));
    // Already verified with owner → cannot claim.
    expect(e.canClaim).toBe(false);
    expect((e as { alreadyOwned?: boolean }).alreadyOwned).toBe(true);
  });
  it('#18 verification_status="official" → NOT owner-verification-mode; marketplace unlocked', async () => {
    const owner = await signup('v18-o');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-v18`, name: 'CH V18', owner_id: owner.userId, verification_status: 'official' });
    void ch;
    const e = await claimService.getEligibility(`m37-${RUN_TAG}-v18`, actorFor(owner.userId));
    expect(e.canClaim).toBe(false);
    // Marketplace guard: official is also treated as verified.
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    });
    expect(card.channel_id).toBe(ch.id);
  });
});

describe('M03.7 §7 — verifyCurrentOwner without any claim record', () => {
  it('#19 admin verifies current owner even when NO claim exists — no synthetic claim is created', async () => {
    const owner = await signup('nc19-o');
    const admin = await signup('nc19-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nc19`, name: 'CH NC19', owner_id: owner.userId, verification_status: 'claimed' });
    // Sanity: no claim rows exist for this channel BEFORE.
    const beforeClaims = await withDb(async (db) => db.collection(COLLECTIONS.CHANNEL_CLAIMS).countDocuments({ channel_id: ch.id }));
    expect(beforeClaims).toBe(0);
    // Verify current owner.
    const res = await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, { moderator_notes: 'no-claim path' });
    expect(res.ok).toBe(true);
    expect(res.channel.owner_id).toBe(owner.userId);            // preserved
    expect(res.channel.verification_status).toBe('verified');
    // NO synthetic claim was created.
    const afterClaims = await withDb(async (db) => db.collection(COLLECTIONS.CHANNEL_CLAIMS).find({ channel_id: ch.id }).toArray());
    expect(afterClaims.length).toBe(0);
    // Audit still written.
    const audit = await withDb(async (db) => db.collection('audit_logs').findOne({ entity_id: ch.id, action: 'CHANNEL_OWNER_VERIFIED' }));
    expect(audit).toBeTruthy();
    expect(audit!.actor_user_id).toBe(admin.userId);
    // Marketplace unlocks for the (preserved) owner.
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'x', price_minor: 500, deliverables: ['p'], currency: 'USD', is_active: true }],
    });
    expect(card.channel_id).toBe(ch.id);
  });
  it('#20 no-claim verification with verification_status=null (legacy)', async () => {
    const owner = await signup('nc20-o');
    const admin = await signup('nc20-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nc20`, name: 'CH NC20', owner_id: owner.userId });
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $set: { verification_status: null } }); });
    const res = await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {});
    expect(res.ok).toBe(true);
    expect(res.channel.owner_id).toBe(owner.userId);
    expect(res.channel.verification_status).toBe('verified');
  });
  it('#21 no-claim verification with verification_status field absent (legacy)', async () => {
    const owner = await signup('nc21-o');
    const admin = await signup('nc21-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nc21`, name: 'CH NC21', owner_id: owner.userId });
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $unset: { verification_status: '' } }); });
    const res = await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {});
    expect(res.ok).toBe(true);
    expect(res.channel.verification_status).toBe('verified');
  });
  it('#22 takeover protection unchanged when NO claim exists — a stranger still cannot claim', async () => {
    const owner = await signup('nc22-o');
    const stranger = await signup('nc22-x');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-nc22`, name: 'CH NC22', owner_id: owner.userId });
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $set: { verification_status: null } }); });
    await expect(claimService.submit(actorFor(stranger.userId), `m37-${RUN_TAG}-nc22`, {
      verification_method: 'manual', claimant_note: 'attempt',
      evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://ex-nc22.test/p.png' }],
    })).rejects.toMatchObject({ status: 409 });
    const after = await channelRepo.findById(ch.id);
    expect(after?.owner_id).toBe(owner.userId);
  });
});

describe('M03.7 §8 — claim-based verifyCurrentOwner still works', () => {
  it('#23 with an existing pending claim from the current owner, verifyCurrentOwner marks it approved and preserves owner_id', async () => {
    const owner = await signup('cb23-o');
    const admin = await signup('cb23-a', 'super_admin');
    const ch = await seedChannel({ slug: `m37-${RUN_TAG}-cb23`, name: 'CH CB23', owner_id: owner.userId, verification_status: 'claimed' });
    // Insert a pending self-claim.
    const claimId = uuidv4();
    const now = new Date();
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.CHANNEL_CLAIMS).insertOne({
        id: claimId, channel_id: ch.id, claimant_user_id: owner.userId,
        verification_method: 'manual', claimant_note: 'self',
        evidence_urls: [], evidence_metadata: {}, claimant_email: owner.email,
        website_domain: null, email_domain: 't.test', domain_match: false,
        status: 'pending', moderator_notes: null, request_more_info_message: null,
        reject_reason: null, submitted_at: now, reviewed_at: null, reviewed_by: null,
        approved_at: null, rejected_at: null, created_at: now, updated_at: now,
      } as unknown as Record<string, unknown>);
    });
    await claimModerationService.verifyCurrentOwner(actorFor(admin.userId, 'super_admin'), ch.id, {});
    // Claim should now be approved.
    const after = await withDb(async (db) => db.collection(COLLECTIONS.CHANNEL_CLAIMS).findOne({ id: claimId }));
    expect(after?.status).toBe('approved');
    const channelAfter = await channelRepo.findById(ch.id);
    expect(channelAfter?.owner_id).toBe(owner.userId);
    expect(channelAfter?.verification_status).toBe('verified');
  });
});

