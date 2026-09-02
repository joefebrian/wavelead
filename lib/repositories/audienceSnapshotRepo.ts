// M11-Batch2A — Owner-submitted follower-count evidence repository.
// Append-only history. Public reads always use latest verified.
import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { ChannelAudienceSnapshot, AudienceSnapshotStatus } from '@/lib/types';

async function coll() {
  return getCollection<ChannelAudienceSnapshot>(COLLECTIONS.CHANNEL_AUDIENCE_SNAPSHOTS);
}

export const audienceSnapshotRepo = {
  async insert(doc: ChannelAudienceSnapshot): Promise<ChannelAudienceSnapshot> {
    const c = await coll();
    await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<ChannelAudienceSnapshot>);
    return stripId(doc) as ChannelAudienceSnapshot;
  },
  async findById(id: string): Promise<ChannelAudienceSnapshot | null> {
    const c = await coll();
    return stripId(await c.findOne({ id } as Filter<ChannelAudienceSnapshot>)) as ChannelAudienceSnapshot | null;
  },
  async findActivePendingForChannel(channelId: string): Promise<ChannelAudienceSnapshot | null> {
    const c = await coll();
    return stripId(await c.findOne({ channel_id: channelId, status: 'pending' } as Filter<ChannelAudienceSnapshot>)) as ChannelAudienceSnapshot | null;
  },
  async findLatestVerifiedForChannel(channelId: string): Promise<ChannelAudienceSnapshot | null> {
    const c = await coll();
    const doc = await c.find({ channel_id: channelId, status: 'verified' } as Filter<ChannelAudienceSnapshot>).sort({ verified_at: -1, created_at: -1 } as Sort).limit(1).next();
    return stripId(doc) as ChannelAudienceSnapshot | null;
  },
  async listForChannel(channelId: string, limit = 50): Promise<ChannelAudienceSnapshot[]> {
    const c = await coll();
    return stripIds(await c.find({ channel_id: channelId } as Filter<ChannelAudienceSnapshot>).sort({ created_at: -1 }).limit(limit).toArray()) as ChannelAudienceSnapshot[];
  },
  async listByStatus(status: AudienceSnapshotStatus, limit = 100): Promise<ChannelAudienceSnapshot[]> {
    const c = await coll();
    return stripIds(await c.find({ status } as Filter<ChannelAudienceSnapshot>).sort({ created_at: -1 }).limit(limit).toArray()) as ChannelAudienceSnapshot[];
  },
  async update(id: string, patch: Partial<ChannelAudienceSnapshot>): Promise<void> {
    const c = await coll();
    await c.updateOne(
      { id } as Filter<ChannelAudienceSnapshot>,
      { $set: { ...(patch as object), updated_at: new Date() } } as unknown as import('mongodb').UpdateFilter<ChannelAudienceSnapshot>,
    );
  },
  // Atomically transition a specific pending row → superseded. Guarded by
  // {id, status:'pending'} so we never overwrite an already-verified or
  // rejected row. Returns the doc that was updated (post-image), or null if
  // the guard did not match (i.e., no longer pending).
  async markSuperseded(id: string, supersededBySnapshotId: string): Promise<ChannelAudienceSnapshot | null> {
    const c = await coll();
    const now = new Date();
    const res = await c.findOneAndUpdate(
      { id, status: 'pending' } as Filter<ChannelAudienceSnapshot>,
      { $set: { status: 'superseded', superseded_by_snapshot_id: supersededBySnapshotId, updated_at: now } } as unknown as import('mongodb').UpdateFilter<ChannelAudienceSnapshot>,
      { returnDocument: 'after' } as { returnDocument: 'after' },
    );
    const doc = (res as unknown as { value?: ChannelAudienceSnapshot } | ChannelAudienceSnapshot | null);
    if (!doc) return null;
    // Driver v6 returns the doc directly; v4/v5 wraps in { value }.
    const raw = (doc as { value?: ChannelAudienceSnapshot }).value ?? (doc as ChannelAudienceSnapshot);
    return raw ? (stripId(raw) as ChannelAudienceSnapshot) : null;
  },
};
