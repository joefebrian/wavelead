// PREVIEW-ONLY QA persona bootstrap.
//
// Provisions three deterministic personas so a human reviewer can log into
// the preview and manually exercise M06.0 flows:
//   1. QA super_admin  (email: QA_ADMIN_EMAIL)
//   2. QA channel_owner + one approved+verified QA channel (email: QA_OWNER_EMAIL)
//   3. QA business     (email: QA_BUSINESS_EMAIL)
//
// Safety invariants:
//   * Bootstrap is DISABLED when NODE_ENV === 'production'.
//   * Bootstrap is DISABLED unless QA_SEED_ENABLED === 'true'.
//   * Passwords are NEVER hardcoded — they are read from environment
//     variables (Emergent Secrets in preview). If a password env var is
//     missing, that persona is skipped (never provisioned with a blank
//     password). No default password is embedded anywhere.
//   * Passwords are never returned by the endpoint or logged.
//   * Server-side MongoDB role remains authoritative. There is NO client
//     role switcher. There is NO route that returns a password.
//   * Idempotent: reruns update role + password_hash + channel state to the
//     canonical QA values but never create duplicates.

import { v4 as uuidv4 } from 'uuid';
import { userRepo } from '@/lib/repositories/userRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { hashPassword } from '@/lib/auth/password';
import { slugify } from '@/lib/utils/slug';
import type { Channel, Role, User } from '@/lib/types';

export interface QaPersonaSummary {
  email: string;
  role: Role;
  provisioned: 'created' | 'updated' | 'skipped_no_password';
  extras?: Record<string, string>;
}

export interface QaBootstrapResult {
  enabled: boolean;
  reason?: string;
  personas: QaPersonaSummary[];
  channel?: { id: string; slug: string; name: string; owner_email: string } | null;
}

export interface QaBootstrapGate {
  enabled: boolean;
  reason?: string;
}

/** Environment-driven safety gate. Both must be true. */
export function isQaBootstrapEnabled(): QaBootstrapGate {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return { enabled: false, reason: 'production_disabled' };
  }
  if ((process.env.QA_SEED_ENABLED || '').toLowerCase() !== 'true') {
    return { enabled: false, reason: 'qa_seed_env_flag_off' };
  }
  return { enabled: true };
}

const DEFAULT_EMAILS = {
  admin: 'qa-admin@wavelead.dev',
  owner: 'qa-owner@wavelead.dev',
  business: 'qa-business@wavelead.dev',
} as const;

function envEmail(key: string, fallback: string): string {
  return (process.env[key] || fallback).toLowerCase().trim();
}

async function upsertPersona(email: string, role: Role, display_name: string, password: string | undefined): Promise<QaPersonaSummary> {
  const users = await getCollection<User>(COLLECTIONS.USERS);
  const existing = await userRepo.findByEmail(email);
  if (!password || password.length < 8) {
    return { email, role, provisioned: 'skipped_no_password' };
  }
  const password_hash = await hashPassword(password);
  const now = new Date();
  if (existing) {
    // Idempotent update: force role + password + display_name back to the QA canonical values.
    await users.updateOne(
      { id: existing.id },
      {
        $set: {
          role,
          password_hash,
          display_name,
          updated_at: now,
        },
      },
    );
    return { email, role, provisioned: 'updated' };
  }
  const user: User = {
    id: uuidv4(),
    email,
    display_name,
    avatar_url: null,
    role,
    country_code: 'US',
    preferred_language: 'en',
    password_hash,
    auth_providers: ['password'],
    created_at: now,
    updated_at: now,
  };
  await userRepo.insert(user);
  return { email, role, provisioned: 'created' };
}

async function upsertQaChannelForOwner(owner: User): Promise<{ id: string; slug: string; name: string; owner_email: string }> {
  const now = new Date();
  const slug = 'qa-verified-channel';
  const name = 'QA Verified Channel';
  const existing = await channelRepo.findBySlug(slug);
  if (existing) {
    // Force back to canonical approved+verified state and reassign ownership.
    await channelRepo.update(existing.id, {
      owner_id: owner.id,
      status: 'approved',
      verification_status: 'verified',
      is_demo: false,
      published_at: existing.published_at || now,
    });
    return { id: existing.id, slug, name: existing.name, owner_email: owner.email };
  }
  const doc: Channel = {
    id: uuidv4(),
    slug,
    name,
    whatsapp_url: `https://whatsapp.com/channel/${slug}`,
    whatsapp_channel_id: null,
    description: 'Preview-only QA channel used for M06.0 manual login flows. Not production.',
    short_description: 'Preview-only QA channel for manual login flows.',
    logo_url: null,
    cover_url: null,
    website_url: null,
    country_code: 'US',
    primary_language: 'en',
    category_id: null,
    owner_id: owner.id,
    status: 'approved',
    verification_status: 'verified',
    is_official: false,
    is_featured: false,
    is_nsfw: false,
    is_demo: false,
    activity_level: 'active',
    follower_count: 1234,
    follower_count_source: 'qa_seed',
    follower_count_updated_at: now,
    created_at: now,
    updated_at: now,
    published_at: now,
  };
  await channelRepo.insert(doc);
  return { id: doc.id, slug: doc.slug, name: doc.name, owner_email: owner.email };
}

export async function runQaPersonaSeed(): Promise<QaBootstrapResult> {
  const gate = isQaBootstrapEnabled();
  if (!gate.enabled) {
    return { enabled: false, reason: gate.reason, personas: [], channel: null };
  }

  const adminEmail = envEmail('QA_ADMIN_EMAIL', DEFAULT_EMAILS.admin);
  const ownerEmail = envEmail('QA_OWNER_EMAIL', DEFAULT_EMAILS.owner);
  const businessEmail = envEmail('QA_BUSINESS_EMAIL', DEFAULT_EMAILS.business);

  const results: QaPersonaSummary[] = [];
  results.push(await upsertPersona(adminEmail, 'super_admin', 'QA Super Admin', process.env.QA_ADMIN_PASSWORD));
  results.push(await upsertPersona(ownerEmail, 'channel_owner', 'QA Channel Owner', process.env.QA_OWNER_PASSWORD));
  results.push(await upsertPersona(businessEmail, 'business', 'QA Business User', process.env.QA_BUSINESS_PASSWORD));

  let channel: QaBootstrapResult['channel'] = null;
  const ownerResult = results[1];
  if (ownerResult.provisioned !== 'skipped_no_password') {
    const owner = await userRepo.findByEmail(ownerEmail);
    if (owner) {
      channel = await upsertQaChannelForOwner(owner);
      ownerResult.extras = { channel_slug: channel.slug, channel_id: channel.id };
    }
  }

  return { enabled: true, personas: results, channel };
}

// Slug utility guard: unused import — silences tree-shakers if slug logic
// is later extended. Reference used to keep imports stable across refactors.
void slugify;
