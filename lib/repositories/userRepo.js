import { getCollection, stripId } from '../db/mongo.js';
import { COLLECTIONS } from '../db/collections.js';

async function coll() { return getCollection(COLLECTIONS.USERS); }

export const userRepo = {
  async findByEmail(email) {
    const c = await coll();
    return stripId(await c.findOne({ email: email.toLowerCase() }));
  },
  async findById(id) {
    const c = await coll();
    return stripId(await c.findOne({ id }));
  },
  async insert(user) {
    const c = await coll();
    await c.insertOne(user);
    return stripId(user);
  },
  async updateRole(id, role) {
    const c = await coll();
    await c.updateOne({ id }, { $set: { role, updated_at: new Date() } });
  },
  async count() {
    const c = await coll();
    return c.countDocuments();
  },
};
