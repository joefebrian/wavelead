import { getCollection, stripId } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { Role, User } from '@/lib/types';

async function coll() { return getCollection<User>(COLLECTIONS.USERS); }

export const userRepo = {
  async findByEmail(email: string): Promise<User | null> {
    const c = await coll();
    return stripId(await c.findOne({ email: email.toLowerCase() })) as User | null;
  },
  async findById(id: string): Promise<User | null> {
    const c = await coll();
    return stripId(await c.findOne({ id })) as User | null;
  },
  async insert(user: User): Promise<User> {
    const c = await coll();
    await c.insertOne(user);
    return stripId(user) as User;
  },
  async updateRole(id: string, role: Role): Promise<void> {
    const c = await coll();
    await c.updateOne({ id }, { $set: { role, updated_at: new Date() } });
  },
  async updateFields(id: string, fields: Partial<User>): Promise<void> {
    const c = await coll();
    await c.updateOne({ id }, { $set: fields as never });
  },
  async count(): Promise<number> {
    const c = await coll();
    return c.countDocuments();
  },
};
