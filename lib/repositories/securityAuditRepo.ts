import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripIds } from '../db/mongo';
import type { SecurityAuditEvent } from '@/lib/types';

export const securityAuditRepo = {
  async record(event: Omit<SecurityAuditEvent, 'id' | 'created_at'>): Promise<void> {
    const c = await getCollection<SecurityAuditEvent>(COLLECTIONS.SECURITY_AUDIT_EVENTS);
    await c.insertOne({ ...event, id: uuidv4(), created_at: new Date() } as never);
  },
  async recent(limit = 50): Promise<SecurityAuditEvent[]> {
    const c = await getCollection<SecurityAuditEvent>(COLLECTIONS.SECURITY_AUDIT_EVENTS);
    const rows = await c.find({}).sort({ created_at: -1 }).limit(limit).toArray();
    return stripIds(rows) as SecurityAuditEvent[];
  },
};
