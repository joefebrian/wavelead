import { Filter, Sort, Document } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';

function makeRepo<T extends Document & { id: string }>(collectionName: string) {
  async function coll() { return getCollection<T>(collectionName); }
  return {
    async insert(doc: T): Promise<T> {
      const c = await coll();
      await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<T>);
      return stripId(doc) as T;
    },
    async findById(id: string): Promise<T | null> {
      const c = await coll();
      return stripId(await c.findOne({ id } as Filter<T>)) as T | null;
    },
    async list(filter: Filter<T> = {}, sort: Sort = { created_at: -1 }, limit = 100): Promise<T[]> {
      const c = await coll();
      return stripIds(await c.find(filter).sort(sort).limit(limit).toArray()) as T[];
    },
    async count(filter: Filter<T> = {}): Promise<number> {
      const c = await coll();
      return c.countDocuments(filter);
    },
    async update(id: string, patch: Partial<T>): Promise<void> {
      const c = await coll();
      await c.updateOne(
        { id } as Filter<T>,
        { $set: { ...(patch as object), updated_at: new Date() } } as unknown as import('mongodb').UpdateFilter<T>
      );
    },
  };
}

import type { ChannelClaim, EventRecord, Report, AuditLog, DailyMetric } from '@/lib/types';

export const claimRepo = makeRepo<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
export const eventRepo = makeRepo<EventRecord>(COLLECTIONS.EVENTS);
export const reportRepo = makeRepo<Report>(COLLECTIONS.REPORTS);
export const auditRepo = makeRepo<AuditLog>(COLLECTIONS.AUDIT_LOGS);
export const metricRepo = makeRepo<DailyMetric>(COLLECTIONS.CHANNEL_DAILY_METRICS);
