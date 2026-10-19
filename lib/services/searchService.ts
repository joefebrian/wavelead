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
//
// M06.1 hardening: applies the same canonical public-visibility policy as
// channelService.listPublic and channelService.getPublicBySlug — internal
// test/QA fixtures (is_test_fixture=true, slug ^test-, name ^Test ) are
// filtered out at the pipeline `$match` boundary. Legitimate approved
// channels whose organic content contains "test" (e.g. a category called
// "Software Testing") are NOT affected because we filter on the fixture
// marker + slug/name PREFIX only, never on substring.
import { getCollection, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { categoryRepo } from '../repositories/categoryRepo';
import { sanitizeChannel } from '../utils/sanitize';
import { buildPublicChannelFilter } from './publicChannelVisibility';
import {
  EFFECTIVE_FOLLOWERS_ADD_FIELDS,
  EFFECTIVE_FOLLOWERS_FIELD,
  EFFECTIVE_FOLLOWERS_SORT,
} from '../utils/followerCount';
import type { Channel, PublicChannel } from '@/lib/types';

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const sanitize = sanitizeChannel;

interface Args { q?: string; category?: string; country?: string; limit?: number; skip?: number; }

export const searchService = {
  async searchApproved({ q, category, country, limit = 30, skip = 0 }: Args): Promise<{ items: PublicChannel[]; total: number }> {
    const trimmed = (q || '').trim();
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);

    if (!trimmed) {
      // No query — basic filtering + reach ordering. Apply the canonical
      // public-visibility policy (marker + fixture-pattern exclusion).
      const filter: Record<string, unknown> = buildPublicChannelFilter({ status: 'approved' });
      if (country) filter.country_code = country.toUpperCase();
      if (category) {
        const cat = await categoryRepo.findBySlug(category);
        if (!cat) return { items: [], total: 0 };
        filter.category_id = cat.id;
      }
      // Discovery polish: rank on the EFFECTIVE follower count (the number the
      // cards display) with a unique `id` tie-break, so paging through a
      // category can neither repeat nor skip a record.
      const [items, total] = await Promise.all([
        coll.aggregate<Channel>([
          { $match: filter },
          { $addFields: EFFECTIVE_FOLLOWERS_ADD_FIELDS },
          { $sort: EFFECTIVE_FOLLOWERS_SORT },
          { $skip: Math.max(0, skip) },
          { $limit: Math.max(1, limit) },
          { $project: { [EFFECTIVE_FOLLOWERS_FIELD]: 0 } },
        ]).toArray(),
        coll.countDocuments(filter),
      ]);
      return { items: stripIds(items).map((c) => sanitize(c as Channel)), total };
    }

    const qLower = trimmed.toLowerCase();
    const qEsc = escapeRe(qLower);

    // Match any candidate that mentions the query anywhere (name / category / desc)
    // AND satisfies the canonical public-visibility policy.
    const match: Record<string, unknown> = buildPublicChannelFilter({
      status: 'approved',
      $or: [
        { name: new RegExp(qEsc, 'i') },
        { short_description: new RegExp(qEsc, 'i') },
        { description: new RegExp(qEsc, 'i') },
      ],
    });
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

    // Discovery polish — COUNT ACCURACY. The total used to be
    // `countDocuments(match)`, i.e. computed BEFORE the category post-filter,
    // so a category-scoped search reported the unfiltered total. It is now
    // counted through the SAME pipeline the items come from, which means the
    // "Showing 1–30 of N" label and the result set always agree.
    const countPipeline = [...pipeline, { $count: 'n' }];

    // Deterministic ordering: score, then the effective follower count (the
    // number the cards display), then the unique `id`. Without a unique final
    // key, two equally-scored rows could swap places between page requests and
    // appear twice — or vanish.
    pipeline.push({ $addFields: EFFECTIVE_FOLLOWERS_ADD_FIELDS });
    pipeline.push({ $sort: { _score: -1, [EFFECTIVE_FOLLOWERS_FIELD]: -1, follower_count: -1, id: 1 } });
    pipeline.push({ $skip: Math.max(0, skip) });
    pipeline.push({ $limit: Math.max(1, limit) });
    pipeline.push({ $project: { _cat: 0, _cat_name: 0, _cat_slug: 0, _name_lower: 0, _sd_lower: 0, _d_lower: 0, _score: 0, [EFFECTIVE_FOLLOWERS_FIELD]: 0 } });

    const [rows, countRows] = await Promise.all([
      coll.aggregate<Channel>(pipeline).toArray(),
      coll.aggregate<{ n: number }>(countPipeline).toArray(),
    ]);
    const items = stripIds(rows).map((c) => sanitize(c as Channel));
    return { items, total: countRows[0]?.n ?? 0 };
  },
};
