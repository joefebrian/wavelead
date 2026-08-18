import { getCollection, stripId, stripIds } from '../db/mongo.js';
import { COLLECTIONS } from '../db/collections.js';

async function coll() { return getCollection(COLLECTIONS.CATEGORIES); }

export const categoryRepo = {
  async findBySlug(slug) {
    const c = await coll();
    return stripId(await c.findOne({ slug }));
  },
  async listActive() {
    const c = await coll();
    return stripIds(await c.find({ is_active: true }).sort({ display_order: 1, name: 1 }).toArray());
  },
  async count() {
    const c = await coll();
    return c.countDocuments();
  },
  async insertMany(docs) {
    const c = await coll();
    if (!docs.length) return;
    await c.insertMany(docs, { ordered: false });
  },
};
