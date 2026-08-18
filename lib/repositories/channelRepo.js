import { getCollection, stripId, stripIds } from '../db/mongo.js';
import { COLLECTIONS } from '../db/collections.js';

async function coll() { return getCollection(COLLECTIONS.CHANNELS); }

export const channelRepo = {
  async findBySlug(slug) {
    const c = await coll();
    return stripId(await c.findOne({ slug }));
  },
  async findById(id) {
    const c = await coll();
    return stripId(await c.findOne({ id }));
  },
  async list({ filter = {}, sort = { created_at: -1 }, limit = 24, skip = 0 } = {}) {
    const c = await coll();
    return stripIds(await c.find(filter).sort(sort).skip(skip).limit(limit).toArray());
  },
  async count(filter = {}) {
    const c = await coll();
    return c.countDocuments(filter);
  },
  async insert(doc) {
    const c = await coll();
    await c.insertOne(doc);
    return stripId(doc);
  },
  async insertMany(docs) {
    const c = await coll();
    if (!docs.length) return [];
    await c.insertMany(docs, { ordered: false });
    return docs.map(stripId);
  },
  async update(id, patch) {
    const c = await coll();
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
};
