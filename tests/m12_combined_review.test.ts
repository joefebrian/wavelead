// M12 — Combined Listing + Ownership review tests.
// Verifies: (a) claimService allows the linked owner to file proof while the
// listing is pending_review (and blocks non-owners), (b) filing a claim never
// verifies ownership, (c) the combined admin action approves BOTH transitions
// with separate audit events using the existing activation helper, (d) failure
// safety (rollback), (e) no PayPal/credit side-effects, (f) missing-claim guard.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { claimService } from '@/lib/services/claimService';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { combinedReviewService } from '@/lib/services/combinedReviewService';
import { moderationService } from '@/lib/services/moderationService';
import { isActivationRequired } from '@/lib/services/payments/activationFlag';
import type { Actor, Channel } from '@/lib/types';

const RUN_TAG = `m12-${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
function actorFor(user_id: string, role: 'user' | 'moderator' | 'admin' | 'super_admin' = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}
async function seedUser(tag: string): Promise<string> {
  const id = `${RUN_TAG}-${tag}`;
  await withDb(async (db) => { await db.collection('users').insertOne({ id, email: `${id}@t.test`, role: 'user', display_name: id, created_at: new Date(), updated_at: new Date(), is_test_fixture: true } as Record<string, unknown>); });
  return id;
}
async function seedChannel(overrides: Partial<Channel> & { slug: string; name: string }): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const { slug, name, ...rest } = overrides;
  const doc = {
    id, slug, name,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'test', short_description: 'test',
    logo_url: null, cover_url: null, website_url: 'https://proof.example', country_code: 'US', primary_language: 'en',
    category_id: null, owner_id: rest.owner_id ?? null,
    status: (rest.status ?? 'pending_review'),
    verification_status: (rest.verification_status ?? 'unclaimed'),
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 5000, follower_count_source: 'seed', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: null,
    reviewed_by: null, reviewed_at: null, rejection_reason: null, rejection_notes: null,
    is_test_fixture: true, verified_at: null,
    ...rest,
  } as unknown as Channel;
  await withDb(async (db) => { await db.collection('channels').insertOne(doc as unknown as Record<string, unknown>); });
  return doc;
}
async function submitOwnerClaim(ownerId: string, slug: string) {
  return claimService.submit(actorFor(ownerId), slug, {
    verification_method: 'manual',
    claimant_note: 'I own this channel',
    evidence_urls: [{ evidence_type: 'other', evidence_url: 'https://proof.example/proof.png' }],
  });
}
async function purge() {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: new RegExp(`^${RUN_TAG}`) });
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ claimant_user_id: new RegExp(`^${RUN_TAG}`) });
    await db.collection('users').deleteMany({ id: new RegExp(`^${RUN_TAG}`) });
  });
}
beforeAll(purge);
afterAll(purge);

describe('M12 §A — pending_review claim eligibility', () => {
  it('#1 linked owner CAN file a claim while pending_review', async () => {
    const owner = await seedUser('a1o');
    const slug = `${RUN_TAG}-a1`;
    await seedChannel({ slug, name: 'A1', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    const e = await claimService.getEligibility(slug, actorFor(owner));
    expect(e.canClaim).toBe(true);
    expect((e as { ownerVerificationMode?: boolean }).ownerVerificationMode).toBe(true);
    const res = await submitOwnerClaim(owner, slug);
    expect(res.claim.claimant_user_id).toBe(owner);
    // #4 filing does NOT verify ownership
    const ch = await channelRepo.findBySlug(slug);
    expect(ch?.verification_status).toBe('unclaimed');
    expect(ch?.status).toBe('pending_review');
  });

  it('#2 unrelated user CANNOT claim a pending_review channel', async () => {
    const owner = await seedUser('a2o');
    const stranger = await seedUser('a2s');
    const slug = `${RUN_TAG}-a2`;
    await seedChannel({ slug, name: 'A2', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    const e = await claimService.getEligibility(slug, actorFor(stranger));
    expect(e.canClaim).toBe(false);
    await expect(submitOwnerClaim(stranger, slug)).rejects.toBeTruthy();
  });

  it('#3 approved-channel claim behavior unchanged (unowned → canClaim true)', async () => {
    const slug = `${RUN_TAG}-a3`;
    await seedChannel({ slug, name: 'A3', owner_id: null, status: 'approved', verification_status: 'unclaimed' });
    const someone = await seedUser('a3u');
    const e = await claimService.getEligibility(slug, actorFor(someone));
    expect(e.canClaim).toBe(true);
  });
});

describe('M12 §B — combined Approve Listing + Ownership', () => {
  it('#5 approves BOTH listing + ownership, no partial state, activation from helper', async () => {
    const owner = await seedUser('b5o');
    const admin = await seedUser('b5adm');
    const slug = `${RUN_TAG}-b5`;
    const ch = await seedChannel({ slug, name: 'B5', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await submitOwnerClaim(owner, slug);

    const out = await combinedReviewService.approveListingAndOwnership(actorFor(admin, 'super_admin'), ch.id, {});
    expect(out.ok).toBe(true);
    expect(out.channel_status).toBe('approved');
    expect(out.verification_status).toBe('verified');
    // activation_status must come from the EXISTING helper (never 'active' here)
    const expectedActivation = isActivationRequired() ? 'pending' : 'not_required';
    expect(out.activation_status).toBe(expectedActivation);
    expect(out.activation_status).not.toBe('active');

    const after = await channelRepo.findById(ch.id);
    expect(after?.owner_id).toBe(owner);          // owner preserved
    expect(after?.status).toBe('approved');
    expect(after?.verification_status).toBe('verified');
  });

  it('#6 writes separate audit events for listing + ownership', async () => {
    const owner = await seedUser('b6o');
    const admin = await seedUser('b6adm');
    const slug = `${RUN_TAG}-b6`;
    const ch = await seedChannel({ slug, name: 'B6', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await submitOwnerClaim(owner, slug);
    await combinedReviewService.approveListingAndOwnership(actorFor(admin, 'super_admin'), ch.id, {});
    await withDb(async (db) => {
      const listing = await db.collection('audit_logs').countDocuments({ entity_id: ch.id, action: 'ADMIN_APPROVE_CHANNEL' });
      const ownerAssigned = await db.collection('audit_logs').countDocuments({ entity_id: ch.id, action: 'CHANNEL_OWNER_ASSIGNED' });
      expect(listing).toBeGreaterThanOrEqual(1);
      expect(ownerAssigned).toBeGreaterThanOrEqual(1);
    });
  });

  it('#7 no PayPal order and no WaveLead credit created during approval', async () => {
    const owner = await seedUser('b7o');
    const admin = await seedUser('b7adm');
    const slug = `${RUN_TAG}-b7`;
    const ch = await seedChannel({ slug, name: 'B7', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await submitOwnerClaim(owner, slug);
    await combinedReviewService.approveListingAndOwnership(actorFor(admin, 'super_admin'), ch.id, {});
    await withDb(async (db) => {
      const pays = await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments({ channel_id: ch.id });
      const credits = await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).countDocuments({ user_id: owner });
      expect(pays).toBe(0);
      expect(credits).toBe(0);
    });
  });

  it('#8 missing ownership claim → combined action rejected, listing stays pending', async () => {
    const owner = await seedUser('b8o');
    const admin = await seedUser('b8adm');
    const slug = `${RUN_TAG}-b8`;
    const ch = await seedChannel({ slug, name: 'B8', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await expect(combinedReviewService.approveListingAndOwnership(actorFor(admin, 'super_admin'), ch.id, {})).rejects.toBeTruthy();
    const after = await channelRepo.findById(ch.id);
    expect(after?.status).toBe('pending_review');
    expect(after?.verification_status).toBe('unclaimed');
  });

  it('#9 ownership approval failure rolls back listing approval (no partial commit)', async () => {
    const owner = await seedUser('b9o');
    const admin = await seedUser('b9adm');
    const slug = `${RUN_TAG}-b9`;
    const ch = await seedChannel({ slug, name: 'B9', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await submitOwnerClaim(owner, slug);
    const spy = vi.spyOn(claimModerationService, 'approve').mockRejectedValueOnce(new Error('forced ownership failure'));
    await expect(combinedReviewService.approveListingAndOwnership(actorFor(admin, 'super_admin'), ch.id, {})).rejects.toBeTruthy();
    spy.mockRestore();
    const after = await channelRepo.findById(ch.id);
    expect(after?.status).toBe('pending_review');   // rolled back
    expect(after?.verification_status).toBe('unclaimed');
  });

  it('#10 Approve Listing Only remains unchanged (no ownership verified)', async () => {
    const owner = await seedUser('b10o');
    const admin = await seedUser('b10adm');
    const slug = `${RUN_TAG}-b10`;
    const ch = await seedChannel({ slug, name: 'B10', owner_id: owner, status: 'pending_review', verification_status: 'unclaimed' });
    await submitOwnerClaim(owner, slug);
    await moderationService.approve(actorFor(admin, 'super_admin'), ch.id);
    const after = await channelRepo.findById(ch.id);
    expect(after?.status).toBe('approved');
    expect(after?.verification_status).toBe('unclaimed');  // listing-only never verifies ownership
  });
});
