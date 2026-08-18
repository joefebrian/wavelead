import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { Category } from '@/lib/types';

async function coll() { return getCollection<Category>(COLLECTIONS.CATEGORIES); }

export const categoryRepo = {
  async findBySlug(slug: string): Promise<Category | null> {
    const c = await coll();
    return stripId(await c.findOne({ slug })) as Category | null;
  },
  async listActive(): Promise<Category[]> {
    const c = await coll();
    return stripIds(
      await c.find({ is_active: true }).sort({ display_order: 1, name: 1 }).toArray()
    ) as Category[];
  },
  async count(): Promise<number> {
    const c = await coll();
    return c.countDocuments();
  },
};
