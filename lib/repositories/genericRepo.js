// Lightweight generic repositories for lower-priority entities.
import { getCollection, stripId, stripIds } from '../db/mongo.js';
import { COLLECTIONS } from '../db/collections.js';

function makeRepo(collectionName) {
  async function coll() { return getCollection(collectionName); }
  return {
    async insert(doc) { const c = await coll(); await c.insertOne(doc); return stripId(doc); },
    async findById(id) { const c = await coll(); return stripId(await c.findOne({ id })); },
    async list(filter = {}, sort = { created_at: -1 }, limit = 100) {
      const c = await coll();
      return stripIds(await c.find(filter).sort(sort).limit(limit).toArray());
    },
    async count(filter = {}) { const c = await coll(); return c.countDocuments(filter); },
    async update(id, patch) {
      const c = await coll();
      await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
    },
  };
}

export const claimRepo = makeRepo(COLLECTIONS.CHANNEL_CLAIMS);
export const eventRepo = makeRepo(COLLECTIONS.EVENTS);
export const bookmarkRepo = makeRepo(COLLECTIONS.BOOKMARKS);
export const reportRepo = makeRepo(COLLECTIONS.REPORTS);
export const auditRepo = makeRepo(COLLECTIONS.AUDIT_LOGS);
export const metricRepo = makeRepo(COLLECTIONS.CHANNEL_DAILY_METRICS);
