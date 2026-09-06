// M16 — Sponsorship communication + UX consistency (targeted only).
//
// Scope proven:
//   NAMING        owner "Incoming Requests" / brand "Sent Requests" /
//                 transaction "Active Sponsorships"
//   VISIBILITY    an M15 lead is visible under the channel's Incoming
//                 Requests (before any payment/booking exists); marketplace
//                 bookings stay in Active Sponsorships; no duplication
//   CONVERSATION  brand + owner can read/write; unrelated → 403;
//                 admin read-only oversight preserved
//   EMAIL         new request / new message / accept notifications; SMTP
//                 failure never fails the underlying commercial action
//   DELIVERY      UploadThing uploader removed from the delivery flow;
//                 https published-content URL + Google Drive evidence URL
//                 accepted; zero file bytes stored by WaveLead
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel, SponsorshipLead } from '@/lib/types';

// ---------------------------------------------------------------------------
// SMTP transport is mocked at the nodemailer boundary. No real mail is sent.
// ---------------------------------------------------------------------------
interface SentMail { to: string; subject: string; text: string }
const outbox: SentMail[] = [];
let failSend = false;

vi.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: async (m: SentMail) => {
      if (failSend) throw Object.assign(new Error('ECONNREFUSED smtp'), { code: 'ECONNREFUSED' });
      outbox.push(m);
      return { messageId: 'test' };
    },
  }),
}));

import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { sponsorshipMessageService } from '@/lib/services/sponsorshipMessageService';
import { sponsorshipNotificationService } from '@/lib/services/sponsorshipNotificationService';
import { marketplaceService } from '@/lib/services/marketplaceService';

const RUN = `m16-${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const REPO = path.resolve(__dirname, '..');
const readSrc = (p: string) => readFileSync(path.join(REPO, p), 'utf8');

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function actorFor(userId: string, role: 'user' | 'admin' = 'user', displayName = 'Tester'): Actor {
  return {
    user: { id: userId, email: `${userId}@t.local`, display_name: displayName, role, is_active: true },
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

async function seedChannel(db: Db, ownerId: string, name = 'ESPN Brasil'): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc = {
    id, slug: `${RUN}-${id.slice(0, 8)}`, name: `${name} ${RUN}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: null, short_description: 'test', logo_url: null, cover_url: null, website_url: null,
    country_code: 'BR', primary_language: 'pt', category_id: null,
    owner_id: ownerId, status: 'approved', verification_status: 'verified',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 1000, follower_count_source: 'submitter',
    created_at: now, updated_at: now, published_at: now,
    is_test_fixture: true,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}

async function seedLead(db: Db, channel: Channel, requesterId: string | null, status: SponsorshipLead['status'] = 'new'): Promise<SponsorshipLead> {
  const now = new Date();
  const lead: SponsorshipLead = {
    id: uuidv4(),
    channel_id: channel.id,
    channel_slug_snapshot: channel.slug,
    channel_name_snapshot: channel.name,
    requester_user_id: requesterId,
    requester_role: requesterId ? 'user' : null,
    company_name: `Brand ${RUN}`,
    contact_name: 'Brand Contact',
    work_email: `${RUN}-brand@t.local`,
    objective: 'brand_awareness',
    budget_range: '1000_2500',
    target_country: 'BR',
    desired_start_at: null,
    brief: 'We would like to sponsor one post about the tournament.',
    materials_url: null,
    status,
    admin_notes: null,
    owner_responded_at: null,
    created_at: now,
    updated_at: now,
  };
  await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).insertOne(lead as never);
  return lead;
}

async function seedInProgressOrder(db: Db, channel: Channel, ownerId: string, buyerId: string): Promise<string> {
  const id = uuidv4();
  const now = new Date();
  await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
    id,
    channel_id: channel.id,
    channel_slug: channel.slug,
    owner_user_id: ownerId,
    buyer_user_id: buyerId,
    package_id: uuidv4(),
    package_type: 'sponsored_post',
    status: 'in_progress',
    brief: { company_name: `Brand ${RUN}`, contact_name: 'B', contact_email: `${RUN}-b@t.local`, campaign_objective: 'o', brief: 'b' },
    snapshot: { channel_name: channel.name, gross_price_minor: 25000, currency: 'USD' },
    quoted_price_minor: 25000,
    gateway_fee_minor: 750,
    net_transaction_value_minor: 24250,
    owner_earnings_minor: 21825,
    wavelead_commission_minor: 2425,
    economics_status: 'finalized',
    owner_payable_status: 'in_progress',
    payment_reconciliation_required: false,
    delivery_notes: null, delivery_urls: [], proof_urls: [], proof_attachments: [],
    created_at: now, updated_at: now,
    is_test_fixture: true,
  } as never);
  return id;
}

