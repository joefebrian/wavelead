// Data-access infrastructure. Only repositories should import from here.
import { MongoClient, Db, Collection, Document } from 'mongodb';

interface MongoState {
  client: MongoClient | null;
  db: Db | null;
  indexesEnsured: boolean;
  connecting: Promise<Db> | null;
}

const globalForMongo = globalThis as unknown as { __wavelead_mongo?: MongoState };
if (!globalForMongo.__wavelead_mongo) {
  globalForMongo.__wavelead_mongo = { client: null, db: null, indexesEnsured: false, connecting: null };
}

async function connect(): Promise<Db> {
  const state = globalForMongo.__wavelead_mongo!;
  if (state.db) return state.db;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    const url = process.env.MONGO_URL;
    const dbName = process.env.DB_NAME || 'wavelead';
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

export async function getDb(): Promise<Db> {
  const db = await connect();
  const state = globalForMongo.__wavelead_mongo!;
  if (!state.indexesEnsured) {
    const { ensureIndexes } = await import('./indexes');
    await ensureIndexes(db);
    state.indexesEnsured = true;
  }
  return db;
}

export async function getCollection<T extends Document = Document>(name: string): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

// Strip Mongo internal `_id` before returning documents to callers.
export function stripId<T>(doc: T | null): T | null {
  if (!doc) return null;
  const cloned: Record<string, unknown> = { ...(doc as unknown as Record<string, unknown>) };
  delete cloned._id;
  return cloned as unknown as T;
}

export function stripIds<T>(docs: T[] | null | undefined): T[] {
  return (docs || []).map((d) => stripId(d) as T);
}
