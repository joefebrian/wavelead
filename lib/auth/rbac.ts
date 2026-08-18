// Server-side authorization guards. NEVER trust the client.
// Privileged authorization always resolves the CURRENT role from MongoDB
// via resolveActor — the JWT never carries a role.
import { NextRequest } from 'next/server';
import { userRepo } from '@/lib/repositories/userRepo';
import { getSessionFromRequest, getSessionFromCookies } from './session';
import type { Actor, PublicUser, Role, SessionPayload } from '@/lib/types';

export const ROLES = {
  VISITOR: 'visitor',
  USER: 'user',
  CHANNEL_OWNER: 'channel_owner',
  BUSINESS: 'business',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const satisfies Record<string, Role>;

const RANK: Record<Role, number> = {
  visitor: 0,
  user: 10,
  channel_owner: 20,
  business: 30,
  moderator: 50,
  admin: 80,
  super_admin: 100,
};

export function rankOf(role: Role | undefined | null): number {
  return role ? RANK[role] ?? 0 : 0;
}

export class HttpError extends Error {
  status: number;
  publicMessage?: string;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

// Fetches the CURRENT user + role from MongoDB. Returns null if the JWT is
// invalid OR the user no longer exists.
async function actorFromSession(session: SessionPayload | null): Promise<Actor | null> {
  if (!session?.userId) return null;
  const user = (await userRepo.findById(session.userId)) as (PublicUser & { password_hash?: string }) | null;
  if (!user) return null;
  const { password_hash: _drop, ...publicUser } = user;
  void _drop;
  return { session, user: publicUser };
}

export async function resolveActor(request: NextRequest): Promise<Actor | null> {
  return actorFromSession(getSessionFromRequest(request));
}

export async function resolveActorFromCookies(): Promise<Actor | null> {
  return actorFromSession(await getSessionFromCookies());
}

export function hasAtLeastRole(user: PublicUser | null | undefined, minRole: Role): boolean {
  if (!user?.role) return false;
  return rankOf(user.role) >= rankOf(minRole);
}

export function requireAuth(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new HttpError(401, 'Unauthorized');
}

export function requireRole(actor: Actor | null, minRole: Role): asserts actor is Actor {
  if (!actor) throw new HttpError(401, 'Unauthorized');
  if (!hasAtLeastRole(actor.user, minRole)) throw new HttpError(403, 'Forbidden');
}