beforeAll(() => {
  process.env.SMTP_HOST = 'smtp.test.local';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_FROM = 'no-reply@wavelead.test';
});

beforeEach(() => { outbox.length = 0; failSend = false; });

afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(RUN);
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
    await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).deleteMany({ work_email: rx });
    await db.collection(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES).deleteMany({ message: rx });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ channel_slug: rx });
  });
});

// ===========================================================================
// 1–3 NAMING
// ===========================================================================
describe('M16 §1 naming consistency', () => {
  it('1. owner surfaces use "Incoming Requests"', () => {
    const dash = readSrc('app/dashboard/page.tsx');
    const ownerList = readSrc('app/dashboard/sponsorship-requests/page.tsx');
    const monetization = readSrc('app/dashboard/channels/[id]/monetization/MonetizationClient.tsx');
    expect(dash).toContain('Incoming Requests');
    expect(ownerList).toContain('>Incoming Requests<');
    expect(monetization).toContain('Incoming Requests (');
    // No ambiguous legacy owner labels left on these surfaces.
    expect(ownerList).not.toContain('>Sponsorship Requests<');
  });

  it('2. brand surfaces use "Sent Requests"', () => {
    const dash = readSrc('app/dashboard/page.tsx');
    const sent = readSrc('app/dashboard/sent-requests/page.tsx');
    expect(dash).toContain('Sent Requests');
    expect(dash).toContain('/dashboard/sent-requests');
    expect(sent).toContain('>Sent Requests<');
    expect(dash).not.toContain('My sponsorship requests');
  });

  it('3. confirmed booking surfaces use "Active Sponsorships"', () => {
    const dash = readSrc('app/dashboard/page.tsx');
    const bookings = readSrc('app/dashboard/sponsorships/page.tsx');
    const monetization = readSrc('app/dashboard/channels/[id]/monetization/MonetizationClient.tsx');
    expect(dash).toContain('Active Sponsorships');
    expect(bookings).toContain('>Active Sponsorships<');
    expect(monetization).toContain('Active Sponsorships (');
    expect(dash).not.toContain('My Sponsorships');
    expect(bookings).not.toContain('>My Sponsorships<');
  });
});

// ===========================================================================
// 4–6 CHANNEL REQUEST VISIBILITY
// ===========================================================================
describe('M16 §2 channel Incoming Requests vs Active Sponsorships', () => {
  it('4. ESPN-style M15 lead appears in the channel Incoming Requests with no booking', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId, 'ESPN Brasil');
      const lead = await seedLead(db, channel, await seedUser(db));
      const incoming = await sponsorshipLeadService.listForChannel(actorFor(ownerId), channel.id);
      expect(incoming.map((l) => l.id)).toContain(lead.id);
      expect(incoming.find((l) => l.id === lead.id)?.status).toBe('new');
      // Zero marketplace bookings exist for this channel.
      const bookings = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ channel_id: channel.id });
      expect(bookings).toBe(0);
    });
  });

  it('5. an existing paid/in-progress booking is a separate Active Sponsorships record', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const buyerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId, 'Tiara Andini');
      const orderId = await seedInProgressOrder(db, channel, ownerId, buyerId);
      const incoming = await sponsorshipLeadService.listForChannel(actorFor(ownerId), channel.id);
      expect(incoming.length).toBe(0);                       // bookings never leak into leads
      expect(incoming.map((l) => l.id)).not.toContain(orderId);
      const bookings = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ channel_id: channel.id });
      expect(bookings).toBe(1);
    });
  });

  it('6. no duplicate records: leads and bookings coexist without merging', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const buyerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, buyerId);
      await seedInProgressOrder(db, channel, ownerId, buyerId);
      const incoming = await sponsorshipLeadService.listForChannel(actorFor(ownerId), channel.id);
      expect(incoming.length).toBe(1);
      expect(incoming[0].id).toBe(lead.id);
      expect(new Set(incoming.map((l) => l.id)).size).toBe(incoming.length);
    });
  });

  it('6b. a non-owner cannot read a channel\'s incoming requests', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const strangerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      await expect(sponsorshipLeadService.listForChannel(actorFor(strangerId), channel.id)).rejects.toMatchObject({ status: 403 });
    });
  });
});

