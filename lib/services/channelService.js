import { channelRepo } from '../repositories/channelRepo.js';
import { categoryRepo } from '../repositories/categoryRepo.js';

export const channelService = {
  // Public: only ever expose 'approved' channels.
  async listPublic({ category, country, q, sort = 'newest', limit = 24, skip = 0 } = {}) {
    const filter = { status: 'approved' };
    if (category) {
      const cat = await categoryRepo.findBySlug(category);
      if (!cat) return { items: [], total: 0 };
      filter.category_id = cat.id;
    }
    if (country) filter.country_code = country.toUpperCase();
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ];
    let sortSpec = { created_at: -1 };
    if (sort === 'top') sortSpec = { follower_count: -1 };
    if (sort === 'trending') sortSpec = { is_featured: -1, follower_count: -1 };
    const [items, total] = await Promise.all([
      channelRepo.list({ filter, sort: sortSpec, limit, skip }),
      channelRepo.count(filter),
    ]);
    return { items: items.map(sanitizePublic), total };
  },

  async getPublicBySlug(slug) {
    const c = await channelRepo.findBySlug(slug);
    if (!c || c.status !== 'approved') return null;
    return sanitizePublic(c);
  },

  async getFeatured(limit = 6) {
    const items = await channelRepo.list({
      filter: { status: 'approved', is_featured: true },
      sort: { follower_count: -1 },
      limit,
    });
    return items.map(sanitizePublic);
  },

  async getStats() {
    const [totalApproved, totalPending] = await Promise.all([
      channelRepo.count({ status: 'approved' }),
      channelRepo.count({ status: 'pending_review' }),
    ]);
    return { totalApproved, totalPending };
  },
};

function sanitizePublic(c) {
  if (!c) return c;
  // Owner IDs and internal fields never go to the public API.
  const { owner_id, verification_status, ...rest } = c;
  return { ...rest, is_verified: verification_status === 'verified' || verification_status === 'official' };
}
