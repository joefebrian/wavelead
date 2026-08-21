// Super-Admin user management service.
import { getCollection, stripIds } from '../../db/mongo';
import { COLLECTIONS } from '../../db/collections';
import { HttpError, hasAtLeastRole, ROLES } from '../../auth/rbac';
import type { Actor, PublicUser, User } from '@/lib/types';

function toPublic(u: User): PublicUser {
  const { password_hash: _drop, ...rest } = u as User & { _id?: unknown };
  void _drop;
  return rest as PublicUser;
}

export const adminUserService = {
  async search(actor: Actor, q: string): Promise<PublicUser[]> {
    if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
    const coll = await getCollection<User>(COLLECTIONS.USERS);
    const filter = q
      ? { $or: [{ email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { display_name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
      : {};
    const rows = await coll.find(filter).sort({ created_at: -1 }).limit(50).toArray();
    return stripIds(rows).map((r) => toPublic(r as User));
  },
  async getById(actor: Actor, id: string): Promise<PublicUser> {
    if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) throw new HttpError(403, 'Super Admin privileges required');
    const coll = await getCollection<User>(COLLECTIONS.USERS);
    const row = await coll.findOne({ id });
    if (!row) throw new HttpError(404, 'User not found');
    return toPublic(stripIds([row])[0] as User);
  },
};