// ===========================================================================
// 7–10 CONVERSATION THREAD
// ===========================================================================
describe('M16 §3 conversation thread', () => {
  it('7. brand (requester) can send and read messages', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      const { message } = await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `brand hello ${RUN}` });
      expect(message.sender_side).toBe('brand');
      const read = await sponsorshipMessageService.list(actorFor(brandId), lead.id);
      expect(read.viewer).toBe('requester');
      expect(read.messages.map((m) => m.id)).toContain(message.id);
      // Plain text only — no attachment field on the model.
      expect(Object.keys(message)).not.toContain('attachments');
    });
  });

  it('8. target channel owner can send and read messages', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `brand q ${RUN}` });
      const { message } = await sponsorshipMessageService.create(actorFor(ownerId, 'user', 'Owner Name'), lead.id, { message: `owner answer ${RUN}` });
      expect(message.sender_side).toBe('owner');
      const read = await sponsorshipMessageService.list(actorFor(ownerId), lead.id);
      expect(read.viewer).toBe('owner');
      expect(read.messages.length).toBe(2);
      // Chronological append-only ordering.
      expect(read.messages[0].sender_side).toBe('brand');
      expect(read.messages[1].sender_side).toBe('owner');
      // Never leaks an email address as the display label.
      expect(read.messages.every((m) => !m.sender_display_name.includes('@'))).toBe(true);
    });
  });

  it('9. unrelated user is blocked (403) on read and write', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const strangerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      await expect(sponsorshipMessageService.list(actorFor(strangerId), lead.id)).rejects.toMatchObject({ status: 403 });
      await expect(sponsorshipMessageService.create(actorFor(strangerId), lead.id, { message: `hack ${RUN}` })).rejects.toMatchObject({ status: 403 });
    });
  });

  it('10. admin read oversight preserved (read allowed, participation not required)', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const adminId = await seedUser(db, 'admin');
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `for support ${RUN}` });
      const read = await sponsorshipMessageService.list(actorFor(adminId, 'admin'), lead.id);
      expect(read.viewer).toBe('admin');
      expect(read.messages.length).toBe(1);
      await expect(sponsorshipMessageService.create(actorFor(adminId, 'admin'), lead.id, { message: `admin note ${RUN}` }))
        .rejects.toMatchObject({ status: 403 });
    });
  });
});

// ===========================================================================
// 11–14 EMAIL NOTIFICATIONS
// ===========================================================================
describe('M16 §4 email notifications', () => {
  it('11. new sponsorship request notifies the channel owner account email', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, await seedUser(db));
      const res = await sponsorshipNotificationService.notifyOwnerNewRequest(lead);
      expect(res.status).toBe('sent');
      expect(outbox.length).toBe(1);
      const owner = await db.collection(COLLECTIONS.USERS).findOne({ id: ownerId });
      expect(outbox[0].to).toBe(owner!.email);
      expect(outbox[0].subject).toBe(`New sponsorship request for ${channel.name}`);
      expect(outbox[0].text).toContain(lead.company_name);
      expect(outbox[0].text).toContain(`/dashboard/sponsorship-requests/${lead.id}`);
    });
    // Wiring: the public request endpoint fires the owner notification.
    expect(readSrc('app/api/[[...path]]/route.ts')).toContain('notifyOwnerNewRequest');
  });

  it('12. new conversation message notifies the OTHER participant', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      const owner = await db.collection(COLLECTIONS.USERS).findOne({ id: ownerId });
      const brand = await db.collection(COLLECTIONS.USERS).findOne({ id: brandId });

      await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `hi owner ${RUN}` });
      expect(outbox.length).toBe(1);
      expect(outbox[0].to).toBe(owner!.email);          // brand → owner
      expect(outbox[0].subject).toContain('New message about');

      outbox.length = 0;
      await sponsorshipMessageService.create(actorFor(ownerId), lead.id, { message: `hi brand ${RUN}` });
      expect(outbox.length).toBe(1);
      expect(outbox[0].to).toBe(brand!.email);          // owner → brand
      expect(outbox[0].text).toContain('Payment Protection');
    });
  });

  it('13. owner Accept notifies the brand; Decline sends the update email', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      const brand = await db.collection(COLLECTIONS.USERS).findOne({ id: brandId });

      const accepted = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
      expect(accepted.status).toBe('accepted_by_owner');
      expect(outbox.length).toBe(1);
      expect(outbox[0].to).toBe(brand!.email);
      expect(outbox[0].subject).toBe('Your sponsorship request was accepted');

      outbox.length = 0;
      const lead2 = await seedLead(db, channel, brandId);
      await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead2.id, 'decline');
      expect(outbox.length).toBe(1);
      expect(outbox[0].subject).toBe('Update on your sponsorship request');
    });
  });

  it('14. email failure never rolls back the commercial action', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const brandId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const lead = await seedLead(db, channel, brandId);
      failSend = true;

      // Accept still commits.
      const accepted = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
      expect(accepted.status).toBe('accepted_by_owner');
      expect(outbox.length).toBe(0);

      // Message still persists.
      const { message } = await sponsorshipMessageService.create(actorFor(brandId), lead.id, { message: `still saved ${RUN}` });
      const persisted = await db.collection(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES).findOne({ id: message.id });
      expect(persisted).toBeTruthy();
      expect(outbox.length).toBe(0);
    });
  });

  it('14b. SMTP not configured is reported, never thrown', async () => {
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      await withDb(async (db) => {
        const ownerId = await seedUser(db);
        const brandId = await seedUser(db);
        const channel = await seedChannel(db, ownerId);
        const lead = await seedLead(db, channel, brandId);
        const r = await sponsorshipNotificationService.notifyOwnerNewRequest(lead);
        expect(r.status).toBe('smtp_not_configured');
        // Commercial action unaffected.
        const accepted = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
        expect(accepted.status).toBe('accepted_by_owner');
      });
    } finally { process.env.SMTP_HOST = saved; }
  });
});

