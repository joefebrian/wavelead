// Canonical country registry for WaveLead.
//
// M17 — SINGLE SOURCE OF TRUTH. Every surface (Submit Channel, channel edit,
// admin, discovery filters, /countries, /country/[slug], SEO metadata and
// structured data) resolves countries through this module. Do NOT duplicate
// hard-coded country lists anywhere else.
//
// Data: ISO 3166-1 alpha-2 codes with CLDR English names (lib/constants/
// countryData.ts). Slugs are derived deterministically and are stable — the
// legacy WaveLead slugs (indonesia, india, brazil, united-states, mexico,
// philippines, malaysia, singapore, thailand, vietnam, united-kingdom) all
// resolve to the same values they had before M17.
import { COUNTRY_DATA } from './countryData';

export interface CountryEntry {
  code: string;
  slug: string;
  name: string;
  flag: string;
}

/** Regional-indicator emoji flag derived from the alpha-2 code. */
function flagFor(code: string): string {
  const A = 0x1f1e6;
  const up = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return '🏳️';
  return String.fromCodePoint(A + (up.charCodeAt(0) - 65), A + (up.charCodeAt(1) - 65));
}

/** Deterministic, URL-safe slug. Stable across releases. */
export function slugifyCountryName(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Deprecated / duplicate CLDR aliases that would collide with the canonical
// ISO 3166-1 code (e.g. UK vs GB). Resolvable via LEGACY_ALIASES below.
const DEPRECATED_CODES = new Set(['UK', 'AN', 'CS', 'SU', 'TP', 'YU', 'ZR', 'FX', 'BU', 'DD', 'NT', 'QU', 'RH']);

export const COUNTRIES: CountryEntry[] = COUNTRY_DATA.split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const idx = line.indexOf(':');
    const code = line.slice(0, idx).toUpperCase();
    const name = line.slice(idx + 1).trim();
    return { code, name, slug: slugifyCountryName(name), flag: flagFor(code) };
  })
  .filter((c) => !DEPRECATED_CODES.has(c.code))
  .filter((c, i, arr) => arr.findIndex((x) => x.slug === c.slug) === i)   // one entry per slug
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const BY_SLUG = new Map(COUNTRIES.map((c) => [c.slug, c]));
const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

/**
 * Legacy aliases kept so production data written before M17 keeps resolving.
 * Maps any historical name/slug/code spelling → canonical alpha-2 code.
 */
const LEGACY_ALIASES: Record<string, string> = {
  'united-states-of-america': 'US', 'usa': 'US', 'america': 'US',
  'uk': 'GB', 'great-britain': 'GB', 'england': 'GB',
  'uae': 'AE', 'united-arab-emirates': 'AE',
  'ksa': 'SA', 'kingdom-of-saudi-arabia': 'SA', 'saudi': 'SA', 'saudi-arabia': 'SA',
  'south-korea': 'KR', 'korea': 'KR', 'republic-of-korea': 'KR',
  'ivory-coast': 'CI', 'cote-d-ivoire': 'CI',
  'czech-republic': 'CZ', 'turkey': 'TR', 'burma': 'MM',
  'cape-verde': 'CV', 'swaziland': 'SZ', 'macedonia': 'MK',
  'east-timor': 'TL', 'holland': 'NL', 'netherlands': 'NL',
  'vietnam': 'VN', 'viet-nam': 'VN', 'russia': 'RU',
  'hong-kong': 'HK', 'macau': 'MO', 'macao': 'MO',
};

export function countryByCode(code?: string | null): CountryEntry | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().toUpperCase()) || null;
}

export function countryBySlug(slug?: string | null): CountryEntry | null {
  if (!slug) return null;
  const s = slug.trim().toLowerCase();
  const direct = BY_SLUG.get(s);
  if (direct) return direct;
  const aliased = LEGACY_ALIASES[s];
  return aliased ? BY_CODE.get(aliased) || null : null;
}

/**
 * M17 read/write boundary normalizer. Accepts a code, canonical name, slug or
 * a legacy spelling and returns the canonical alpha-2 code (or null).
 * Non-destructive: existing documents are never rewritten.
 */
export function normalizeCountryCode(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  const byCode = BY_CODE.get(raw.toUpperCase());
  if (byCode) return byCode.code;
  const byName = BY_NAME.get(raw.toLowerCase());
  if (byName) return byName.code;
  const bySlug = countryBySlug(slugifyCountryName(raw));
  return bySlug ? bySlug.code : null;
}

/** Resolve any legacy/current value to a full entry (or null). */
export function resolveCountry(input?: string | null): CountryEntry | null {
  const code = normalizeCountryCode(input);
  return code ? BY_CODE.get(code) || null : null;
}

export function countryName(code?: string | null): string {
  return countryByCode(code)?.name || (code || '');
}

/** Options for <select> surfaces — one shared list everywhere. */
export const COUNTRY_OPTIONS: { value: string; label: string }[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${c.flag} ${c.name}`,
}));

export const COUNTRY_COUNT = COUNTRIES.length;
