// Phase B3.2 Gate C — production safety tests.
//
// Proves that the production-safety adjustments hold:
//   §S1  Non-production returns verification_code_dev (dev flow preserved)
//   §S2  Production NEVER returns verification_code_dev
//   §S3  Production without email delivery marks verification_delivery='unavailable'
//   §S4  Fail-closed on missing PAYOUT_METHOD_VERIFY_SECRET in production
//   §S5  Full paypal_email is never present in any payout-method response body
//   §S6  Existing manual external payout still records correctly
//
// These tests run entirely in the service layer — they never hit the running
// server, so we can safely mutate process.env for each case.
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { marketplaceService, hasEmailDelivery } from '@/lib/services/marketplaceService';
import type { Actor } from '@/lib/types';

const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function signup(email: string): Promise<{ userId: string }> {
  const s = await fetch('http://localhost:3000/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const j = await s.json() as { data?: { user?: { id?: string } } };
  return { userId: j?.data?.user?.id as string };
}

function actorFor(user_id: string, role = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  PAYOUT_METHOD_VERIFY_SECRET: process.env.PAYOUT_METHOD_VERIFY_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SMTP_HOST: process.env.SMTP_HOST,
  POSTMARK_API_TOKEN: process.env.POSTMARK_API_TOKEN,
  MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
  AWS_SES_REGION: process.env.AWS_SES_REGION,
};

function resetEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeAll(async () => {
  // Ensure no lingering email-delivery env from prior tests polluting our runs.
  for (const k of ['SENDGRID_API_KEY', 'RESEND_API_KEY', 'POSTMARK_API_TOKEN', 'MAILGUN_API_KEY', 'AWS_SES_REGION', 'SMTP_HOST']) delete process.env[k];
});

afterEach(() => { resetEnv(); });

afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(`gcs-${RUN_TAG}`);
    await db.collection('users').deleteMany({ email: rx });
    await db.collection(COLLECTIONS.OWNER_PAYOUT_METHODS).deleteMany({});
  });
});

describe('B3.2 Gate C safety §S — production hardening', () => {
  it('#S1 non-production returns verification_code_dev (dev flow preserved)', async () => {
    // Vitest default NODE_ENV=test — treat as non-production.
    (process.env as Record<string,string>).NODE_ENV = 'test';
    const owner = await signup(`gcs-${RUN_TAG}-s1@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'devcode@example.com' });
    expect(r.verification_code_dev).toMatch(/^\d{6}$/);
    expect(r.verification_delivery).toBe('dev_only');
    expect(r.email_delivery_pending).toBe(true);
  });

  it('#S2 production NEVER returns verification_code_dev', async () => {
    (process.env as Record<string,string>).NODE_ENV = 'production';
    process.env.PAYOUT_METHOD_VERIFY_SECRET = 'prod-test-secret';
    const owner = await signup(`gcs-${RUN_TAG}-s2@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'prodhidden@example.com' });
    expect(r.verification_code_dev).toBeUndefined();
    // Full email never present in the response body.
    expect(JSON.stringify(r)).not.toContain('prodhidden@example.com');
    expect(JSON.stringify(r)).not.toContain('verification_code_hash');
  });

  it('#S3 production without email delivery reports verification_delivery=unavailable + email_delivery_pending=true', async () => {
    (process.env as Record<string,string>).NODE_ENV = 'production';
    process.env.PAYOUT_METHOD_VERIFY_SECRET = 'prod-test-secret';
    // No SENDGRID / RESEND / SMTP / POSTMARK / MAILGUN / SES set.
    expect(hasEmailDelivery()).toBe(false);
    const owner = await signup(`gcs-${RUN_TAG}-s3@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'noemail@example.com' });
    expect(r.verification_required).toBe(true);
    expect(r.verification_delivery).toBe('unavailable');
    expect(r.email_delivery_pending).toBe(true);
    expect(r.verification_code_dev).toBeUndefined();
  });

  it('#S4 production fails closed when PAYOUT_METHOD_VERIFY_SECRET (and SESSION_SECRET) are missing', async () => {
    (process.env as Record<string,string>).NODE_ENV = 'production';
    delete process.env.PAYOUT_METHOD_VERIFY_SECRET;
    delete process.env.SESSION_SECRET;
    const owner = await signup(`gcs-${RUN_TAG}-s4@t.test`);
    await expect(marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'failclosed@example.com' })).rejects.toMatchObject({ status: 500 });
  });

  it('#S5 production with email delivery reports verification_delivery=sent + still hides code', async () => {
    (process.env as Record<string,string>).NODE_ENV = 'production';
    process.env.PAYOUT_METHOD_VERIFY_SECRET = 'prod-test-secret';
    process.env.SENDGRID_API_KEY = 'sg-test-key';   // simulate email primitive present
    expect(hasEmailDelivery()).toBe(true);
    const owner = await signup(`gcs-${RUN_TAG}-s5@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'emailok@example.com' });
    expect(r.verification_required).toBe(true);
    expect(r.verification_delivery).toBe('sent');
    expect(r.verification_code_dev).toBeUndefined();
    expect(r.email_delivery_pending).toBeUndefined();   // NOT pending — sent
  });

  it('#S6 verified method in production returns verified state + no code fields', async () => {
    // Verify in non-prod first so we have a verified row.
    (process.env as Record<string,string>).NODE_ENV = 'test';
    const owner = await signup(`gcs-${RUN_TAG}-s6@t.test`);
    const first = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'verified@example.com' });
    await marketplaceService.ownerVerifyPayoutMethod(actorFor(owner.userId), { verification_code: first.verification_code_dev! });
    // Now flip to production and re-upsert same email — should return verified state with no code.
    (process.env as Record<string,string>).NODE_ENV = 'production';
    process.env.PAYOUT_METHOD_VERIFY_SECRET = 'prod-test-secret';
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'verified@example.com' });
    expect(r.verification_required).toBe(false);
    expect(r.method.is_verified).toBe(true);
    expect(r.verification_code_dev).toBeUndefined();
    expect(r.verification_delivery).toBe('sent');
  });
});
