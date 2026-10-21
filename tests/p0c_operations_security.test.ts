// P0C — Operations enablement & ownership security: targeted tests.
//   §1 Moderator role assignment (super_admin only, audited, sessions invalidated)
//   §2 Sourcing designation authorization + audit
//   §3 Reviewer self-review prevention (claims, verify-current-owner, combined, release)
//   §4 Sourcing-agent claim restrictions + Fast Verification fallback
//   §5 Reviewer/source overlap on legitimate third-party claims
//   §6 Verified ownership protection + accurate audit
//   §7 Admin-only recent-submitter lookup + public non-exposure
//   §8 Sourcing scoreboard + Asia/Jakarta day boundaries
//   §9 Ordinary creator submission regression
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { roleAssignmentService } from '@/lib/services/security/roleAssignmentService';
import { sourcingAgentService } from '@/lib/services/sourcingAgentService';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { combinedReviewService } from '@/lib/services/combinedReviewService';
import { ownershipReleaseService } from '@/lib/services/ownershipReleaseService';
import { claimService } from '@/lib/services/claimService';
import { submissionService } from '@/lib/services/submissionService';
import { fastOwnershipConflictReason } from '@/lib/services/activationOwnershipConflict';
import { operationsReportService, jakartaDay, jakartaDayStart } from '@/lib/services/operationsReportService';
import { sanitizeChannel } from '@/lib/utils/sanitize';

