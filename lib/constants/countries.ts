// Static registry of countries we surface in the UI. Names + emoji flags.
// Enriched with live channel counts by the discovery service.
export interface CountryEntry {
  code: string;
  slug: string;
  name: string;
  flag: string;
}

export const COUNTRIES: CountryEntry[] = [
  { code: 'ID', slug: 'indonesia', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'IN', slug: 'india', name: 'India', flag: '🇮🇳' },
  { code: 'BR', slug: 'brazil', name: 'Brazil', flag: '🇧🇷' },
  { code: 'US', slug: 'united-states', name: 'United States', flag: '🇺🇸' },
  { code: 'MX', slug: 'mexico', name: 'Mexico', flag: '🇲🇽' },
  { code: 'PH', slug: 'philippines', name: 'Philippines', flag: '🇵🇭' },
  { code: 'MY', slug: 'malaysia', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'SG', slug: 'singapore', name: 'Singapore', flag: '🇸🇬' },
  { code: 'TH', slug: 'thailand', name: 'Thailand', flag: '🇹🇭' },
  { code: 'VN', slug: 'vietnam', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'GB', slug: 'united-kingdom', name: 'United Kingdom', flag: '🇬🇧' },
];

export function countryByCode(code?: string | null): CountryEntry | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code.toLowerCase() === code.toLowerCase()) || null;
}

export function countryBySlug(slug?: string | null): CountryEntry | null {
  if (!slug) return null;
  return COUNTRIES.find((c) => c.slug === slug.toLowerCase()) || null;
}
