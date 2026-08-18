// Data-access infrastructure: singleton Mongo client + db handle.
// Business logic MUST NOT import mongodb directly — go through repositories.

import { MongoClient } from 'mongodb';

const globalForMongo = globalThis;
if (!globalForMongo.__wavehub_mongo) {
  globalForMongo.__wavehub_mongo = { client: null, db: null, indexesEnsured: false, connecting: null };
}

async function connect() {
  const state = globalForMongo.__wavehub_mongo;
  if (state.db) return state.db;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    const url = process.env.MONGO_URL;
    const dbName = process.env.DB_NAME || 'wavehub';
    if (!url) throw new Error('MONGO_URL is not configured');
    const client = new MongoClient(url, { maxPoolSize: 20 });
    await client.connect();
    state.client = client;
    state.db = client.db(dbName);
    return state.db;
  })();

  const db = await state.connecting;
  state.connecting = null;
  return db;
}

export async function getDb() {
  const db = await connect();
  if (!globalForMongo.__wavehub_mongo.indexesEnsured) {
    const { ensureIndexes } = await import('./indexes.js');
    await ensureIndexes(db);
    globalForMongo.__wavehub_mongo.indexesEnsured = true;
  }
  return db;
}

export async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}

// Strip Mongo internal `_id` before returning documents to callers.
export function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

export function stripIds(docs) {
  return (docs || []).map(stripId);
}
