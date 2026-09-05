// M13.1 — Owner activation notification (dashboard banner + copy) contract.
//
// This test does NOT render the React component (no jsdom/testing-library
// available). It validates the service-level state contract that drives the
// banner via the existing `/api/owner/channels/:id/activation` route:
//
//   ownership_status='approved' + activation_status='pending'
//     → banner MUST show "Ownership Approved / $1 activation" copy + CTA.
//   ownership_status='pending'
//     → banner MUST NOT show the $1 CTA.
//   activation_status='active'
//     → no $1 CTA; existing Owner Verified state shown.
//   activation_status='not_required'
//     → NO $1 required-payment banner (grandfathered).
//
// Also asserts the payment-safety invariant: reading the state / notification
// must never create a PayPal order or issue WaveLead credit.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelActivationService } from '@/lib/services/channelActivationService';
import type { Actor, Channel } from '@/lib/types';

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function actorFor(userId: string, role: 'user' | 'admin' = 'user'): Actor {
  return {
    user: { id: userId, email: `${userId}@t.local`, display_name: 't', role, is_active: true } as unknown as Actor['user'],
    session: { user_id: userId, jti: 'test', role, iat: 0, exp: 0 } as unknown as Actor['session'],
    role,
  } as unknown as Actor;
}

async function seedOwner(db: Db): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${id}@t.local`, display_name: 'Test Owner', role: 'user',
    is_active: true, is_email_verified: true, password_hash: 'x',
    created_at: new Date(), updated_at: new Date(),
  } as unknown as Document);
  return id;
}

async function seedChannel(db: Db, opts: {
  ownerId: string;
  verification: 'unclaimed' | 'verified' | 'official';
  activation: 'not_required' | 'pending' | 'active' | 'revoked';
  status?: 'approved' | 'pending_review';
}): Promise<Channel> {
  const now = new Date();
  const id = uuidv4();
  const doc: Channel = {
    id,
    slug: `m131-${id.slice(0, 8)}`,
    name: `M13.1 ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: null,
    short_description: 'test channel',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', primary_language: 'en',
    category_id: null,
    owner_id: opts.ownerId,
    status: opts.status || 'approved',
    verification_status: opts.verification,
    is_official: opts.verification === 'official',
    is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active',
    follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    activation_status: opts.activation,
    activation_active_at: opts.activation === 'active' ? now : null,
    activation_revoked_at: opts.activation === 'revoked' ? now : null,
    is_test_fixture: true,
  } as Channel;
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Document);
  return doc;
}

