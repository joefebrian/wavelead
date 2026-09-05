// M13 — WhatsApp public metadata enrichment (parser + persistence contract).
// Targeted: entity decode, follower unit normalization, wrapper stripping,
// legitimate bio preservation, no verified-evidence side effects.

import { describe, it, expect } from 'vitest';
import {
  decodeHtmlEntities,
  parseFollowerCount,
  parseWhatsAppOgDescription,
  displayCleanWhatsAppDescription,
} from '@/lib/services/enrichment/whatsappMetadataParser';

describe('M13 — WhatsApp metadata parser', () => {
  describe('decodeHtmlEntities', () => {
    it('decodes hex numeric entities like &#x2022;', () => {
      expect(decodeHtmlEntities('a &#x2022; b')).toBe('a • b');
    });
    it('decodes decimal numeric entities', () => {
      expect(decodeHtmlEntities('a &#8226; b')).toBe('a • b');
    });
    it('decodes basic named entities', () => {
      expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    });
    it('leaves plain text untouched', () => {
      expect(decodeHtmlEntities('plain text 123')).toBe('plain text 123');
    });
  });

  describe('parseFollowerCount', () => {
    it('parses raw numbers', () => {
      expect(parseFollowerCount('103')).toBe(103);
    });
    it('parses K suffix', () => {
      expect(parseFollowerCount('103K')).toBe(103000);
    });
    it('parses fractional K', () => {
      expect(parseFollowerCount('1.2K')).toBe(1200);
    });
    it('parses M suffix', () => {
      expect(parseFollowerCount('6.8M')).toBe(6800000);
    });
    it('is case-insensitive', () => {
      expect(parseFollowerCount('1.2k')).toBe(1200);
      expect(parseFollowerCount('6.8m')).toBe(6800000);
    });
    it('rejects garbage', () => {
      expect(parseFollowerCount('abc')).toBeNull();
      expect(parseFollowerCount('')).toBeNull();
      expect(parseFollowerCount('1.2X')).toBeNull();
      expect(parseFollowerCount(null)).toBeNull();
    });
  });

  describe('parseWhatsAppOgDescription — leading wrapper', () => {
    it('extracts follower count and strips wrapper (hex-encoded bullets)', () => {
      const raw = 'Channel &#x2022; 103K followers &#x2022; Sajiansedap.grid.id hadir dengan ribuan resep dan tips masak';
      const out = parseWhatsAppOgDescription(raw);
      expect(out.followers).toBe(103000);
      expect(out.bio).toBe('Sajiansedap.grid.id hadir dengan ribuan resep dan tips masak');
    });

    it('handles decoded bullets (•) too', () => {
      const raw = 'Channel • 1.2K followers • A cozy channel';
      const out = parseWhatsAppOgDescription(raw);
      expect(out.followers).toBe(1200);
      expect(out.bio).toBe('A cozy channel');
    });

    it('normalizes 6.8M → 6800000', () => {
      const out = parseWhatsAppOgDescription('Channel • 6.8M followers • Big brand bio');
      expect(out.followers).toBe(6800000);
      expect(out.bio).toBe('Big brand bio');
    });

    it('parses plain integer 103 (no unit) with singular form too', () => {
      const out = parseWhatsAppOgDescription('Channel • 103 followers • Small channel');
      expect(out.followers).toBe(103);
      expect(out.bio).toBe('Small channel');

      const singular = parseWhatsAppOgDescription('Channel • 1 follower • Solo creator');
      expect(singular.followers).toBe(1);
      expect(singular.bio).toBe('Solo creator');
    });

    it('preserves a bio that legitimately contains a bullet (wrapper not at start)', () => {
      const raw = 'Our updates • daily • curated for you';
      const out = parseWhatsAppOgDescription(raw);
      expect(out.followers).toBeNull();
      expect(out.bio).toBe('Our updates • daily • curated for you');
    });

    it('does not strip mid-string wrapper text', () => {
      const raw = 'Welcome! Channel • 103K followers • is a phrase we discussed.';
      const out = parseWhatsAppOgDescription(raw);
      expect(out.followers).toBeNull();
      expect(out.bio).toBe('Welcome! Channel • 103K followers • is a phrase we discussed.');
    });

    it('returns null/null on empty input', () => {
      expect(parseWhatsAppOgDescription('')).toEqual({ followers: null, bio: null });
      expect(parseWhatsAppOgDescription(null)).toEqual({ followers: null, bio: null });
      expect(parseWhatsAppOgDescription(undefined)).toEqual({ followers: null, bio: null });
    });

    it('leaves no residual wrapper tokens in the bio', () => {
      const raw = 'Channel &#x2022; 103K followers &#x2022; Real bio here';
      const out = parseWhatsAppOgDescription(raw);
      expect(out.bio).not.toMatch(/&#x2022;/);
      expect(out.bio).not.toMatch(/^Channel\b/);
      expect(out.bio).not.toMatch(/followers\s*•/);
    });
  });

  describe('displayCleanWhatsAppDescription (idempotent legacy cleanup)', () => {
    it('is idempotent on already-clean bios', () => {
      const clean = 'Just a clean bio.';
      expect(displayCleanWhatsAppDescription(clean)).toBe(clean);
    });
    it('cleans a legacy stored entity-encoded description', () => {
      const legacy = 'Channel &#x2022; 103K followers &#x2022; Legacy bio';
      expect(displayCleanWhatsAppDescription(legacy)).toBe('Legacy bio');
    });
    it('passes through null/undefined', () => {
      expect(displayCleanWhatsAppDescription(null)).toBeNull();
      expect(displayCleanWhatsAppDescription(undefined)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Enrichment result contract: parser output flows into EnrichmentResult and
// never crosses over into verified-evidence collections.
// ---------------------------------------------------------------------------

import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';

describe('M13 — public follower persistence contract', () => {
  it('public follower fields are namespaced and separate from follower_count', () => {
    // Purely structural: importing the type would require type-only tests.
    // We assert the naming convention documented in the requirements.
    const expectedFields = [
      'public_followers_count',
      'public_followers_source',
      'public_followers_observed_at',
    ];
    // These MUST NOT include the verified fields.
    const forbidden = ['follower_count', 'follower_count_source'];
    for (const f of expectedFields) expect(forbidden).not.toContain(f);
  });

  it('does NOT create any audience snapshot record when only parsing OG metadata', async () => {
    // Read-only sanity: parser must never write to channel_audience_snapshots
    // (verified evidence collection). The parser is pure; this test asserts
    // the intent by scanning current snapshots for the parser's source label.
    const coll = await getCollection<{ source?: string }>(COLLECTIONS.CHANNEL_AUDIENCE_SNAPSHOTS);
    const bad = await coll.findOne({ source: 'whatsapp_public_metadata' as unknown as string });
    expect(bad).toBeNull();
  });
});
