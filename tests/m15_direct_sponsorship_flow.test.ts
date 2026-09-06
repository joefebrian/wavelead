// M15 — Direct brand ↔ channel-owner sponsorship flow + auth return-to.
//
// Targeted:
//   • sanitizeReturnTo — same-origin only, open-redirect protection
//   • sponsorshipLeadService.getForViewer — owner + requester + admin allowed;
//     everyone else 403
//   • sponsorshipLeadService.respondAsOwner — only target channel owner may
//     accept/decline; sets accepted_by_owner / declined_by_owner without
//     touching admin gates
//   • sponsorshipLeadService.listForOwnedChannels — returns leads addressed
//     to channels the user owns
//   • sponsorshipLeadService.create — accepts materials_url (google drive
//     https); persists it; status starts as 'new' (no admin gate).
//   • validation — rejects non-Google/non-https materials_url; rejects
//     JavaScript-flavored URLs and other hosts.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { sanitizeReturnTo } from '@/lib/utils/returnTo';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { sponsorshipLeadRepo } from '@/lib/repositories/sponsorshipLeadRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import * as channelServiceMod from '@/lib/services/channelService';
import type { Actor, Channel, SponsorshipLead } from '@/lib/types';

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

async function seedUser(db: Db, role: 'user' | 'admin' = 'user'): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${id}@t.local`, display_name: 't', role, is_active: true,
    is_email_verified: true, password_hash: 'x',
    created_at: new Date(), updated_at: new Date(),
  } as unknown as Document);
  return id;
}

async function seedChannel(db: Db, ownerId: string | null = null): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc: Channel = {
    id, slug: `m15-${id.slice(0, 8)}`, name: `M15 ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: null, short_description: 'test', logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', primary_language: 'en', category_id: null,
    owner_id: ownerId, status: 'approved',
    verification_status: ownerId ? 'verified' : 'unclaimed',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    activation_status: ownerId ? 'not_required' : 'not_required',
    activation_active_at: null, activation_revoked_at: null,
    is_test_fixture: true,
  } as Channel;
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Document);
  return doc;
}

describe('M15 — sanitizeReturnTo (open-redirect protection)', () => {
  it('accepts absolute-path same-origin', () => {
    expect(sanitizeReturnTo('/pricing')).toBe('/pricing');
    expect(sanitizeReturnTo('/pricing?intent=founding-lifetime#founding-lifetime')).toBe('/pricing?intent=founding-lifetime#founding-lifetime');
    expect(sanitizeReturnTo('/dashboard/sponsorship-requests/abc')).toBe('/dashboard/sponsorship-requests/abc');
  });

  it('rejects external and protocol-relative URLs', () => {
    expect(sanitizeReturnTo('//evil.example/steal')).toBe('/dashboard');
    expect(sanitizeReturnTo('https://evil.example/steal')).toBe('/dashboard');
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/dashboard');
    expect(sanitizeReturnTo('data:text/html,x')).toBe('/dashboard');
  });

  it('rejects empty/null', () => {
    expect(sanitizeReturnTo(null)).toBe('/dashboard');
    expect(sanitizeReturnTo('')).toBe('/dashboard');
    expect(sanitizeReturnTo('   ')).toBe('/dashboard');
  });
});