describe('M13.1 — Owner activation notification (state contract)', () => {
  const seededChannelIds: string[] = [];
  const seededUserIds: string[] = [];
  let prevRequired: string | undefined;

  beforeAll(async () => {
    // The banner is only "required" while REQUIRED=true. Force ON for these
    // assertions; restore afterwards.
    prevRequired = process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = 'true';
  });

  afterAll(async () => {
    if (prevRequired === undefined) delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    else process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = prevRequired;

    await withDb(async (db) => {
      if (seededChannelIds.length) await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: { $in: seededChannelIds } });
      if (seededUserIds.length) await db.collection(COLLECTIONS.USERS).deleteMany({ id: { $in: seededUserIds } });
      // Sanity: no rogue activation-payment record produced by the state reader.
      const rogue = await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS)
        .find({ channel_id: { $in: seededChannelIds } }).toArray();
      if (rogue.length > 0) throw new Error(`state reader created ${rogue.length} activation payment(s)`);
    });
  });

  it('approved + pending → state drives the $1 activation banner', async () => {
    const ownerId = await withDb(async (db) => {
      const uid = await seedOwner(db); seededUserIds.push(uid);
      const ch = await seedChannel(db, { ownerId: uid, verification: 'verified', activation: 'pending' });
      seededChannelIds.push(ch.id);
      return { uid, chId: ch.id };
    });
    const state = await channelActivationService.getStateForOwner(actorFor(ownerId.uid), ownerId.chId);
    expect(state.ownership_status).toBe('approved');
    expect(state.activation_status).toBe('pending');
    expect(state.activation_required).toBe(true);
    expect(state.activation_amount_minor).toBe(100);
    expect(state.currency).toBe('USD');
    // These are the flags the banner uses to decide "show $1 CTA".
    const bannerShouldRender = state.ownership_status === 'approved'
      && state.activation_status !== 'active'
      && state.activation_status !== 'not_required';
    expect(bannerShouldRender).toBe(true);
  });

  it('pending ownership → banner MUST NOT render the $1 CTA', async () => {
    const ownerId = await withDb(async (db) => {
      const uid = await seedOwner(db); seededUserIds.push(uid);
      // pending_review + unclaimed = ownership pending, no verified state.
      const ch = await seedChannel(db, {
        ownerId: uid, verification: 'unclaimed', activation: 'not_required', status: 'pending_review',
      });
      seededChannelIds.push(ch.id);
      return { uid, chId: ch.id };
    });
    const state = await channelActivationService.getStateForOwner(actorFor(ownerId.uid), ownerId.chId);
    expect(state.ownership_status).toBe('pending');
    const bannerShouldRender = state.ownership_status === 'approved'
      && state.activation_status !== 'active'
      && state.activation_status !== 'not_required';
    expect(bannerShouldRender).toBe(false);
  });

  it('active → banner replaced by existing Owner Verified state', async () => {
    const ownerId = await withDb(async (db) => {
      const uid = await seedOwner(db); seededUserIds.push(uid);
      const ch = await seedChannel(db, { ownerId: uid, verification: 'verified', activation: 'active' });
      seededChannelIds.push(ch.id);
      return { uid, chId: ch.id };
    });
    const state = await channelActivationService.getStateForOwner(actorFor(ownerId.uid), ownerId.chId);
    expect(state.activation_status).toBe('active');
    const bannerShouldRender = state.ownership_status === 'approved'
      && state.activation_status !== 'active'
      && state.activation_status !== 'not_required';
    expect(bannerShouldRender).toBe(false);
  });

  it('not_required (grandfathered) → NO $1 required-payment banner', async () => {
    const ownerId = await withDb(async (db) => {
      const uid = await seedOwner(db); seededUserIds.push(uid);
      const ch = await seedChannel(db, { ownerId: uid, verification: 'verified', activation: 'not_required' });
      seededChannelIds.push(ch.id);
      return { uid, chId: ch.id };
    });
    const state = await channelActivationService.getStateForOwner(actorFor(ownerId.uid), ownerId.chId);
    expect(state.ownership_status).toBe('approved');
    expect(state.activation_status).toBe('not_required');
    const bannerShouldRender = state.ownership_status === 'approved'
      && state.activation_status !== 'active'
      && state.activation_status !== 'not_required';
    expect(bannerShouldRender).toBe(false);
  });

  it('reading the state creates NO PayPal order and NO WaveLead credit', async () => {
    const seeded = await withDb(async (db) => {
      const uid = await seedOwner(db); seededUserIds.push(uid);
      const ch = await seedChannel(db, { ownerId: uid, verification: 'verified', activation: 'pending' });
      seededChannelIds.push(ch.id);
      return { uid, chId: ch.id };
    });
    // Call the state endpoint many times — a notification-style read should
    // never move money or credit.
    for (let i = 0; i < 3; i++) await channelActivationService.getStateForOwner(actorFor(seeded.uid), seeded.chId);
    await withDb(async (db) => {
      const payments = await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS)
        .find({ channel_id: seeded.chId }).toArray();
      expect(payments.length).toBe(0);
      const credit = await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS)
        .find({ source_id: seeded.chId }).toArray();
      expect(credit.length).toBe(0);
    });
  });
});
