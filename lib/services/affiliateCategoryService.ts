// M17 — Idempotent affiliate/creator-commerce taxonomy ensure.
//
// Reuses an existing overlapping category (by slug, alias or name) instead of
// creating a near-duplicate. Never deletes or renames existing categories.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError, requireAuth, ROLES, rankOf } from '@/lib/auth/rbac';
import { AFFILIATE_CATEGORIES } from '@/lib/constants/affiliateCategories';
import type { Actor } from '@/lib/types';

interface CategoryDoc {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
  created_at: Date;
  updated_at: Date;
}

function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const affiliateCategoryService = {
  /** Dry-run-able ensure. Returns what was created vs reused. */
  async ensure(opts: { dryRun?: boolean } = {}): Promise<{
    created: string[]; reused: string[]; total_categories: number;
  }> {
    const c = await getCollection<CategoryDoc>(COLLECTIONS.CATEGORIES);
    const existing = await c.find({}).toArray();
    const index = new Set<string>();
    for (const e of existing) {
      index.add(norm(e.slug));
      index.add(norm(e.name));
    }
    const created: string[] = [];
    const reused: string[] = [];
    for (const want of AFFILIATE_CATEGORIES) {
      const overlap = [want.slug, want.name, ...want.aliases].some((k) => index.has(norm(k)));
      if (overlap) { reused.push(want.slug); continue; }
      created.push(want.slug);
      if (opts.dryRun) continue;
      const now = new Date();
      await c.insertOne({
        id: uuidv4(),
        slug: want.slug,
        name: want.name,
        description: want.description,
        is_active: true,
        sort_order: 100,
        created_at: now,
        updated_at: now,
      } as never);
      index.add(norm(want.slug));
      index.add(norm(want.name));
    }
    const total = await c.countDocuments({});
    return { created, reused, total_categories: total };
  },

  async ensureAsAdmin(actor: Actor | null, dryRun = false) {
    requireAuth(actor);
    if (rankOf(actor!.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin only');
    return this.ensure({ dryRun });
  },
};
