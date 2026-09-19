import type { MetadataRoute } from 'next';
import { COUNTRIES } from '@/lib/constants/countries';

// M17 — Dynamic sitemap. Public, indexable surfaces ONLY:
// core pages + canonical categories + country pages that have listings +
// approved public channels only. Private, admin, owner-area, pending and
// rejected records are never emitted.
export const revalidate = 3600;

function origin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();
  const now = new Date();
  const core = ['', '/channels', '/trending', '/top', '/categories', '/countries', '/pricing', '/for-brands', '/faq', '/contact', '/about', '/submit', '/privacy', '/terms']
    .map((p) => ({ url: `${base}${p || '/'}`, lastModified: now, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.6 }));

  const entries: MetadataRoute.Sitemap = [...core];

  try {
    const { categoryRepo } = await import('@/lib/repositories/categoryRepo');
    const cats = await categoryRepo.listActive();
    for (const c of cats) {
      entries.push({ url: `${base}/category/${c.slug}`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 });
    }
  } catch { /* categories unavailable → core sitemap still valid */ }

  try {
    const { discoveryService } = await import('@/lib/services/discoveryService');
    const counts = await discoveryService.getCountryCounts();
    for (const c of counts) {
      // Only index country pages that actually have listings — no thin pages.
      if (c.channel_count > 0) {
        entries.push({ url: `${base}/country/${c.slug}`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 });
      }
    }
  } catch {
    void COUNTRIES;
  }

  try {
    const { getCollection } = await import('@/lib/db/mongo');
    const { COLLECTIONS } = await import('@/lib/db/collections');
    const col = await getCollection<{ slug: string; updated_at?: Date; status: string; is_test_fixture?: boolean }>(COLLECTIONS.CHANNELS);
    const rows = await col.find({ status: 'approved', is_test_fixture: { $ne: true } })
      .project({ slug: 1, updated_at: 1 }).limit(5000).toArray();
    for (const r of rows) {
      if (!r.slug) continue;
      entries.push({ url: `${base}/channel/${r.slug}`, lastModified: r.updated_at ? new Date(r.updated_at) : now, changeFrequency: 'weekly', priority: 0.8 });
    }
  } catch { /* channel listing unavailable → core sitemap still valid */ }

  return entries;
}
