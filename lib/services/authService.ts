// Business logic for authentication.
//   - No first-user super_admin promotion.
//   - Bootstrap super_admin ONLY when signup email matches SUPER_ADMIN_EMAIL
//     AND BOOTSTRAP_ENABLED=true AND no super_admin yet.
//   - JWT never carries the role. Downstream authorization must call
//     resolveActor() to read the current role from MongoDB.
import { v4 as uuidv4 } from 'uuid';
import { userRepo } from '../repositories/userRepo';
import { hashPassword, verifyPassword } from '../auth/password';
import { signSessionToken } from '../auth/session';
import { HttpError } from '../auth/rbac';
import { signupSchema, loginSchema, type SignupInput, type LoginInput } from '../validation/schemas';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { resolvePostLoginRedirect } from '../auth/postLoginRedirect';
import type { PublicUser, Role, User, SessionPayload } from '@/lib/types';

function toPublic(u: User | null): PublicUser | null {
  if (!u) return null;
  const { password_hash: _drop, _id: _drop2, ...rest } = u as User & { _id?: unknown };
  void _drop; void _drop2;
  return rest;
}

async function resolveBootstrapRole(email: string): Promise<Role> {
  const bootstrapEmail = (process.env.SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  const enabled = (process.env.BOOTSTRAP_ENABLED || '').toLowerCase() === 'true';
  if (!enabled || !bootstrapEmail || email.toLowerCase() !== bootstrapEmail) return 'user';
  // Only claim bootstrap role if no super_admin exists yet.
  const users = await getCollection<User>(COLLECTIONS.USERS);
  const existing = await users.findOne({ role: 'super_admin' });
  return existing ? 'user' : 'super_admin';
}

export interface AuthResult { user: PublicUser; token: string; redirect_to: string; }

export const authService = {
  async signup(input: unknown, next?: unknown): Promise<AuthResult> {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data: SignupInput = parsed.data;
    if (await userRepo.findByEmail(data.email)) throw new HttpError(409, 'Email already registered');

    const role = await resolveBootstrapRole(data.email);
    const now = new Date();
    const user: User = {
      id: uuidv4(),
      email: data.email.toLowerCase(),
      display_name: data.display_name,
      avatar_url: null,
      role,
      country_code: data.country_code ?? null,
      preferred_language: data.preferred_language || 'en',
      password_hash: await hashPassword(data.password),
      auth_providers: ['password'],
      created_at: now,
      updated_at: now,
    };
    await userRepo.insert(user);
    const token = signSessionToken({ userId: user.id, email: user.email, v: 0 });
    const publicUser = toPublic(user)!;
    return { user: publicUser, token, redirect_to: resolvePostLoginRedirect({ user: publicUser, next }) };
  },

  async login(input: unknown, next?: unknown): Promise<AuthResult> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Invalid login data');
    const data: LoginInput = parsed.data;
    const user = await userRepo.findByEmail(data.email);
    if (!user) throw new HttpError(401, 'Invalid credentials');
    if (user.is_disabled) throw new HttpError(403, 'Account disabled. Contact support.');
    const ok = await verifyPassword(data.password, user.password_hash || '');
    if (!ok) throw new HttpError(401, 'Invalid credentials');
    const token = signSessionToken({ userId: user.id, email: user.email, v: user.session_version ?? 0 });
    const publicUser = toPublic(user)!;
    return { user: publicUser, token, redirect_to: resolvePostLoginRedirect({ user: publicUser, next }) };
  },

  // Returns the CURRENT database view of the signed-in user — role included.
  async me(session: SessionPayload | null): Promise<PublicUser | null> {
    if (!session?.userId) return null;
    return toPublic(await userRepo.findById(session.userId));
  },
};
