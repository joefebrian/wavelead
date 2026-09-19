// M17 — Affiliate / creator-commerce taxonomy.
//
// Canonical additions for affiliate creators. Aliases exist so an overlapping
// legacy category is REUSED instead of creating a near-duplicate.
export interface AffiliateCategorySeed {
  slug: string;
  name: string;
  description: string;
  /** Legacy slugs/names that mean the same thing — reuse, never duplicate. */
  aliases: string[];
}

export const AFFILIATE_CATEGORIES: AffiliateCategorySeed[] = [
  {
    slug: 'affiliate-shopping', name: 'Affiliate & Shopping',
    description: 'Discover WhatsApp Channels sharing product recommendations, affiliate offers, shopping inspiration and creator-led commerce.',
    aliases: ['affiliate', 'shopping', 'affiliate-marketing'],
  },
  {
    slug: 'deals-discounts', name: 'Deals & Discounts',
    description: 'Discover WhatsApp Channels sharing deals, promotions and limited-time offers.',
    aliases: ['deals', 'discounts', 'flash-sale'],
  },
  {
    slug: 'coupons-promotions', name: 'Coupons & Promotions',
    description: 'Discover WhatsApp Channels sharing coupon codes, vouchers and promotional campaigns.',
    aliases: ['coupons', 'promo', 'vouchers'],
  },
  {
    slug: 'product-recommendations', name: 'Product Recommendations',
    description: 'Discover creator-led WhatsApp Channels focused on product discovery, recommendations and shopping decisions.',
    aliases: ['recommendations', 'product-reviews'],
  },
  {
    slug: 'e-commerce', name: 'E-commerce',
    description: 'Discover WhatsApp Channels covering online stores, marketplaces and selling online.',
    aliases: ['ecommerce', 'online-store'],
  },
  {
    slug: 'tech-gadgets', name: 'Tech & Gadgets',
    description: 'Discover WhatsApp Channels covering technology, gadgets and consumer electronics.',
    aliases: ['technology', 'tech', 'gadgets'],
  },
  {
    slug: 'beauty-personal-care', name: 'Beauty & Personal Care',
    description: 'Discover WhatsApp Channels covering beauty, skincare and personal care products.',
    aliases: ['beauty', 'skincare', 'personal-care'],
  },
  {
    slug: 'fashion', name: 'Fashion',
    description: 'Discover WhatsApp Channels covering fashion, style and apparel drops.',
    aliases: ['style', 'apparel'],
  },
  {
    slug: 'travel-deals', name: 'Travel Deals',
    description: 'Discover WhatsApp Channels sharing flight, hotel and travel deals.',
    aliases: ['travel', 'flight-deals'],
  },
  {
    slug: 'food-dining-deals', name: 'Food & Dining Deals',
    description: 'Discover WhatsApp Channels sharing food, restaurant and dining offers.',
    aliases: ['food', 'dining', 'restaurants'],
  },
  {
    slug: 'home-lifestyle', name: 'Home & Lifestyle',
    description: 'Discover WhatsApp Channels covering home, living and lifestyle products.',
    aliases: ['home', 'lifestyle', 'living'],
  },
  {
    slug: 'finance-offers', name: 'Finance & Offers',
    description: 'Discover WhatsApp Channels sharing banking, card and financial product offers.',
    aliases: ['finance', 'fintech-offers', 'banking'],
  },
];

/** All slugs + aliases, used to detect overlap before inserting anything. */
export function affiliateCategoryKeys(): Set<string> {
  const set = new Set<string>();
  for (const c of AFFILIATE_CATEGORIES) {
    set.add(c.slug);
    for (const a of c.aliases) set.add(a);
  }
  return set;
}
