// M15 — Terminal legacy status safety patch.
//
// Historical CRM terminals (`won`, `lost`) and M15 owner terminals
// (`accepted_by_owner`, `declined_by_owner`) MUST remain terminal. The
// owner Accept/Decline action must not supersede them. This test file
// asserts:
//   1. legacy `won` — owner Accept is blocked (409); status remains `won`.
//   2. legacy `lost` — owner Decline is blocked (409); status remains `lost`.
//   3. legacy `qualified` — owner Accept still succeeds → `accepted_by_owner`.
//   4. new M15 direct flow (`new` → owner Accept → `accepted_by_owner`) still works.
//
// No production DB mutation of historical records. Test-scoped fixtures only.

import { describe, it, expect, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { sponsorshipLeadRepo } from '@/lib/repositories/sponsorshipLeadRepo';
import type { Actor, Channel, SponsorshipLead, SponsorshipLeadStatus } from '@/lib/types';

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function actorFor(userId: string): Actor {
  return {
    user: { id: userId, email: `${userId}@t.local`, display_name: 't', role: 'user', is_active: true } as unknown as Actor['user'],
    session: { user_id: userId, jti: 'test', role: 'user', iat: 0, exp: 0 } as unknown as Actor['session'],
    role: 'user',
  } as unknown as Actor;
}

async function seedUser(db: Db): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({
    id, email: `${id}@t.local`, display_name: 't', role: 'user', is_active: true,
    is_email_verified: true, password_hash: 'x',
    created_at: new Date(), updated_at: new Date(),
  } as never);
  return id;
}

async function seedChannel(db: Db, ownerId: string): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc: Channel = {
    id, slug: `m15term-${id.slice(0, 8)}`, name: `M15Term ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: null, short_description: 'test', logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', primary_language: 'en', category_id: null,
    owner_id: ownerId, status: 'approved',
    verification_status: 'verified',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 0, follower_count_source: 'submitter', follower_count_updated_at: null,
    created_at: now, updated_at: now, published_at: now,
    activation_status: 'not_required',
    activation_active_at: null, activation_revoked_at: null,
    is_test_fixture: true,
  } as Channel;
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc;
}

async function seedLead(channel: Channel, status: SponsorshipLeadStatus): Promise<SponsorshipLead> {
  const now = new Date();
  const lead: SponsorshipLead = {
    id: uuidv4(),
    channel_id: channel.id,
    channel_slug_snapshot: channel.slug,
    channel_name_snapshot: channel.name,
    requester_user_id: null,
    requester_role: null,
    company_name: 'TerminalCorp', contact_name: 'Terminal Contact',
    work_email: `term${Date.now()}${Math.random()}@t.local`.replace(/\./g, ''),
    objective: 'brand_awareness', budget_range: '1000_2500',
    target_country: null, desired_start_at: null,
    brief: 'A sponsorship request for terminal-status safety tests.',
    materials_url: null,
    status,
    admin_notes: null,
    owner_responded_at: null,
    created_at: now, updated_at: now,
  };
  await sponsorshipLeadRepo.insert(lead);
  return lead;
}

const trash = { users: [] as string[], channels: [] as string[], leads: [] as string[] };

afterAll(async () => {
  await withDb(async (db) => {
    if (trash.leads.length) await db.collection(COLLECTIONS.SPONSORSHIP_LEADS).deleteMany({ id: { $in: trash.leads } });
    if (trash.channels.length) await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: { $in: trash.channels } });
    if (trash.users.length) await db.collection(COLLECTIONS.USERS).deleteMany({ id: { $in: trash.users } });
  });
});

describe('M15 — terminal legacy status safety patch', () => {
  it('legacy WON: owner Accept is BLOCKED (409) and status remains "won"', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLead(ch, 'won');
    trash.leads.push(lead.id);
    await expect(sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept'))
      .rejects.toMatchObject({ status: 409 });
    const after = await sponsorshipLeadRepo.findById(lead.id);
    expect(after?.status).toBe('won');
    expect(after?.owner_responded_at).toBeNull();
  });

  it('legacy LOST: owner Decline is BLOCKED (409) and status remains "lost"', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLead(ch, 'lost');
    trash.leads.push(lead.id);
    await expect(sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'decline'))
      .rejects.toMatchObject({ status: 409 });
    const after = await sponsorshipLeadRepo.findById(lead.id);
    expect(after?.status).toBe('lost');
    expect(after?.owner_responded_at).toBeNull();
  });

  it('legacy QUALIFIED: owner Accept still SUCCEEDS → accepted_by_owner', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLead(ch, 'qualified');
    trash.leads.push(lead.id);
    const updated = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
    expect(updated.status).toBe('accepted_by_owner');
    expect(updated.owner_responded_at).toBeInstanceOf(Date);
  });

  it('new M15 direct flow: NEW → owner Accept → accepted_by_owner (unchanged behavior)', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLead(ch, 'new');
    trash.leads.push(lead.id);
    const updated = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
    expect(updated.status).toBe('accepted_by_owner');
  });
});
