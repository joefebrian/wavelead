// M13 — WhatsApp public metadata parser.
//
// WhatsApp's public channel page wraps the actual bio inside its OG description
// with a leading metadata prefix that looks like:
//
//     Channel • 103K followers • <actual bio here>
//     Channel &#x2022; 1.2K followers &#x2022; <actual bio here>
//
// This helper:
//   1. decodes HTML entities (numeric decimal + hex)
//   2. detects & strips the leading wrapper only when anchored at start
//   3. normalizes the follower count (K/M suffixes)
//   4. never touches text that just happens to contain a bullet mid-bio
//
// It is a pure function set — no fetches, no DB, no side effects.

export function decodeHtmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = Number(d);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    });
}

// Accepts "103", "1.2K", "103K", "6.8M" (case-insensitive). Rejects everything
// else — including negative or exponent forms.
const FOLLOWER_UNIT = /^(\d+(?:\.\d+)?)([KM])?$/i;

export function parseFollowerCount(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(FOLLOWER_UNIT);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num) || num < 0) return null;
  const unit = (m[2] || '').toUpperCase();
  const mult = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return Math.round(num * mult);
}

// Anchored to the START of the WhatsApp OG description. Matches:
//   "Channel • 103K followers • "
// with optional pluralization and flexible whitespace. Does NOT match if the
// wrapper is not at the very beginning (protects legitimate bio content that
// merely contains a bullet).
const WA_WRAPPER = /^Channel\s*[•·]\s*([\d.]+[KMkm]?)\s*followers?\s*[•·]\s*/;

export interface ParsedWaDescription {
  followers: number | null;
  bio: string | null;
}

export function parseWhatsAppOgDescription(input: string | null | undefined): ParsedWaDescription {
  if (!input || typeof input !== 'string') return { followers: null, bio: null };
  const decoded = decodeHtmlEntities(input).trim();
  const m = decoded.match(WA_WRAPPER);
  if (!m) return { followers: null, bio: decoded || null };
  const followers = parseFollowerCount(m[1]);
  const bio = decoded.slice(m[0].length).trim();
  return { followers, bio: bio || null };
}

// Display-time cleanup for legacy stored bios: safe/idempotent (decode +
// strip only the anchored wrapper). Never touches text that doesn't match.
export function displayCleanWhatsAppDescription(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const { bio } = parseWhatsAppOgDescription(s);
  return bio;
}