describe('M15 — sponsorship request authorization + owner response', () => {
  const seededChannels: string[] = [];
  const seededUsers: string[] = [];
  const seededLeads: string[] = [];

  afterAll(async () => {
    await withDb(async (db) => {
      if (seededLeads.length) await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).deleteMany({ id: { $in: seededLeads } });
      if (seededChannels.length) await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: { $in: seededChannels } });
      if (seededUsers.length) await db.collection(COLLECTIONS.USERS).deleteMany({ id: { $in: seededUsers } });
    });
    vi.restoreAllMocks();
  });

  async function createLead(channel: Channel, requesterId: string | null, opts: Partial<SponsorshipLead> = {}): Promise<SponsorshipLead> {
    const now = new Date();
    const lead: SponsorshipLead = {
      id: uuidv4(),
      channel_id: channel.id,
      channel_slug_snapshot: channel.slug,
      channel_name_snapshot: channel.name,
      requester_user_id: requesterId,
      requester_role: requesterId ? 'user' : null,
      company_name: 'Test Corp', contact_name: 'Test Contact', work_email: `req${Date.now()}@t.local`,
      objective: 'brand_awareness', budget_range: '1000_2500',
      target_country: null, desired_start_at: null,
      brief: 'A perfectly reasonable sponsorship request.',
      materials_url: null,
      status: 'new', admin_notes: null, owner_responded_at: null,
      created_at: now, updated_at: now, ...opts,
    };
    await sponsorshipLeadRepo.insert(lead);
    seededLeads.push(lead.id);
    return lead;
  }

  it('target channel owner can open a sponsorship request', async () => {
    const { ownerId, otherId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const otherId = await seedUser(db); seededUsers.push(otherId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { ownerId, otherId, ch };
    });
    const lead = await createLead(ch, otherId);
    const { lead: got, viewer } = await sponsorshipLeadService.getForViewer(actorFor(ownerId), lead.id);
    expect(got.id).toBe(lead.id);
    expect(viewer).toBe('owner');
  });

  it('requesting brand can open their own sponsorship request', async () => {
    const { requesterId, ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const requesterId = await seedUser(db); seededUsers.push(requesterId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { requesterId, ownerId, ch };
    });
    const lead = await createLead(ch, requesterId);
    const { viewer } = await sponsorshipLeadService.getForViewer(actorFor(requesterId), lead.id);
    expect(viewer).toBe('requester');
  });

  it('admin can open any sponsorship request', async () => {
    const { adminId, ch } = await withDb(async (db) => {
      const adminId = await seedUser(db, 'admin'); seededUsers.push(adminId);
      const ch = await seedChannel(db, null); seededChannels.push(ch.id);
      return { adminId, ch };
    });
    const lead = await createLead(ch, null);
    const { viewer } = await sponsorshipLeadService.getForViewer(actorFor(adminId, 'admin'), lead.id);
    expect(viewer).toBe('admin');
  });

  it('unrelated user is blocked (403)', async () => {
    const { strangerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const strangerId = await seedUser(db); seededUsers.push(strangerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { strangerId, ch };
    });
    const lead = await createLead(ch, null);
    await expect(sponsorshipLeadService.getForViewer(actorFor(strangerId), lead.id))
      .rejects.toMatchObject({ status: 403 });
  });

  it('owner accepts the request → status accepted_by_owner, owner_responded_at stamped', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await createLead(ch, null);
    const updated = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
    expect(updated.status).toBe('accepted_by_owner');
    expect(updated.owner_responded_at).toBeInstanceOf(Date);
  });

  it('owner declines the request → status declined_by_owner', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await createLead(ch, null);
    const updated = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'decline');
    expect(updated.status).toBe('declined_by_owner');
  });

  it('non-owner cannot respond (403)', async () => {
    const { strangerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const strangerId = await seedUser(db); seededUsers.push(strangerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { strangerId, ch };
    });
    const lead = await createLead(ch, null);
    await expect(sponsorshipLeadService.respondAsOwner(actorFor(strangerId), lead.id, 'accept'))
      .rejects.toMatchObject({ status: 403 });
  });

  it('listForOwnedChannels returns leads across all owned channels', async () => {
    const seeded = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const ch1 = await seedChannel(db, ownerId); seededChannels.push(ch1.id);
      const ch2 = await seedChannel(db, ownerId); seededChannels.push(ch2.id);
      // A channel someone else owns — must be excluded.
      const otherOwnerId = await seedUser(db); seededUsers.push(otherOwnerId);
      const chOther = await seedChannel(db, otherOwnerId); seededChannels.push(chOther.id);
      return { ownerId, ch1, ch2, chOther };
    });
    await createLead(seeded.ch1, null);
    await createLead(seeded.ch2, null);
    await createLead(seeded.chOther, null);
    const list = await sponsorshipLeadService.listForOwnedChannels(actorFor(seeded.ownerId));
    const ids = new Set(list.map((l) => l.channel_id));
    expect(ids.has(seeded.ch1.id)).toBe(true);
    expect(ids.has(seeded.ch2.id)).toBe(true);
    expect(ids.has(seeded.chOther.id)).toBe(false);
  });

  it('newly created request has status=new (no admin approval required)', async () => {
    const { ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { ch };
    });
    // Bypass the channel-visibility check for this unit test by stubbing.
    vi.spyOn(channelServiceMod.channelService, 'getPublicBySlug').mockResolvedValueOnce({ id: ch.id, slug: ch.slug, name: ch.name } as unknown as ReturnType<typeof channelServiceMod.channelService.getPublicBySlug> extends Promise<infer T> ? T : never);
    const created = await sponsorshipLeadService.create(null, {
      channel_slug: ch.slug, company_name: 'Acme', contact_name: 'A B',
      work_email: `n${Date.now()}@m14test.local`,
      objective: 'brand_awareness', budget_range: '1000_2500',
      brief: 'This is a brand new request from a brand.',
      materials_url: 'https://drive.google.com/drive/folders/abc',
    });
    seededLeads.push(created.id);
    expect(created.status).toBe('new');
    expect(created.materials_url).toBe('https://drive.google.com/drive/folders/abc');
    vi.restoreAllMocks();
  });

  it('validation rejects non-Google/non-https materials_url', async () => {
    const { ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); seededUsers.push(ownerId);
      const ch = await seedChannel(db, ownerId); seededChannels.push(ch.id);
      return { ch };
    });
    vi.spyOn(channelServiceMod.channelService, 'getPublicBySlug').mockResolvedValue({ id: ch.id, slug: ch.slug, name: ch.name } as unknown as ReturnType<typeof channelServiceMod.channelService.getPublicBySlug> extends Promise<infer T> ? T : never);
    const bad = ['http://drive.google.com/x', 'https://dropbox.com/x', 'https://evil.com/', 'javascript:alert(1)', 'ftp://drive.google.com/x'];
    for (const url of bad) {
      await expect(sponsorshipLeadService.create(null, {
        channel_slug: ch.slug, company_name: 'Acme', contact_name: 'A B',
        work_email: `bad${Date.now()}${Math.random()}@m14test.local`,
        objective: 'brand_awareness', budget_range: '1000_2500',
        brief: 'This is a brand new request from a brand.',
        materials_url: url,
      })).rejects.toMatchObject({ status: 400 });
    }
    vi.restoreAllMocks();
  });
});
