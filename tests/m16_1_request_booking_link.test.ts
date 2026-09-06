// M16.1 — Accepted sponsorship request → EXISTING marketplace booking/payment
// loop wiring (targeted only).
//
// Proven:
//   1  accepted request exposes "Continue to Booking" to the requesting brand
//   2  unrelated user cannot continue the booking
//   3  booking goes through the EXISTING marketplaceService.submitBooking
//   4  owner acceptance alone creates NO booking and NO payment object
//   5  explicit brand continuation creates the canonical booking
//   6  lead ↔ booking association persists and resolves
//   7  repeated continuation resumes (no duplicate active booking)
//   8  paid booking resolves as an Active Sponsorship for the brand
//   9  Payment Protection / acceptance lifecycle unchanged
//  10  owner 90% / WaveLead 10% unchanged
//  11  M16 conversation thread still available on the request
//  12  no off-platform payment path introduced
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel, SponsorshipLead } from '@/lib/types';

vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: async () => ({ messageId: 'test' }) }),
}));

import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { sponsorshipMessageService } from '@/lib/services/sponsorshipMessageService';
import { marketplaceService } from '@/lib/services/marketplaceService';
import { marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';

const RUN = `m161-${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const REPO = path.resolve(__dirname, '..');
const readSrc = (p: string) => readFileSync(path.join(REPO, p), 'utf8');

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function actorFor(userId: string, role: 'user' | 'admin' = 'user'): Actor {
  return {
    user: { id: userId, email: `${userId}@t.local`, display_name: 'Tester', role, is_active: true },
    session: { user_id: userId, jti: 'test', role, iat: 0, exp: 0 },
    role,
  } as unknown as Actor;
}

async function seedUser(db: Db, role: 'user' | 'admin' = 'user'): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: `${RUN} user`, role,
    is_active: true, is_email_verified: true, password_hash: 'x',
    created_at: new Date(), updated_at: new Date(),
  } as never);
  return id;
}

async function seedChannel(db: Db, ownerId: string): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc = {
    id, slug: `${RUN}-${id.slice(0, 8)}`, name: `Ch ${RUN} ${id.slice(0, 4)}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: null, short_description: 'test', logo_url: null, cover_url: null, website_url: null,
    country_code: 'BR', primary_language: 'pt', category_id: null,
    owner_id: ownerId, status: 'approved', verification_status: 'verified', is_verified: true,
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 5000, follower_count_source: 'submitter',
    created_at: now, updated_at: now, published_at: now, is_test_fixture: true,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}

async function seedLead(db: Db, channel: Channel, requesterId: string, status: SponsorshipLead['status'] = 'new'): Promise<SponsorshipLead> {
  const now = new Date();
  const lead: SponsorshipLead = {
    id: uuidv4(),
    channel_id: channel.id,
    channel_slug_snapshot: channel.slug,
    channel_name_snapshot: channel.name,
    requester_user_id: requesterId,
    requester_role: 'user',
    company_name: `Brand ${RUN}`,
    contact_name: 'Brand Contact',
    work_email: `${RUN}-brand@t.local`,
    objective: 'product_launch',
    budget_range: '1000_2500',
    target_country: 'BR',
    desired_start_at: null,
    brief: 'Launch campaign brief carried over from the request.',
    materials_url: 'https://drive.google.com/drive/folders/xyz',
    status,
    admin_notes: null,
    owner_responded_at: null,
    created_at: now,
    updated_at: now,
  };
  await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).insertOne(lead as never);
  return lead;
}

async function ratePackageId(ownerId: string, channelId: string): Promise<string> {
  const card = await marketplaceService.replaceRateCard(actorFor(ownerId), channelId, {
    packages: [{
      type: 'sponsored_post', name: 'Single sponsored post', description: 'One post',
      price_minor: 25000, currency: 'USD', deliverables: ['1 post'], is_active: true,
    }],
  });
  return card.packages[0].id;
}

const bookingBody = (channelId: string, packageId: string, leadId?: string) => ({
  channel_id: channelId,
  package_id: packageId,
  company_name: `Brand ${RUN}`,
  contact_name: 'Brand Contact',
  contact_email: `${RUN}-brand@t.local`,
  campaign_objective: 'Product launch',
  brief: 'Launch campaign brief carried over from the request.',
  ...(leadId ? { source_sponsorship_lead_id: leadId } : {}),
});

