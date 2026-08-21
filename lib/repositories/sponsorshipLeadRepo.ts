import { COLLECTIONS } from '../db/collections';
import { getCollection, stripIds } from '../db/mongo';
import type { Filter } from 'mongodb';
import type { SponsorshipLead, SponsorshipLeadStatus } from '@/lib/types';

export const sponsorshipLeadRepo = {
  async insert(doc: SponsorshipLead): Promise<SponsorshipLead> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    await c.insertOne(doc as never);
    return doc;
  },
  async findById(id: string): Promise<SponsorshipLead | null> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    const row = await c.findOne({ id });
    return row ? (stripIds([row])[0] as SponsorshipLead) : null;
  },
  async list(filter: Filter<SponsorshipLead>, opts: { limit?: number; skip?: number } = {}): Promise<SponsorshipLead[]> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    const rows = await c.find(filter).sort({ created_at: -1 }).skip(opts.skip || 0).limit(opts.limit || 100).toArray();
    return stripIds(rows) as SponsorshipLead[];
  },
  async count(filter: Filter<SponsorshipLead> = {}): Promise<number> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    return c.countDocuments(filter);
  },
  async updateStatus(id: string, status: SponsorshipLeadStatus, admin_notes: string | null): Promise<SponsorshipLead | null> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    const set: Record<string, unknown> = { status, updated_at: new Date() };
    if (admin_notes !== undefined) set.admin_notes = admin_notes;
    await c.updateOne({ id }, { $set: set });
    return this.findById(id);
  },
  async recentByEmailCount(email: string, sinceMs: number): Promise<number> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    return c.countDocuments({ work_email: email.toLowerCase(), created_at: { $gte: new Date(Date.now() - sinceMs) } });
  },
  async statusCounts(): Promise<Record<SponsorshipLeadStatus, number>> {
    const c = await getCollection<SponsorshipLead>(COLLECTIONS.SPONSORSHIP_LEADS);
    const rows = await c.aggregate<{ _id: SponsorshipLeadStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    const out: Record<SponsorshipLeadStatus, number> = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
    for (const r of rows) if (r._id in out) out[r._id] = r.n;
    return out;
  },
};
