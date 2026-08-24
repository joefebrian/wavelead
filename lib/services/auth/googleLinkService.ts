// Google-identity → WaveLead-user linkage. Fail-closed on ambiguous state.
//
// SECURITY INVARIANTS (never violate these):
//   * JWT wl_session carries only { userId, email, v } — no role, no google claims.
//   * Existing user linkage does NOT touch role, is_disabled, session_version,
//     must_change_password, or password_hash. Only auth_providers[+google] and
//     google_sub are updated.
//   * hello@p2plabs.asia super_admin invariant — if a state ever exists where
//     email matches but role !== 'super_admin', we throw before minting a token.
//   * Disabled accounts are refused pre-issuance.
//   * 0 matches → create new `user`-role account. >=2 matches → fail closed (403).
//   * Google-only new users get must_change_password=false (they have no password).
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../../db/mongo';
import { COLLECTIONS } from '../../db/collections';
import { signSessionToken } from '../../auth/session';
import type { User } from '@/lib/types';
import type { EmergentIdentity } from './emergentGoogleAdapter';

const SUPER_ADMIN_EMAIL = 'hello@p2plabs.asia';

export class GoogleLinkError extends Error {
  constructor(public code: string, public httpStatus: number, public detail?: string) { super(code); }
}

export interface GoogleLinkResult {
  token: string;
  user_id: string;
  role: string;
  linked: 'created' | 'linked_existing' | 'existing_already_linked';
}

/**
 * Given a verified Emergent identity (email is Google-verified by construction of
 * the managed flow), find-or-create the WaveLead user and issue a wl_session JWT.
 */
export async function linkAndIssueSession(identity: EmergentIdentity): Promise<GoogleLinkResult> {
  const email = identity.email.trim().toLowerCase();
  if (!email) throw new GoogleLinkError('empty_email', 400);

  const users = await getCollection<User>(COLLECTIONS.USERS);

  // Defensive: limit(2) so a corrupt DB state with duplicate emails is caught.
  const matches = await users.find({ email }).limit(2).toArray();

  if (matches.length >= 2) {
    // Should be impossible due to uniq_email index, but never trust the DB blindly.
    throw new GoogleLinkError('account_not_resolvable', 403);
  }

  const now = new Date();

  if (matches.length === 0) {
    // ---- Brand-new user via Google (role: user, no password) ----
    const doc: User = {
      id: uuidv4(),
      email,
      display_name: identity.name || email.split('@')[0],
      avatar_url: identity.picture || null,
      role: 'user',
      country_code: null,
      preferred_language: 'en',
      // No password_hash — Google-only account.
      auth_providers: ['google'],
      google_sub: identity.google_sub || undefined,
      is_disabled: false,
      must_change_password: false,
      session_version: 0,
      created_at: now,
      updated_at: now,
    } as User;
    await users.insertOne(doc);
    const token = signSessionToken({ userId: doc.id, email, v: 0 });
    return { token, user_id: doc.id, role: doc.role, linked: 'created' };
  }

  // ---- Existing user — LINK only, never modify privilege fields ----
  const existing = matches[0];

  if (existing.is_disabled === true) {
    throw new GoogleLinkError('account_disabled', 403);
  }

  // Explicit super_admin invariant.
  if (email === SUPER_ADMIN_EMAIL && existing.role !== 'super_admin') {
    throw new GoogleLinkError('authorization_invariant_broken', 500);
  }

  const alreadyLinked = Array.isArray(existing.auth_providers) && existing.auth_providers.includes('google');
  const set: Record<string, unknown> = { updated_at: now };
  if (identity.google_sub && (existing as User & { google_sub?: string }).google_sub !== identity.google_sub) {
    set.google_sub = identity.google_sub;
  }
  await users.updateOne(
    { id: existing.id },
    {
      $set: set,
      $addToSet: { auth_providers: 'google' },
    },
  );

  const token = signSessionToken({
    userId: existing.id,
    email: existing.email,
    v: existing.session_version ?? 0,
  });
  return {
    token,
    user_id: existing.id,
    role: existing.role,
    linked: alreadyLinked ? 'existing_already_linked' : 'linked_existing',
  };
}