beforeAll(() => {
  process.env.SMTP_HOST = 'smtp.test.local';
});

afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(RUN);
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
    await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).deleteMany({ work_email: rx });
    await db.collection(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES).deleteMany({ message: rx });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ channel_slug: rx });
    await db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).deleteMany({ channel_id: { $exists: true }, is_test_fixture: true });
  });
});

describe('M16.1 request → booking wiring', () => {
  it('1 & 4. owner acceptance creates NO booking and NO payment object; brand then sees Continue to Booking', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);

      const accepted = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
      expect(accepted.status).toBe('accepted_by_owner');

      // No marketplace order, no payment attempt, no funding order.
      expect(await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ channel_id: channel.id })).toBe(0);
      expect(await db.collection(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS).countDocuments({ source_sponsorship_lead_id: lead.id })).toBe(0);
      expect(await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ source_sponsorship_lead_id: lead.id })).toBe(0);

      // Brand-side resolution: accepted + no booking yet → Continue to Booking.
      const link = await sponsorshipLeadService.getBookingLink(actorFor(brandId), lead.id);
      expect(link.viewer).toBe('requester');
      expect(link.lead.status).toBe('accepted_by_owner');
      expect(link.order).toBeNull();
    });

    const detail = readSrc('app/dashboard/sponsorship-requests/[id]/page.tsx');
    expect(detail).toContain('Continue to Booking');
    expect(detail).toContain('continue-to-booking-cta');
    expect(detail).toContain('/sponsor/${lead.channel_slug_snapshot}?lead=');
  });

  it('2. unrelated user cannot continue the booking', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const strangerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId, 'accepted_by_owner');
      const pkgId = await ratePackageId(ownerId, channel.id);

      await expect(sponsorshipLeadService.getForBookingContinuation(actorFor(strangerId), lead.id, channel.id))
        .rejects.toMatchObject({ status: 403 });
      await expect(marketplaceService.submitBooking(actorFor(strangerId), bookingBody(channel.id, pkgId, lead.id)))
        .rejects.toMatchObject({ status: 403 });
      // Owner cannot self-book off the brand's request either.
      await expect(sponsorshipLeadService.getForBookingContinuation(actorFor(ownerId), lead.id, channel.id))
        .rejects.toMatchObject({ status: 403 });
      // Not-yet-accepted request cannot be continued.
      const pending = await seedLead(db, channel, brandId, 'new');
      await expect(sponsorshipLeadService.getForBookingContinuation(actorFor(brandId), pending.id, channel.id))
        .rejects.toMatchObject({ status: 409 });
      await expect(marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, pending.id)))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  it('3, 5, 6 & 7. explicit continuation creates ONE canonical booking, association persists, repeats resume', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId, 'accepted_by_owner');
      const pkgId = await ratePackageId(ownerId, channel.id);

      // 3 + 5 — existing marketplace service / existing order model.
      const order = await marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, lead.id));
      expect(order.status).toBe('requested');
      expect(order.economics_status).toBe('pre_acceptance');
      expect(order.owner_user_id).toBe(ownerId);
      expect(order.buyer_user_id).toBe(brandId);
      expect(order.quoted_price_minor).toBe(25000);           // server-derived from package
      expect(order.source_sponsorship_lead_id).toBe(lead.id);

      // 6 — association persists and resolves both ways.
      const persisted = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id });
      expect((persisted as unknown as { source_sponsorship_lead_id: string }).source_sponsorship_lead_id).toBe(lead.id);
      const resolved = await marketplaceOrderRepo.findActiveBySourceLead(lead.id);
      expect(resolved?.id).toBe(order.id);
      const link = await sponsorshipLeadService.getBookingLink(actorFor(brandId), lead.id);
      expect(link.order?.id).toBe(order.id);
      // Lead itself is NOT duplicated into another lead system.
      expect(await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).countDocuments({ channel_id: channel.id })).toBe(1);

      // 7 — repeated continuation resumes the same booking.
      const again = await marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, lead.id));
      const third = await marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, lead.id));
      expect(again.id).toBe(order.id);
      expect(third.id).toBe(order.id);
      expect(await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ source_sponsorship_lead_id: lead.id })).toBe(1);
    });
  });

  it('8, 9 & 10. owner accept of the booking keeps Payment Protection + 90/10, then resolves as Active Sponsorship', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId, 'accepted_by_owner');
      const pkgId = await ratePackageId(ownerId, channel.id);
      const order = await marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, lead.id));

      // 9 — the EXISTING marketplace acceptance lifecycle is untouched.
      const acceptedOrder = await marketplaceService.ownerAcceptOrder(actorFor(ownerId), order.id);
      expect(['owner_accepted', 'awaiting_payment']).toContain(acceptedOrder.status);
      // 10 — commission split unchanged.
      expect(acceptedOrder.snapshot?.owner_share_bps).toBe(9000);
      expect(acceptedOrder.snapshot?.platform_share_bps).toBe(1000);
      expect(acceptedOrder.snapshot?.gross_price_minor).toBe(25000);
      // Association survives the marketplace lifecycle.
      expect(acceptedOrder.source_sponsorship_lead_id).toBe(lead.id);

      // 8 — a paid booking resolves as the brand's Active Sponsorship.
      await marketplaceOrderRepo.update(order.id, { status: 'paid' });
      const link = await sponsorshipLeadService.getBookingLink(actorFor(brandId), lead.id);
      expect(link.order?.status).toBe('paid');
      const buyerOrders = await marketplaceOrderRepo.listByBuyer(brandId);
      expect(buyerOrders.map((o) => o.id)).toContain(order.id);
      // Owner side sees it in the existing Active Sponsorships surface.
      const ownerOrders = await marketplaceOrderRepo.listByOwner(ownerId);
      expect(ownerOrders.map((o) => o.id)).toContain(order.id);
    });

    const detail = readSrc('app/dashboard/sponsorship-requests/[id]/page.tsx');
    expect(detail).toContain('View Active Sponsorship');
    expect(detail).toContain('Continue Payment');
    expect(detail).toContain('View Sponsorship');
  });

  it('11. M16 conversation remains available after a booking exists', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId, 'accepted_by_owner');
      const pkgId = await ratePackageId(ownerId, channel.id);
      const order = await marketplaceService.submitBooking(actorFor(brandId), bookingBody(channel.id, pkgId, lead.id));

      await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `post-booking question ${RUN}` });
      const read = await sponsorshipMessageService.list(actorFor(ownerId), lead.id);
      expect(read.messages.length).toBe(1);

      // Messages never mutate marketplace/commercial state.
      const after = await marketplaceOrderRepo.findById(order.id);
      expect(after?.status).toBe('requested');
      expect(after?.quoted_price_minor).toBe(25000);
      expect(after?.owner_earnings_minor ?? null).toBe(null);
      expect(after?.wavelead_commission_minor ?? null).toBe(null);
    });
  });

  it('12. no off-platform payment path; booking flow reuses existing marketplace surfaces only', () => {
    const detail = readSrc('app/dashboard/sponsorship-requests/[id]/page.tsx');
    const sponsorPage = readSrc('app/sponsor/[slug]/page.tsx');
    const bookingForm = readSrc('app/sponsor/[slug]/MarketplaceBookingForm.tsx');
    // CTAs point only at WaveLead marketplace surfaces.
    expect(detail).toContain('/dashboard/sponsorships');
    for (const src of [detail, sponsorPage, bookingForm]) {
      expect(src.toLowerCase()).not.toContain('paypal.me');
      expect(src.toLowerCase()).not.toContain('bank transfer');
      expect(src.toLowerCase()).not.toContain('pay the owner directly');
      expect(src.toLowerCase()).not.toContain('escrow');
    }
    // Booking still POSTs to the existing marketplace endpoint — no new payment domain.
    expect(bookingForm).toContain("'/api/marketplace/orders'");
    expect(bookingForm).toContain('source_sponsorship_lead_id');
    // Package selection step preserved — no inferred price.
    expect(sponsorPage).toContain('continue-booking-package-chooser');
    expect(sponsorPage).not.toContain('budget_range');
  });
});
