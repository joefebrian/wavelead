// Pricing conversion — commercial_leads repo.
// Owns the single canonical row per (type, email) pair. Duplicate submissions
// are rejected at the DB layer by the uniq_type_email index.
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripId, stripIds } from '../db/mongo';
import type { CommercialLead, CommercialLeadStatus, CommercialLeadType } from '@/lib/types';

export const commercialLeadRepo = {
  async insert(doc: CommercialLead): Promise<CommercialLead> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    await c.insertOne(doc);
    return stripId(doc) as CommercialLead;
  },

  async findByTypeEmail(type: CommercialLeadType, email: string): Promise<CommercialLead | null> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    return stripId(await c.findOne({ type, email: email.toLowerCase() })) as CommercialLead | null;
  },

  async findById(id: string): Promise<CommercialLead | null> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    return stripId(await c.findOne({ id })) as CommercialLead | null;
  },

  async list(filter: { type?: CommercialLeadType; status?: CommercialLeadStatus } = {}): Promise<CommercialLead[]> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    const q: Record<string, unknown> = {};
    if (filter.type) q.type = filter.type;
    if (filter.status) q.status = filter.status;
    const rows = await c.find(q).sort({ created_at: -1 }).limit(500).toArray();
    return stripIds(rows) as CommercialLead[];
  },

  async updateStatus(id: string, status: CommercialLeadStatus, admin_notes: string | null | undefined): Promise<CommercialLead | null> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    const set: Record<string, unknown> = { status, updated_at: new Date() };
    if (admin_notes !== undefined) set.admin_notes = admin_notes ?? null;
    await c.updateOne({ id }, { $set: set });
    return stripId(await c.findOne({ id })) as CommercialLead | null;
  },

  async statusCounts(): Promise<Record<string, Record<string, number>>> {
    const c = await getCollection<CommercialLead>(COLLECTIONS.COMMERCIAL_LEADS);
    const cursor = c.aggregate<{ _id: { type: string; status: string }; n: number }>([
      { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const out: Record<string, Record<string, number>> = { pro_waitlist: {}, enterprise_sales: {} };
    for await (const row of cursor) {
      const t = row._id.type;
      if (!out[t]) out[t] = {};
      out[t][row._id.status] = row.n;
    }
    return out;
  },
};