// ===========================================================================
// 15–18 DELIVERY EVIDENCE (no file hosting)
// ===========================================================================
describe('M16 §5 delivery evidence is URL-based', () => {
  it('15. broken UploadThing uploader is removed from the delivery flow', () => {
    const client = readSrc('app/dashboard/channels/[id]/monetization/MonetizationClient.tsx');
    expect(client).not.toContain('DeliveryScreenshotUpload');
    expect(client).not.toContain('uploadthing');
    expect(client).not.toContain('Upload Screenshot');
    expect(client).not.toContain('proof_attachments');
    // Replacement fields are present.
    expect(client).toContain('Published Content URL(s)');
    expect(client).toContain('Evidence / Supporting Materials Link');
    expect(client).toContain('drive.google.com');
  });

  it('16 & 17. https published-content URL and Google Drive evidence URL accepted', async () => {
    await withDb(async (db) => {
      const ownerId = await seedUser(db);
      const buyerId = await seedUser(db);
      const channel = await seedChannel(db, ownerId);
      const orderId = await seedInProgressOrder(db, channel, ownerId, buyerId);
      const published = 'https://whatsapp.com/channel/0029VaTestPublished';
      const drive = 'https://drive.google.com/drive/folders/abc123XYZ';
      const updated = await marketplaceService.submitDelivery(actorFor(ownerId), orderId, {
        notes_to_brand: 'Published yesterday at 10:00.',
        delivery_urls: [published],
        proof_urls: [drive],
      });
      expect(updated.status).toBe('submitted_for_review');
      expect(updated.delivery_urls).toContain(published);
      expect(updated.proof_urls).toContain(drive);
      // 18. No file bytes / attachment records created by this flow.
      expect(updated.proof_attachments || []).toHaveLength(0);
      const submission = await db.collection(COLLECTIONS.MARKETPLACE_DELIVERY_SUBMISSIONS).findOne({ marketplace_order_id: orderId });
      expect(submission).toBeTruthy();
      expect((submission as unknown as { proof_attachments: unknown[] }).proof_attachments).toHaveLength(0);
    });
  });

  it('18. payment protection copy avoids escrow claims and keeps 90/10', () => {
    const detail = readSrc('app/dashboard/sponsorship-requests/[id]/page.tsx');
    const respond = readSrc('app/dashboard/sponsorship-requests/[id]/RespondButtons.tsx');
    const sponsorForm = readSrc('app/sponsor/[slug]/SponsorForm.tsx');
    for (const src of [detail, respond, sponsorForm]) {
      expect(src.toLowerCase()).not.toContain('escrow');
      expect(src).toContain('Payment Protection');
    }
    expect(detail).toContain('90%');
    expect(respond).toContain('90%');
  });
});
