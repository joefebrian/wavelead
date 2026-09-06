// M15 — Legacy sponsorship record backward-compatibility.
//
// Production already contains sponsorship_leads created under the pre-M15
// admin-moderated workflow. Those records carry legacy CRM status values
// (`contacted`, `qualified`, `won`, `lost`) that never transited through the
// new `accepted_by_owner` / `declined_by_owner` terminals.
//
// This test file exercises the exact case the operator specified:
//   - a legacy request already-progressed by Super Admin (status='qualified')
//   - must appear on the target owner's dashboard listing
//   - must open on the detail endpoint for that owner
//   - must reject unrelated users
//   - must remain actionable if it is not already at a new terminal
//     (accepted_by_owner / declined_by_owner)
//
// This is a read/behavior-only test. No production code is modified. No
// destructive DB migration is required.

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
  } as never);
  return id;
}

async function seedChannel(db: Db, ownerId: string): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc: Channel = {
    id, slug: `m15legacy-${id.slice(0, 8)}`, name: `M15Legacy ${id.slice(0, 6)}`,
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

async function seedLegacyLead(channel: Channel, status: SponsorshipLeadStatus, adminNotes: string | null = null): Promise<SponsorshipLead> {
  const now = new Date();
  const lead: SponsorshipLead = {
    id: uuidv4(),
    channel_id: channel.id,
    channel_slug_snapshot: channel.slug,
    channel_name_snapshot: channel.name,
    requester_user_id: null,
    requester_role: null,
    company_name: 'LegacyCorp', contact_name: 'Legacy Contact',
    work_email: `legacy${Date.now()}${Math.random()}@t.local`.replace(/\./g, ''),
    objective: 'brand_awareness', budget_range: '1000_2500',
    target_country: null, desired_start_at: null,
    brief: 'A legacy sponsorship request that predates the M15 direct workflow.',
    materials_url: null,
    status,
    admin_notes: adminNotes,
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

describe('M15 legacy compat — pre-M15 admin-progressed sponsorship_leads', () => {
  it('legacy qualified (admin-progressed) request is VISIBLE to the target owner', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLegacyLead(ch, 'qualified', 'Admin-progressed via old workflow');
    trash.leads.push(lead.id);
    const list = await sponsorshipLeadService.listForOwnedChannels(actorFor(ownerId));
    const found = list.find((l) => l.id === lead.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('qualified'); // legacy status preserved as-is
  });

  it('legacy qualified request detail OPENS for the target owner', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLegacyLead(ch, 'qualified');
    trash.leads.push(lead.id);
    const { lead: got, viewer } = await sponsorshipLeadService.getForViewer(actorFor(ownerId), lead.id);
    expect(got.id).toBe(lead.id);
    expect(got.status).toBe('qualified');
    expect(viewer).toBe('owner');
  });

  it('legacy request authorization — unrelated user is BLOCKED (403)', async () => {
    const { strangerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const strangerId = await seedUser(db); trash.users.push(strangerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { strangerId, ch };
    });
    const lead = await seedLegacyLead(ch, 'qualified');
    trash.leads.push(lead.id);
    await expect(sponsorshipLeadService.getForViewer(actorFor(strangerId), lead.id))
      .rejects.toMatchObject({ status: 403 });
  });

  it('legacy request remains actionable when not at a terminal — owner Accept succeeds', async () => {
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    const lead = await seedLegacyLead(ch, 'qualified');
    trash.leads.push(lead.id);
    const updated = await sponsorshipLeadService.respondAsOwner(actorFor(ownerId), lead.id, 'accept');
    expect(updated.status).toBe('accepted_by_owner');
    expect(updated.owner_responded_at).toBeInstanceOf(Date);
  });

  it('legacy CRM status VALUES round-trip through repo without parser rejection', async () => {
    const legacyStatuses: SponsorshipLeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];
    const { ownerId, ch } = await withDb(async (db) => {
      const ownerId = await seedUser(db); trash.users.push(ownerId);
      const ch = await seedChannel(db, ownerId); trash.channels.push(ch.id);
      return { ownerId, ch };
    });
    for (const status of legacyStatuses) {
      const lead = await seedLegacyLead(ch, status);
      trash.leads.push(lead.id);
      const fetched = await sponsorshipLeadRepo.findById(lead.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.status).toBe(status);
      // Owner listing must not filter these legacy statuses out.
      const list = await sponsorshipLeadService.listForOwnedChannels(actorFor(ownerId));
      expect(list.some((l) => l.id === lead.id)).toBe(true);
    }
  });

  it('adminStatusCounts still enumerates ALL statuses (legacy + M15) without losing legacy buckets', async () => {
    const counts = await sponsorshipLeadRepo.statusCounts();
    expect(counts).toHaveProperty('new');
    expect(counts).toHaveProperty('contacted');
    expect(counts).toHaveProperty('qualified');
    expect(counts).toHaveProperty('won');
    expect(counts).toHaveProperty('lost');
    expect(counts).toHaveProperty('accepted_by_owner');
    expect(counts).toHaveProperty('declined_by_owner');
  });
});
