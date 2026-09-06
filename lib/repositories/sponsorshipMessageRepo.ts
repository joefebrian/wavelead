// M16 — Append-only conversation messages attached to a sponsorship request
// (sponsorship_leads.id). No edits, no deletes: the thread is an audit trail
// for negotiation / brief clarification between brand and channel owner.
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripIds } from '../db/mongo';
import type { SponsorshipRequestMessage } from '@/lib/types';

export const sponsorshipMessageRepo = {
  async insert(doc: SponsorshipRequestMessage): Promise<SponsorshipRequestMessage> {
    const c = await getCollection<SponsorshipRequestMessage>(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES);
    await c.insertOne(doc as never);
    return doc;
  },
  async listByLead(leadId: string, limit = 200): Promise<SponsorshipRequestMessage[]> {
    const c = await getCollection<SponsorshipRequestMessage>(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES);
    const rows = await c.find({ lead_id: leadId }).sort({ created_at: 1 }).limit(limit).toArray();
    return stripIds(rows) as SponsorshipRequestMessage[];
  },
  async countByLead(leadId: string): Promise<number> {
    const c = await getCollection<SponsorshipRequestMessage>(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES);
    return c.countDocuments({ lead_id: leadId });
  },
  async recentBySenderCount(senderUserId: string, sinceMs: number): Promise<number> {
    const c = await getCollection<SponsorshipRequestMessage>(COLLECTIONS.SPONSORSHIP_REQUEST_MESSAGES);
    return c.countDocuments({ sender_user_id: senderUserId, created_at: { $gte: new Date(Date.now() - sinceMs) } });
  },
};
