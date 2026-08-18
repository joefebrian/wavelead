// Weighted MongoDB search with no external dependencies.
// Scoring (highest wins):
//   Exact channel name                    100
//   Channel name startsWith query          90
//   Exact category (via lookup)            85
//   Whole-word channel name                80
//   Short-description whole-word           55
//   Description whole-word                 40
//   Partial substring anywhere             15
// Boosts: official +10, verified +8, featured +4.
import { getCollection, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { categoryRepo } from '../repositories/categoryRepo';
import { sanitizeChannel } from '../utils/sanitize';
import type { Channel, PublicChannel } from '@/lib/types';

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const sanitize = sanitizeChannel;

interface Args { q?: string; category?: string; country?: string; limit?: number; }

export const searchService = {
  async searchApproved({ q, category, country, limit = 30 }: Args): Promise<{ items: PublicChannel[]; total: number }> {
    const trimmed = (q || '').trim();
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);

    if (!trimmed) {
      // No query — basic filtering + reach ordering.
      const filter: Record<string, unknown> = { status: 'approved' };
      if (country) filter.country_code = country.toUpperCase();
      if (category) {
        const cat = await categoryRepo.findBySlug(category);
        if (!cat) return { items: [], total: 0 };
        filter.category_id = cat.id;
      }
      const [items, total] = await Promise.all([
        coll.find(filter).sort({ follower_count: -1 }).limit(limit).toArray(),
        coll.countDocuments(filter),
      ]);
      return { items: stripIds(items).map((c) => sanitize(c as Channel)), total };
    }

    const qLower = trimmed.toLowerCase();
    const qEsc = escapeRe(qLower);
    const wordRe = new RegExp(`\\b${qEsc}\\b`, 'i');
    const partRe = new RegExp(qEsc, 'i');

    // Match any candidate that mentions the query anywhere (name / category / desc).
    // Category matching goes through a lookup on the aggregation.
    const match: Record<string, unknown> = {
      status: 'approved',
      $or: [
        { name: partRe },
        { short_description: partRe },
        { description: partRe },
      ],
    };
    if (country) match.country_code = country.toUpperCase();

    const pipeline: Record<string, unknown>[] = [
      { $match: match },
      { $lookup: { from: COLLECTIONS.CATEGORIES, localField: 'category_id', foreignField: 'id', as: '_cat' } },
      { $addFields: {
          _cat_name: { $ifNull: [{ $arrayElemAt: ['$_cat.name', 0] }, ''] },
          _cat_slug: { $ifNull: [{ $arrayElemAt: ['$_cat.slug', 0] }, ''] },
          _name_lower: { $toLower: '$name' },
          _sd_lower: { $toLower: { $ifNull: ['$short_description', ''] } },
          _d_lower: { $toLower: { $ifNull: ['$description', ''] } },
      } },
      { $addFields: {
          _score: {
            $add: [
              { $cond: [{ $eq: ['$_name_lower', qLower] }, 100, 0] },
              { $cond: [{ $eq: [{ $indexOfCP: ['$_name_lower', qLower] }, 0] }, 90, 0] },
              { $cond: [{ $regexMatch: { input: { $toLower: '$_cat_name' }, regex: `^${qEsc}$` } }, 85, 0] },
              { $cond: [{ $regexMatch: { input: '$_name_lower', regex: `\\b${qEsc}\\b` } }, 80, 0] },
              // Category prefix / substring lifts sports-like categories above weak
              // description-only matches (e.g. "sport" → "Sports" category outranks
              // Gaming channels that mention "sport" in the description).
              { $cond: [{ $regexMatch: { input: { $toLower: '$_cat_name' }, regex: `^${qEsc}` } }, 70, 0] },
              { $cond: [{ $regexMatch: { input: { $toLower: '$_cat_name' }, regex: qEsc } }, 60, 0] },
              { $cond: [{ $regexMatch: { input: '$_sd_lower', regex: `\\b${qEsc}\\b` } }, 55, 0] },
              { $cond: [{ $regexMatch: { input: '$_d_lower', regex: `\\b${qEsc}\\b` } }, 40, 0] },
              { $cond: [{ $ne: [{ $indexOfCP: ['$_name_lower', qLower] }, -1] }, 15, 0] },
              // boosts
              { $cond: ['$is_official', 10, 0] },
              { $cond: [{ $or: [{ $eq: ['$verification_status', 'verified'] }, { $eq: ['$verification_status', 'official'] }] }, 8, 0] },
              { $cond: ['$is_featured', 4, 0] },
            ],
          },
      } },
    ];

    if (category) {
      pipeline.push({ $match: { _cat_slug: category } });
    }

    pipeline.push({ $sort: { _score: -1, follower_count: -1 } });
    pipeline.push({ $limit: limit });
    pipeline.push({ $project: { _cat: 0, _cat_name: 0, _cat_slug: 0, _name_lower: 0, _sd_lower: 0, _d_lower: 0, _score: 0 } });

    const rows = await coll.aggregate<Channel>(pipeline).toArray();
    const items = stripIds(rows).map((c) => sanitize(c as Channel));

    // Total = broader count (before category post-filter for perf).
    const total = await coll.countDocuments(match);
    return { items, total };
  },
};
