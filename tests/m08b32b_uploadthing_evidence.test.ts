// Phase B3.2 Gate B — UploadThing screenshot evidence tests.
//
// Scope proven:
//   §1  proof_attachments accepted alongside URLs — no public URL needed when screenshots present
//   §2  MIME allowlist: JPEG/PNG/WebP; SVG/GIF/PDF/video/executable rejected
//   §3  Max 5 attachments; over-cap rejected
//   §4  Size cap ≤ 5 MB per file server-side
//   §5  Notes-only submission is now rejected (Gate B tightening)
//   §6  Attachments preserved across revision (v0 attachments still queryable after v1)
//   §7  Existing URL-based delivery still works (backward-compatible)
//   §8  Unrelated owner cannot submit another owner's evidence
//   §9  Provider host allowlist enforced (*.ufs.sh / utfs.io only)
//
// Tests inject validated attachment metadata directly at the service layer —
// the UploadThing SDK is not invoked; production uploads go through the
// authenticated /api/uploadthing route which is exercised in review.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { marketplaceService } from '@/lib/services/marketplaceService';
import { marketplaceDeliverySubmissionRepo } from '@/lib/repositories/marketplaceRepo';
import type { Actor, Channel, MarketplaceOrder } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function signup(email: string, role?: string): Promise<{ userId: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId };
}

function actorFor(user_id: string, role = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}

async function seedChannel(ownerId: string, name = 'UT'): Promise<Channel> {
  const id = uuidv4();
  const slug = `ut-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug, name: `${name} ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Vd${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Vd${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'a completely-populated test channel description',
    short_description: 'a completely-populated test channel description',
    logo_url: 'https://example.com/logo.png', cover_url: null, website_url: null,
    country_code: 'US', follower_count: 5000, is_official: false, is_verified: true,
    verification_status: 'verified', owner_id: ownerId, category_id: null,
    tags: [], status: 'approved', view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, submitted_by: null, published_at: now, moderated_by: null, moderated_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc as unknown as Record<string, unknown>); });
  return doc as unknown as Channel;
}

async function inProgress(tag: string): Promise<{ owner: { userId: string }; buyer: { userId: string }; order: MarketplaceOrder }> {
  const owner = await signup(`ut-${RUN_TAG}-${tag}-o@t.test`);
  const buyer = await signup(`ut-${RUN_TAG}-${tag}-b@t.test`);
  const admin = await signup(`ut-${RUN_TAG}-${tag}-a@t.test`, 'admin');
  const ch = await seedChannel(owner.userId, tag);
  const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
    packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
  });
  const submitted = await marketplaceService.submitBooking(actorFor(buyer.userId), {
    channel_id: ch.id, package_id: card.packages[0].id,
    company_name: 'AcmeUT', contact_name: 'A', contact_email: 'a@t.test', campaign_objective: 'o', brief: 'b',
  });
  await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), submitted.id);
  const paid = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), submitted.id, {
    payment_method: 'bank_transfer', payment_reference: `UT-${RUN_TAG}-${tag}`,
    amount_received_minor: 25000, currency: 'USD',
    payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
  });
  await marketplaceService.startWork(actorFor(owner.userId), paid.id);
  return { owner, buyer, order: paid };
}

function utAttachment(overrides: Partial<{ storage_key: string; url: string; mime_type: string; file_name_safe: string; size_bytes: number }> = {}) {
  const key = overrides.storage_key ?? uuidv4();
  return {
    provider: 'uploadthing' as const,
    storage_key: key,
    url: overrides.url ?? `https://APPID.ufs.sh/f/${key}`,
    mime_type: (overrides.mime_type ?? 'image/png') as 'image/jpeg' | 'image/png' | 'image/webp',
    file_name_safe: overrides.file_name_safe ?? 'screenshot.png',
    size_bytes: overrides.size_bytes ?? 512 * 1024,
    uploaded_at: new Date().toISOString(),
  };
}

beforeAll(async () => {});
afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(`ut-${RUN_TAG}`);
    await db.collection('users').deleteMany({ email: rx });
    await db.collection('channels').deleteMany({ name: rx });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ 'brief.company_name': 'AcmeUT' });
    await db.collection(COLLECTIONS.MARKETPLACE_DELIVERY_SUBMISSIONS).deleteMany({});
  });
});

