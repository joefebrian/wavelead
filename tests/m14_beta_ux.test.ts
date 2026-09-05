// M14 — WhatsApp refresh service + Contact service targeted tests.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { refreshChannelFromPublicMetadata } from '@/lib/services/whatsappRefreshService';
import * as ogFetcher from '@/lib/services/enrichment/ogFetcher';
import { contactService } from '@/lib/services/contactService';
import type { Channel } from '@/lib/types';

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

async function seedChannel(db: Db, overrides: Partial<Channel> = {}): Promise<Channel> {
  const id = uuidv4();
  const now = new Date();
  const doc: Channel = {
    id,
    slug: `m14-${id.slice(0, 8)}`,
    name: `M14 ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    description: 'stored bio',
    short_description: 'stored short',
    logo_url: 'https://static.whatsapp.net/rsrc.php/v4/yO/r/existingLogo.png',
    cover_url: null, website_url: null,
    country_code: 'US', primary_language: 'en',
    category_id: null,
    owner_id: null,
    status: 'approved',
    verification_status: 'unclaimed',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active',
    follower_count: 12345,
    follower_count_source: 'admin_verified',
    follower_count_updated_at: now,
    created_at: now, updated_at: now, published_at: now,
    public_followers_count: 100,
    public_followers_source: 'whatsapp_public_metadata',
    public_followers_observed_at: now,
    is_test_fixture: true,
    ...overrides,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Document);
  return doc;
}

describe('M14 — WhatsApp refresh service', () => {
  const seededIds: string[] = [];
  afterAll(async () => {
    await withDb(async (db) => {
      if (seededIds.length) await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: { $in: seededIds } });
      // Clean stray test contact submissions
      await db.collection(COLLECTIONS.CONTACT_SUBMISSIONS).deleteMany({ email: /@m14test\.local$/ });
    });
    vi.restoreAllMocks();
  });

  it('successful refresh updates logo, bio and public follower count', async () => {
    const spy = vi.spyOn(ogFetcher, 'fetchPublicChannelMetadata').mockResolvedValueOnce({
      title: 'Test Channel',
      description: 'Channel &#x2022; 103K followers &#x2022; Sajiansedap.grid.id hadir dengan ribuan resep',
      image_url: 'https://static.whatsapp.net/rsrc.php/v4/yO/r/newLogo.png',
      canonical_url: null,
    });
    const seeded = await withDb(async (db) => {
      const c = await seedChannel(db, { logo_url: 'https://old-cdn/old.png', description: 'stored bio', public_followers_count: 100 });
      seededIds.push(c.id);
      return c;
    });
    const r = await refreshChannelFromPublicMetadata({
      id: seeded.id, whatsapp_url: seeded.whatsapp_url,
      logo_url: seeded.logo_url, description: seeded.description, short_description: seeded.short_description,
      public_followers_count: seeded.public_followers_count ?? null,
    });
    expect(r.ok).toBe(true);
    expect(r.updated_fields).toContain('logo_url');
    expect(r.updated_fields).toContain('description');
    expect(r.updated_fields).toContain('public_followers_count');
    const doc = await withDb(async (db) => db.collection<Channel>(COLLECTIONS.CHANNELS).findOne({ id: seeded.id }));
    expect(doc?.logo_url).toBe('https://static.whatsapp.net/rsrc.php/v4/yO/r/newLogo.png');
    expect(doc?.description).toBe('Sajiansedap.grid.id hadir dengan ribuan resep');
    expect(doc?.public_followers_count).toBe(103000);
    expect(doc?.public_followers_source).toBe('whatsapp_public_metadata');
    expect(doc?.follower_count).toBe(12345); // verified follower count NOT touched
    expect(doc?.follower_count_source).toBe('admin_verified');
    spy.mockRestore();
  });

  it('fetch failure preserves existing logo, bio and follower count', async () => {
    const spy = vi.spyOn(ogFetcher, 'fetchPublicChannelMetadata').mockResolvedValueOnce(null);
    const seeded = await withDb(async (db) => {
      const c = await seedChannel(db, { logo_url: 'https://keep-me/logo.png', description: 'existing bio preserved', public_followers_count: 555 });
      seededIds.push(c.id);
      return c;
    });
    const r = await refreshChannelFromPublicMetadata({
      id: seeded.id, whatsapp_url: seeded.whatsapp_url,
      logo_url: seeded.logo_url, description: seeded.description, short_description: seeded.short_description,
      public_followers_count: seeded.public_followers_count ?? null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('fetch_failed');
    expect(r.updated_fields).toEqual([]);
    const doc = await withDb(async (db) => db.collection<Channel>(COLLECTIONS.CHANNELS).findOne({ id: seeded.id }));
    expect(doc?.logo_url).toBe('https://keep-me/logo.png');
    expect(doc?.description).toBe('existing bio preserved');
    expect(doc?.public_followers_count).toBe(555);
    spy.mockRestore();
  });

  it('refresh never overwrites owner-verified follower_count', async () => {
    const spy = vi.spyOn(ogFetcher, 'fetchPublicChannelMetadata').mockResolvedValueOnce({
      title: null,
      description: 'Channel • 999K followers • Some bio',
      image_url: null,
      canonical_url: null,
    });
    const seeded = await withDb(async (db) => {
      const c = await seedChannel(db, {
        follower_count: 987654,
        follower_count_source: 'admin_verified',
      });
      seededIds.push(c.id);
      return c;
    });
    await refreshChannelFromPublicMetadata({
      id: seeded.id, whatsapp_url: seeded.whatsapp_url,
      logo_url: seeded.logo_url, description: seeded.description, short_description: seeded.short_description,
      public_followers_count: seeded.public_followers_count ?? null,
    });
    const doc = await withDb(async (db) => db.collection<Channel>(COLLECTIONS.CHANNELS).findOne({ id: seeded.id }));
    expect(doc?.follower_count).toBe(987654);
    expect(doc?.follower_count_source).toBe('admin_verified');
    expect(doc?.public_followers_count).toBe(999000);
    expect(doc?.public_followers_source).toBe('whatsapp_public_metadata');
    spy.mockRestore();
  });

  it('refresh creates NO channel_audience_snapshot (verified evidence remains separate)', async () => {
    const spy = vi.spyOn(ogFetcher, 'fetchPublicChannelMetadata').mockResolvedValueOnce({
      title: null,
      description: 'Channel • 1.2K followers • Small',
      image_url: null,
      canonical_url: null,
    });
    const seeded = await withDb(async (db) => {
      const c = await seedChannel(db);
      seededIds.push(c.id);
      return c;
    });
    await refreshChannelFromPublicMetadata({
      id: seeded.id, whatsapp_url: seeded.whatsapp_url,
      logo_url: seeded.logo_url, description: seeded.description, short_description: seeded.short_description,
      public_followers_count: seeded.public_followers_count ?? null,
    });
    const snaps = await withDb(async (db) => db.collection(COLLECTIONS.CHANNEL_AUDIENCE_SNAPSHOTS)
      .find({ channel_id: seeded.id }).toArray());
    expect(snaps.length).toBe(0);
    spy.mockRestore();
  });
});

describe('M14 — Contact service', () => {
  it('validates input and rejects invalid payloads', async () => {
    await expect(contactService.submit({ name: 'a', email: 'nope', topic: 'general', message: 'short' }, { ip: null, userAgent: null }))
      .rejects.toThrow();
  });

  it('persists a valid submission and reports a delivery status', async () => {
    const uniqueEmail = `u${Date.now()}@m14test.local`;
    const out = await contactService.submit(
      { name: 'Ada Lovelace', email: uniqueEmail, topic: 'general', message: 'Hello WaveLead team, this is a targeted test message.' },
      { ip: '10.0.0.1', userAgent: 'vitest' },
    );
    expect(out.ok).toBe(true);
    expect(out.submission_id).toBeTruthy();
    // Delivery status is one of the documented values.
    expect(['sent', 'persisted_only', 'send_failed']).toContain(out.delivery_status);
    const doc = await withDb(async (db) => db.collection(COLLECTIONS.CONTACT_SUBMISSIONS).findOne({ id: out.submission_id }));
    expect(doc).toBeTruthy();
    expect((doc as { email: string } | null)?.email).toBe(uniqueEmail);
    expect((doc as { destination: string } | null)?.destination).toBe('hello@p2plabs.asia');
  });

  it('reports real email delivery availability based on SMTP_HOST', () => {
    const prev = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    expect(contactService.hasRealEmailDelivery()).toBe(false);
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(contactService.hasRealEmailDelivery()).toBe(true);
    if (prev === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = prev;
  });
});