const RUN = `p0c${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
let client: MongoClient;
let db: Db;
type R = 'user' | 'channel_owner' | 'moderator' | 'admin' | 'super_admin';

function actorFor(id: string, role: R = 'user'): Actor {
  return {
    user: { id, email: `${RUN}-${id.slice(0, 6)}@t.local`, display_name: 'T', role, is_active: true },
    session: { user_id: id, jti: 't', role, iat: 0, exp: 0 }, role,
  } as unknown as Actor;
}
async function seedUser(role: R = 'user', over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: `${RUN}-user`, role,
    is_active: true, password_hash: 'x', session_version: 0, created_at: new Date(), updated_at: new Date(), ...over,
  } as never);
  return id;
}
async function seedChannel(over: Record<string, unknown> = {}, visible = false): Promise<Channel> {
  const id = uuidv4(); const now = new Date(); const hex = id.replace(/-/g, '');
  const doc = {
    id, slug: `${RUN}-${hex.slice(0, 8)}`, name: `P0C Channel ${hex.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${hex.slice(0, 22)}`, whatsapp_channel_id: hex.slice(0, 22),
    short_description: 'Ops security test listing', description: null, logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, submitted_by: null, status: 'approved', verification_status: 'unclaimed', activation_status: 'not_required',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false, activity_level: 'active',
    follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    ...(visible ? {} : { is_test_fixture: true }), ...over,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}
async function seedClaim(channelId: string, claimantId: string, status = 'pending') {
  const id = uuidv4(); const now = new Date();
  await db.collection(COLLECTIONS.CHANNEL_CLAIMS).insertOne({
    id, channel_id: channelId, claimant_user_id: claimantId, verification_method: 'manual',
    claimant_note: `${RUN} note`, evidence_urls: [], evidence_metadata: {}, claimant_email: `${RUN}@t.local`,
    website_domain: null, email_domain: 't.local', domain_match: false, status,
    moderator_notes: null, request_more_info_message: null, reject_reason: null,
    submitted_at: now, reviewed_at: null, reviewed_by: null, approved_at: null, rejected_at: null, created_at: now, updated_at: now,
  } as never);
  return id;
}
const ch = async (id: string) => (await db.collection(COLLECTIONS.CHANNELS).findOne({ id })) as unknown as Channel & Record<string, unknown>;
const user = async (id: string) => (await db.collection(COLLECTIONS.USERS).findOne({ id })) as unknown as Record<string, unknown>;
const NOTES = 'Reviewed admin-domain email match and channel admin screenshot.';

beforeAll(async () => {
  process.env.SMTP_HOST = 'smtp.test.local';
  client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  db = client.db(process.env.DB_NAME || 'wavelead');
});
afterAll(async () => {
  const rx = new RegExp(RUN);
  const ids = (await db.collection(COLLECTIONS.CHANNELS).find({ slug: rx }).project({ id: 1 }).toArray()).map((c) => c.id);
  const uids = (await db.collection(COLLECTIONS.USERS).find({ email: rx }).project({ id: 1 }).toArray()).map((u) => u.id);
  await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
  if (ids.length) {
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ channel_id: { $in: ids } });
    await db.collection(COLLECTIONS.AUDIT_LOGS).deleteMany({ entity_id: { $in: ids } });
  }
  await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ claimant_user_id: { $in: uids } });
  await db.collection(COLLECTIONS.AUDIT_LOGS).deleteMany({ entity_id: { $in: uids } });
  await db.collection(COLLECTIONS.SECURITY_AUDIT_EVENTS).deleteMany({ subject_user_id: { $in: uids } });
  await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
  await client.close();
});

// ---------------------------------------------------------------------------
describe('§1 moderator role assignment', () => {
  it('only super_admin may assign; admin and moderator are refused', async () => {
    const t = await seedUser('user');
    await expect(roleAssignmentService.setModerator(actorFor(await seedUser('admin'), 'admin'), t, true, 'operations reviewer')).rejects.toMatchObject({ status: 403 });
    await expect(roleAssignmentService.setModerator(actorFor(await seedUser('moderator'), 'moderator'), t, true, 'operations reviewer')).rejects.toMatchObject({ status: 403 });
    await expect(roleAssignmentService.setModerator(null, t, true, 'operations reviewer')).rejects.toMatchObject({ status: 401 });
    expect((await user(t)).role).toBe('user');
  });
  it('requires a reason, refuses self-change and never touches admin accounts', async () => {
    const sa = await seedUser('super_admin');
    const t = await seedUser('user');
    await expect(roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), t, true, 'short')).rejects.toMatchObject({ status: 400 });
    await expect(roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), sa, false, 'demote myself please')).rejects.toMatchObject({ status: 400 });
    const adm = await seedUser('admin');
    await expect(roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), adm, false, 'demote an admin account')).rejects.toMatchObject({ status: 403 });
    await expect(roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), adm, true, 'demote an admin account')).rejects.toMatchObject({ status: 403 });
    expect((await user(adm)).role).toBe('admin');
  });
  it('grant → moderator with sessions invalidated + audit; revoke restores the prior role', async () => {
    const sa = await seedUser('super_admin');
    const t = await seedUser('channel_owner', { is_sourcing_agent: true });
    const r = await roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), t, true, 'Ownership reviewer for ops');
    expect(r).toMatchObject({ role: 'moderator', changed: true });
    const u1 = await user(t);
    expect(u1.role).toBe('moderator');
    expect(u1.session_version).toBe(1);
    expect(u1.is_sourcing_agent).toBe(true); // untouched
    expect(await db.collection(COLLECTIONS.SECURITY_AUDIT_EVENTS).countDocuments({ subject_user_id: t, event_type: 'USER_ROLE_MODERATOR_GRANTED' })).toBe(1);
    expect(await db.collection(COLLECTIONS.AUDIT_LOGS).countDocuments({ entity_id: t, action: 'USER_ROLE_MODERATOR_GRANTED' })).toBe(1);
    // idempotent
    expect((await roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), t, true, 'Ownership reviewer for ops')).changed).toBe(false);
    const r2 = await roleAssignmentService.setModerator(actorFor(sa, 'super_admin'), t, false, 'Rotation ended for this account');
    expect(r2.role).toBe('channel_owner');
    expect((await user(t)).session_version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('§2 sourcing designation', () => {
  it('moderator cannot designate; admin can with audit; designation grants no role', async () => {
    const t = await seedUser('user');
    await expect(sourcingAgentService.setDesignation(actorFor(await seedUser('moderator'), 'moderator'), t, true, 'daily sourcing')).rejects.toMatchObject({ status: 403 });
    const adm = await seedUser('admin');
    await sourcingAgentService.setDesignation(actorFor(adm, 'admin'), t, true, 'daily sourcing');
    const u = await user(t);
    expect(u.is_sourcing_agent).toBe(true);
    expect(u.role).toBe('user');
    expect(await db.collection(COLLECTIONS.AUDIT_LOGS).countDocuments({ entity_id: t, action: 'SOURCING_AGENT_DESIGNATED' })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('§3 reviewer self-review prevention', () => {
  it('a moderator cannot approve, reject or request info on their own claim', async () => {
    const mod = await seedUser('moderator');
    const c = await seedChannel();
    const claim = await seedClaim(c.id, mod);
    await expect(claimModerationService.approve(actorFor(mod, 'moderator'), claim, { moderator_notes: NOTES })).rejects.toMatchObject({ status: 403 });
    await expect(claimModerationService.reject(actorFor(mod, 'moderator'), claim, { reason: 'insufficient_evidence' })).rejects.toMatchObject({ status: 403 });
    await expect(claimModerationService.requestInfo(actorFor(mod, 'moderator'), claim, { message: 'please add more evidence' })).rejects.toMatchObject({ status: 403 });
    expect((await ch(c.id)).owner_id).toBeNull();
  });
  it('a reviewer cannot verify a channel linked to their own account', async () => {
    const mod = await seedUser('moderator');
    const c = await seedChannel({ owner_id: mod, submitted_by: mod });
    await expect(claimModerationService.verifyCurrentOwner(actorFor(mod, 'moderator'), c.id)).rejects.toMatchObject({ status: 403 });
    expect((await ch(c.id)).verification_status).toBe('unclaimed');
  });
  it('a reviewer cannot combined-approve their own pending listing', async () => {
    const mod = await seedUser('moderator');
    const c = await seedChannel({ owner_id: mod, submitted_by: mod, status: 'pending_review', published_at: null });
    await seedClaim(c.id, mod);
    await expect(combinedReviewService.approveListingAndOwnership(actorFor(mod, 'moderator'), c.id)).rejects.toMatchObject({ status: 403 });
    expect((await ch(c.id)).status).toBe('pending_review');
  });
  it('an admin cannot release an ownership link held by their own account', async () => {
    const adm = await seedUser('admin');
    const c = await seedChannel({ owner_id: adm, submitted_by: adm });
    await expect(ownershipReleaseService.releaseUnverifiedLink(actorFor(adm, 'admin'), c.id, {
      expected_owner_user_id: adm, reason: 'self release attempt here', evidence_ref: 'TCK-1',
    })).rejects.toMatchObject({ status: 403 });
    expect((await ch(c.id)).owner_id).toBe(adm);
  });
  it('a different admin may still release (P0B release preserved)', async () => {
    const owner = await seedUser('user');
    const c = await seedChannel({ owner_id: owner, submitted_by: owner });
    const res = await ownershipReleaseService.releaseUnverifiedLink(actorFor(await seedUser('admin'), 'admin'), c.id, {
      expected_owner_user_id: owner, reason: 'Staff-sourced legacy link verified', evidence_ref: 'TCK-2', acknowledge_warnings: true,
    });
    expect(res.released).toBe(true);
    expect((await ch(c.id)).owner_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('§4 sourcing-agent restrictions', () => {
  it('the sourcing agent cannot file a claim on a listing they sourced', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, sourced_at: new Date() });
    await expect(claimService.submit(actorFor(agent, 'user'), c.slug, { verification_method: 'manual', claimant_note: 'mine' })).rejects.toMatchObject({ status: 403 });
  });
  it('a legacy sourcer claim cannot be approved by a moderator; admin needs written evidence', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, sourced_at: new Date() });
    const claim = await seedClaim(c.id, agent);
    await expect(claimModerationService.approve(actorFor(await seedUser('moderator'), 'moderator'), claim, { moderator_notes: NOTES })).rejects.toMatchObject({ status: 403 });
    await expect(claimModerationService.approve(actorFor(await seedUser('admin'), 'admin'), claim, {})).rejects.toMatchObject({ status: 400 });
    expect((await ch(c.id)).owner_id).toBeNull();
  });
  it('the staff-sourced original submitter never gets the Fast Verification fallback', async () => {
    const agent = uuidv4();
    const c = { id: 'x', status: 'approved', owner_id: null, verification_status: 'unclaimed', source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent } as unknown as Channel;
    expect(fastOwnershipConflictReason(c, agent)).toBe('sourcing_agent_not_owner');
    const c2 = { ...c, sourced_by_user_id: 'someone-else' } as unknown as Channel;
    expect(fastOwnershipConflictReason(c2, agent)).toBe('sourcing_agent_not_owner');
    // Ordinary owner-submitted fallback remains intact.
    const own = { ...c, source: 'owner_self', sourced_by_user_id: null } as unknown as Channel;
    expect(fastOwnershipConflictReason(own, agent)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('§5 reviewer/source overlap on a third-party claim', () => {
  it('requires written evidence, refuses contested listings, then approves with audit', async () => {
    const reviewer = await seedUser('moderator', { is_sourcing_agent: true });
    const claimant = await seedUser('user');
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: reviewer, submitted_by: reviewer, sourced_at: new Date() });
    const claim = await seedClaim(c.id, claimant);
    await expect(claimModerationService.approve(actorFor(reviewer, 'moderator'), claim, {})).rejects.toMatchObject({ status: 400 });
    const rival = await seedClaim(c.id, await seedUser('user'));
    await expect(claimModerationService.approve(actorFor(reviewer, 'moderator'), claim, { moderator_notes: NOTES })).rejects.toMatchObject({ status: 409 });
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).updateOne({ id: rival }, { $set: { status: 'rejected' } });
    await claimModerationService.approve(actorFor(reviewer, 'moderator'), claim, { moderator_notes: NOTES });
    const after = await ch(c.id);
    expect(after.owner_id).toBe(claimant);
    expect(after.verification_status).toBe('verified');
    expect(after.verified_by).toBe(reviewer);
    const cl = await db.collection(COLLECTIONS.CHANNEL_CLAIMS).findOne({ id: claim });
    expect(cl?.reviewer_source_overlap).toBe(true);
    const audit = await db.collection(COLLECTIONS.AUDIT_LOGS).findOne({ entity_id: c.id, action: 'CHANNEL_OWNER_ASSIGNED' });
    expect(audit?.before_data).toMatchObject({ owner_id: null, verification_status: 'unclaimed', source: 'staff_sourced', sourced_by_user_id: reviewer });
    expect(audit?.after_data).toMatchObject({ owner_id: claimant, reviewer_source_overlap: true, verified_by: reviewer });
  });
  it('a legitimate third-party claim with no overlap approves normally', async () => {
    const claimant = await seedUser('user');
    const c = await seedChannel({ source: 'staff_sourced', sourced_by_user_id: uuidv4(), sourced_at: new Date() });
    const claim = await seedClaim(c.id, claimant);
    await claimModerationService.approve(actorFor(await seedUser('moderator'), 'moderator'), claim, {});
    expect((await ch(c.id)).owner_id).toBe(claimant);
  });
});

// ---------------------------------------------------------------------------
describe('§6 verified ownership protection', () => {
  it('a claim can never overwrite a verified owner', async () => {
    const owner = await seedUser('user');
    const c = await seedChannel({ owner_id: owner, verification_status: 'verified', verified_at: new Date() });
    const claim = await seedClaim(c.id, await seedUser('user'));
    await expect(claimModerationService.approve(actorFor(await seedUser('moderator'), 'moderator'), claim, {})).rejects.toMatchObject({ status: 409 });
    expect((await ch(c.id)).owner_id).toBe(owner);
  });
  it('verify-current-owner by a different reviewer records verified_by', async () => {
    const owner = await seedUser('user');
    const mod = await seedUser('moderator');
    const c = await seedChannel({ owner_id: owner, submitted_by: owner });
    await claimModerationService.verifyCurrentOwner(actorFor(mod, 'moderator'), c.id);
    const after = await ch(c.id);
    expect(after.verification_status).toBe('verified');
    expect(after.verified_by).toBe(mod);
    expect(sanitizeChannel(after as Channel)).not.toHaveProperty('verified_by');
  });
});

// ---------------------------------------------------------------------------
describe('§7 recent-submitter lookup', () => {
  it('is admin-only and returns submitter / owner / provenance', async () => {
    const sub = await seedUser('user');
    const c = await seedChannel({ owner_id: sub, submitted_by: sub, source: 'owner_self' }, true);
    await expect(operationsReportService.recentSubmissions(actorFor(await seedUser('moderator'), 'moderator'))).rejects.toMatchObject({ status: 403 });
    await expect(operationsReportService.recentSubmissions(null)).rejects.toMatchObject({ status: 401 });
    const res = await operationsReportService.recentSubmissions(actorFor(await seedUser('admin'), 'admin'), { days: 1, limit: 200 });
    const row = res.items.find((r) => r.channel_id === c.id);
    expect(row).toBeTruthy();
    expect(row!.submitter?.id).toBe(sub);
    expect(row!.linked_owner?.id).toBe(sub);
    expect(row!.submitter_is_linked_owner).toBe(true);
    expect(row!.source).toBe('owner_self');
    expect(row!.claim_eligibility).toBe('linked_to_account_unverified');
    // Never public.
    const pub = sanitizeChannel((await ch(c.id)) as Channel) as unknown as Record<string, unknown>;
    for (const k of ['owner_id', 'submitted_by', 'sourced_by_user_id', 'source', 'verified_by']) expect(pub).not.toHaveProperty(k);
  });
});

// ---------------------------------------------------------------------------
describe('§8 sourcing scoreboard + Jakarta boundaries', () => {
  it('Jakarta day boundaries are UTC+7', () => {
    expect(jakartaDay(new Date('2026-10-21T16:59:59Z'))).toBe('2026-10-21');
    expect(jakartaDay(new Date('2026-10-21T17:00:00Z'))).toBe('2026-10-22');
    expect(jakartaDayStart(new Date('2026-10-21T18:00:00Z'), 0).toISOString()).toBe('2026-10-21T17:00:00.000Z');
    expect(jakartaDayStart(new Date('2026-10-21T10:00:00Z'), 1).toISOString()).toBe('2026-10-19T17:00:00.000Z');
  });
  it('counts per agent per Jakarta day from real rows; duplicates are Not tracked', async () => {
    const agent = await seedUser('user', { is_sourcing_agent: true });
    const claimant = await seedUser('user');
    const now = new Date();
    const base = { source: 'staff_sourced', sourced_by_user_id: agent, submitted_by: agent, sourced_at: now };
    await seedChannel({ ...base }, true);                                         // approved public
    await seedChannel({ ...base, status: 'pending_review', published_at: null }, true);
    await seedChannel({ ...base, status: 'rejected', published_at: null }, true);
    const claimed = await seedChannel({ ...base, owner_id: claimant, verification_status: 'verified' }, true);
    await seedClaim(claimed.id, claimant, 'approved');
    const board = await operationsReportService.sourcingScoreboard(actorFor(await seedUser('moderator'), 'moderator'), 2);
    const row = board.items.find((r) => r.user_id === agent && r.day === jakartaDay(now));
    expect(row).toMatchObject({
      submitted: 4, accepted_unique: 3, approved_public: 2, pending_moderation: 1, rejected: 1,
      ownership_claims: 1, claimed_by_owner: 1, verified_conversions: 1, duplicate_attempts: null, target: 100, progress_pct: 3,
    });
    expect(board.timezone).toBe('Asia/Jakarta');
    expect(board.duplicate_attempts_tracked).toBe(false);
    await expect(operationsReportService.sourcingScoreboard(actorFor(await seedUser('user'), 'user'))).rejects.toMatchObject({ status: 403 });
    const split = await operationsReportService.inventorySplit(actorFor(await seedUser('moderator'), 'moderator'));
    expect(split.staff_sourced_public).toBeGreaterThanOrEqual(2);
    expect(split.sponsorship_ready).toBeLessThanOrEqual(split.verified_owners);
  });
});

// ---------------------------------------------------------------------------
describe('§9 ordinary creator submission regression', () => {
  it('a non-agent submission still links the submitter as owner (owner_self)', async () => {
    const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ is_active: true } as never);
    if (!cat) return;
    const creator = await seedUser('user');
    const res = await submissionService.submit(actorFor(creator, 'user'), {
      name: `${RUN} Self Sub`, whatsapp_url: `https://whatsapp.com/channel/${uuidv4().replace(/-/g, '').slice(0, 22)}`,
      short_description: 'An owner submitted channel for regression coverage.', category_slug: cat.slug,
      country_code: 'ID', primary_language: 'id',
    });
    const created = await ch(res.channel.id);
    expect(created.owner_id).toBe(creator);
    expect(created.source).toBe('owner_self');
    expect(created.status).toBe('pending_review');
  });
});
