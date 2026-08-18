// Business logic for authentication. UI/API layer must call these functions
// rather than touching repositories directly.
import { v4 as uuidv4 } from 'uuid';
import { userRepo } from '../repositories/userRepo.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signSessionToken } from '../auth/session.js';
import { ROLES } from '../auth/rbac.js';
import { signupSchema, loginSchema } from '../validation/schemas.js';

function publicUser(u) {
  if (!u) return null;
  const { password_hash, _id, ...rest } = u;
  return rest;
}

export const authService = {
  async signup(input) {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) {
      const err = new Error('Invalid signup data');
      err.status = 400;
      err.publicMessage = parsed.error.issues.map(i => i.message).join('; ');
      throw err;
    }
    const { email, password, display_name, country_code, preferred_language } = parsed.data;
    const existing = await userRepo.findByEmail(email);
    if (existing) {
      const e = new Error('Email already registered');
      e.status = 409;
      throw e;
    }
    const password_hash = await hashPassword(password);
    const now = new Date();
    // First-ever user becomes super_admin so the system is bootstrappable.
    const userCount = await userRepo.count();
    const role = userCount === 0 ? ROLES.SUPER_ADMIN : ROLES.USER;
    const user = {
      id: uuidv4(),
      email: email.toLowerCase(),
      display_name,
      avatar_url: null,
      role,
      country_code: country_code || null,
      preferred_language: preferred_language || 'en',
      password_hash,
      auth_providers: ['password'], // future-proof for OAuth
      created_at: now,
      updated_at: now,
    };
    await userRepo.insert(user);
    const token = signSessionToken({ userId: user.id, role: user.role, email: user.email });
    return { user: publicUser(user), token };
  },

  async login(input) {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      const e = new Error('Invalid login data'); e.status = 400; throw e;
    }
    const user = await userRepo.findByEmail(parsed.data.email);
    if (!user) { const e = new Error('Invalid credentials'); e.status = 401; throw e; }
    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) { const e = new Error('Invalid credentials'); e.status = 401; throw e; }
    const token = signSessionToken({ userId: user.id, role: user.role, email: user.email });
    return { user: publicUser(user), token };
  },

  async me(session) {
    if (!session?.userId) return null;
    const u = await userRepo.findById(session.userId);
    return publicUser(u);
  },
};