describe('B3.2 Gate B UploadThing §1 — Screenshot evidence submission', () => {
  it('#1 attachment ALONE (no delivery URL) is sufficient evidence', async () => {
    const { owner, order } = await inProgress('a1');
    const att = utAttachment();
    const done = await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      proof_attachments: [att],
    });
    expect(done.status).toBe('submitted_for_review');
    // Denorm attachment on the order for buyer review.
    expect(done.proof_attachments?.[0].storage_key).toBe(att.storage_key);
    expect(done.proof_attachments?.[0].mime_type).toBe('image/png');
    // Versioned submission row has the same attachment.
    const subs = await marketplaceDeliverySubmissionRepo.listByOrder(order.id);
    expect(subs[0].proof_attachments[0].url).toContain('ufs.sh');
  });

  it('#2 disallowed MIME types rejected (SVG, GIF, PDF, video, exe)', async () => {
    const { owner, order } = await inProgress('mim2');
    for (const m of ['image/svg+xml', 'image/gif', 'application/pdf', 'video/mp4', 'application/octet-stream']) {
      await expect(marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
        proof_attachments: [utAttachment({ mime_type: m })],
      })).rejects.toMatchObject({ status: 400 });
    }
    // Order status remains in_progress (never transitioned).
    const cur = await withDb((db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id })) as { status: string } | null;
    expect(cur?.status).toBe('in_progress');
  });

  it('#3 more than 5 attachments rejected', async () => {
    const { owner, order } = await inProgress('cap3');
    const six = Array.from({ length: 6 }).map(() => utAttachment());
    await expect(marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      proof_attachments: six,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('#4 size > 5 MB rejected server-side', async () => {
    const { owner, order } = await inProgress('sz4');
    await expect(marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      proof_attachments: [utAttachment({ size_bytes: 6 * 1024 * 1024 })],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('#5 notes-only submission is now REJECTED', async () => {
    const { owner, order } = await inProgress('n5');
    await expect(marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      notes_to_brand: 'I posted it, trust me!',
    })).rejects.toMatchObject({ status: 400 });
    // But notes + attachment succeeds.
    const done = await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      notes_to_brand: 'Posted at 3pm',
      proof_attachments: [utAttachment()],
    });
    expect(done.status).toBe('submitted_for_review');
  });

  it('#6 attachments preserved across revision cycle', async () => {
    const { owner, buyer, order } = await inProgress('h6');
    const attV0 = utAttachment({ file_name_safe: 'v0.png' });
    await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, { proof_attachments: [attV0] });
    await marketplaceService.buyerRequestRevision(actorFor(buyer.userId), order.id, { revision_notes: 'please redo' });
    const attV1 = utAttachment({ file_name_safe: 'v1.png' });
    await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, { proof_attachments: [attV1] });
    const subs = await marketplaceDeliverySubmissionRepo.listByOrder(order.id);
    expect(subs.length).toBe(2);
    expect(subs[0].proof_attachments[0].file_name_safe).toBe('v0.png');
    expect(subs[1].proof_attachments[0].file_name_safe).toBe('v1.png');
    // Order-level denorm shows the latest.
    const cur = await withDb((db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id })) as { proof_attachments: { file_name_safe: string }[] } | null;
    expect(cur?.proof_attachments[0].file_name_safe).toBe('v1.png');
  });

  it('#7 existing URL-based delivery still works (no attachments)', async () => {
    const { owner, order } = await inProgress('url7');
    const done = await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      delivery_urls: ['https://example.com/post/1'],
      notes_to_brand: 'ok',
    });
    expect(done.status).toBe('submitted_for_review');
    expect(done.delivery_urls).toEqual(['https://example.com/post/1']);
    expect(done.proof_attachments?.length ?? 0).toBe(0);
  });

  it('#8 unrelated owner cannot submit delivery evidence for another owner\'s order', async () => {
    const { order } = await inProgress('own8');
    const stranger = await signup(`ut-${RUN_TAG}-own8-x@t.test`);
    await expect(marketplaceService.submitDelivery(actorFor(stranger.userId), order.id, {
      proof_attachments: [utAttachment()],
    })).rejects.toMatchObject({ status: 403 });
  });

  it('#9 attachment URL from non-UploadThing host is rejected', async () => {
    const { owner, order } = await inProgress('host9');
    for (const u of [
      'https://example.com/f/abc',       // wrong host
      'https://evil.com/f/abc',
      'http://APPID.ufs.sh/f/abc',        // non-https
    ]) {
      await expect(marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
        proof_attachments: [utAttachment({ url: u })],
      })).rejects.toMatchObject({ status: 400 });
    }
    // Legacy utfs.io accepted for back-compat.
    const legacy = await marketplaceService.submitDelivery(actorFor(owner.userId), order.id, {
      proof_attachments: [utAttachment({ url: 'https://utfs.io/f/legacy-key-abc' })],
    });
    expect(legacy.status).toBe('submitted_for_review');
  });
});
