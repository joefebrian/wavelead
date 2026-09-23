// WaveLead — SEO remediation regression coverage.
//
// Verifies:
//   • Central buildMetadata helper produces unique title/description/canonical.
//   • /login and /signup are noindex, have unique titles/descriptions and
//     canonicalize to their base path (?next=... variants collapse).
//   • Public discovery / legal / category / country / channel pages have
//     route-specific descriptions (no fallback to layout default).
//   • UTM parameters do not leak into canonical URLs.
//   • Volatile WhatsApp CDN avatar URLs are never emitted at render time; the
//     helper resolves them to null so callers render the fallback.
//   • channelMetaTitle stays within 60 characters and preserves the “| WaveLead” suffix.
//   • robots.txt disallows /login, /signup and /search.
//   • sitemap includes public canonical pages but excludes /login, /signup and API.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildMetadata, canonicalUrl, fitTitle } from '@/lib/seo/metadata';
import { resolveChannelAvatar, isVolatileAvatarHost, CHANNEL_FALLBACK_AVATAR } from '@/lib/seo/channelAvatar';
import { channelMetaTitle } from '@/lib/seo/channelTitle';

const REPO = path.resolve(__dirname, '..');

function read(p: string): string { return readFileSync(path.join(REPO, p), 'utf8'); }

describe('SEO §1 buildMetadata central helper', () => {
  it('produces canonical, title, description, robots and OG in one call', () => {
    const m = buildMetadata({ title: 'Trending WhatsApp Channels', description: 'unique desc', path: '/trending' });
    // Title is emitted as { absolute } to bypass the layout template so the
    // \" | WaveLead\" suffix is applied exactly once.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.title as any).absolute).toContain('Trending WhatsApp Channels');
    expect(m.description).toBe('unique desc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((m.alternates as any).canonical).toMatch(/\/trending$/);
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it('strips query string from canonical', () => {
    expect(canonicalUrl('/login?next=/for-brands')).toMatch(/\/login$/);
    expect(canonicalUrl('/channels?utm_source=x&utm_medium=y')).toMatch(/\/channels$/);
    expect(canonicalUrl('/')).toMatch(/\/$/);
  });

  it('fitTitle keeps titles within 60 characters and preserves suffix', () => {
    const long = 'A Really Long Channel Name That Would Otherwise Overflow The SERP Display Width';
    const fitted = fitTitle(long, ' | WaveLead', 60);
    expect(fitted.length).toBeLessThanOrEqual(60);
    expect(fitted.endsWith(' | WaveLead')).toBe(true);
  });

  it('short titles are passed through unchanged (with suffix)', () => {
    expect(fitTitle('Pricing', ' | WaveLead', 60)).toBe('Pricing | WaveLead');
  });

  it('noindex/nofollow directives round-trip through buildMetadata', () => {
    const m = buildMetadata({ title: 'X', description: 'y', path: '/z', robots: 'noindex,follow' });
    expect(m.robots).toEqual({ index: false, follow: true });
  });
});

describe('SEO §2 auth pages canonicalize and are noindex', () => {
  it('/login page exports server metadata with unique title/description and canonicalizes to /login', () => {
    const src = read('app/login/page.tsx');
    expect(src).toContain("import LoginClient from './LoginClient'");
    expect(src).toContain('generateMetadata');
    expect(src).toContain("path: '/login'");
    expect(src).toMatch(/robots:\s*'noindex,follow'/);
    expect(src).toContain('Sign in to WaveLead');
    // The page.tsx must NOT itself be marked "use client" (that would break
    // the exported metadata invariant).
    expect(src).not.toMatch(/^'use client';/m);
  });

  it('/signup page exports server metadata with unique title/description and canonicalizes to /signup', () => {
    const src = read('app/signup/page.tsx');
    expect(src).toContain("import SignupClient from './SignupClient'");
    expect(src).toContain("path: '/signup'");
    expect(src).toMatch(/robots:\s*'noindex,follow'/);
    expect(src).toContain('Create Your WaveLead Account');
    expect(src).not.toMatch(/^'use client';/m);
  });

  it('login/signup client shells keep their form logic', () => {
    const login = read('app/login/LoginClient.tsx');
    const signup = read('app/signup/SignupClient.tsx');
    expect(login).toMatch(/^'use client';/);
    expect(signup).toMatch(/^'use client';/);
    expect(login).toContain('fetch(\'/api/auth/login\'');
    expect(signup).toContain('fetch(\'/api/auth/signup\'');
  });
});

describe('SEO §3 public pages have route-specific metadata (no default fallback)', () => {
  const pages: Array<[string, string, string]> = [
    ['app/channels/page.tsx',  'Discover WhatsApp Channels',        '/channels'],
    ['app/trending/page.tsx',  'Trending WhatsApp Channels',        '/trending'],
    ['app/top/page.tsx',       'Top WhatsApp Channels',             '/top'],
    ['app/categories/page.tsx','WhatsApp Channel Categories',       '/categories'],
    ['app/countries/page.tsx', 'WhatsApp Channels by Country',      '/countries'],
    ['app/for-brands/page.tsx','WhatsApp Channel Marketing for Brands', '/for-brands'],
    ['app/pricing/page.tsx',   'Pricing',                           '/pricing'],
    ['app/refund-policy/page.tsx', 'Refund Policy',                 '/refund-policy'],
    ['app/terms/page.tsx',     'Terms of Service',                  '/terms'],
    ['app/privacy/page.tsx',   'Privacy Policy',                    '/privacy'],
    ['app/cookies/page.tsx',   'Cookie Policy',                     '/cookies'],
    ['app/faq/page.tsx',       'WaveLead FAQ',                      '/faq'],
    ['app/about/page.tsx',     'About WaveLead',                    '/about'],
    ['app/contact/page.tsx',   'Contact WaveLead',                  '/contact'],
    ['app/submit/page.tsx',    'Submit a WhatsApp Channel',         '/submit'],
  ];
  for (const [file, expectedTitle, expectedPath] of pages) {
    it(`${file} → title "${expectedTitle}" and canonical ${expectedPath}`, () => {
      const src = read(file);
      expect(src).toContain('buildMetadata');
      expect(src).toContain(`title: '${expectedTitle}'`);
      expect(src).toContain(`path: '${expectedPath}'`);
    });
  }

  it('every public page above declares a unique description', () => {
    const descs = new Set<string>();
    for (const file of pages.map((p) => p[0])) {
      const src = read(file);
      const m = src.match(/description:\s*\n?\s*'([^']+)'/) || src.match(/description:\s*"([^"]+)"/);
      expect(m, `expected description in ${file}`).toBeTruthy();
      const desc = (m![1] || '').trim();
      expect(desc.length).toBeGreaterThan(30);
      expect(descs.has(desc), `duplicate description in ${file}`).toBe(false);
      descs.add(desc);
    }
  });
});

describe('SEO §4 dynamic pages produce route-specific metadata', () => {
  it('category [slug] uses the category name in title and description', () => {
    const src = read('app/category/[slug]/page.tsx');
    expect(src).toContain('generateMetadata');
    expect(src).toContain('`${cat.name} WhatsApp Channels`');
    expect(src).toContain('${cat.name}');
    expect(src).toContain("path: `/category/${cat.slug}`");
  });
  it('country [slug] uses the country name in title and description', () => {
    const src = read('app/country/[slug]/page.tsx');
    expect(src).toContain('WhatsApp Channels in ${c.name}');
    expect(src).toContain('${c.name}');
  });
  it('channel [slug] uses channelMetaTitle and returns a channel-specific description', () => {
    const src = read('app/channel/[slug]/page.tsx');
    expect(src).toContain('channelMetaTitle(c.name)');
    // Title uses safe helper; description must reference the channel name.
    expect(src).toContain('Explore ${c.name} on WaveLead');
  });
});

describe('SEO §5 volatile WhatsApp CDN avatars are never rendered', () => {
  const cases = [
    'https://pps.whatsapp.net/v/t61.24694-24/abc123',
    'https://media-abc.fna.whatsapp.net/foo.jpg',
    'https://static.whatsapp.net/bar.png',
    'https://cdn.whatsapp.com/x/y/z',
    'https://scontent-abc.xx.fbcdn.net/whatsapp.jpg',
  ];
  for (const url of cases) {
    it(`suppresses ${new URL(url).hostname}`, () => {
      expect(resolveChannelAvatar(url)).toBeNull();
      expect(isVolatileAvatarHost(new URL(url).hostname)).toBe(true);
    });
  }
  it('passes through stable HTTPS URLs unchanged', () => {
    const stable = 'https://cdn.wavelead.org/avatars/abc.png';
    expect(resolveChannelAvatar(stable)).toBe(stable);
  });
  it('rejects non-http(s) inputs (data:, javascript:, malformed)', () => {
    expect(resolveChannelAvatar('data:image/png;base64,xxx')).toBeNull();
    expect(resolveChannelAvatar('javascript:alert(1)')).toBeNull();
    expect(resolveChannelAvatar('not-a-url')).toBeNull();
    expect(resolveChannelAvatar('')).toBeNull();
    expect(resolveChannelAvatar(null)).toBeNull();
    expect(resolveChannelAvatar(undefined)).toBeNull();
  });
  it('exposes a stable local fallback path (used when caller wants to prefer an <img>)', () => {
    expect(CHANNEL_FALLBACK_AVATAR).toBe('/brand/channel-fallback.svg');
  });
  it('ChannelCard and channel/[slug] and SponsoredCard all use resolveChannelAvatar', () => {
    expect(read('components/discovery/ChannelCard.tsx')).toContain('resolveChannelAvatar(channel.logo_url)');
    expect(read('app/channel/[slug]/page.tsx')).toContain('resolveChannelAvatar(channel.logo_url)');
    expect(read('components/promo/SponsoredCard.tsx')).toContain('resolveChannelAvatar(ch.logo_url)');
  });
});

describe('SEO §6 channelMetaTitle keeps titles within SERP width', () => {
  it('short names fit "{name} | WaveLead" without truncation', () => {
    expect(channelMetaTitle('Kompas.com')).toBe('Kompas.com | WaveLead');
  });
  it('long names shorten only the name segment', () => {
    const t = channelMetaTitle('Extremely Lengthy Channel Name That Exceeds Sixty Characters Easily');
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith(' | WaveLead')).toBe(true);
  });
});

describe('SEO §7 robots.txt & sitemap invariants', () => {
  it('robots.txt disallows auth surfaces and internal APIs', () => {
    const src = read('app/robots.txt/route.ts');
    expect(src).toContain('Disallow: /login');
    expect(src).toContain('Disallow: /signup');
    expect(src).toContain('Disallow: /search');
    expect(src).toContain('Disallow: /admin');
    expect(src).toContain('Disallow: /api');
    expect(src).toContain('Sitemap:');
  });
  it('sitemap only enumerates public canonical routes and excludes /login and /signup', () => {
    const src = read('app/sitemap.ts');
    expect(src).not.toContain("'/login'");
    expect(src).not.toContain("'/signup'");
    expect(src).not.toContain("'/dashboard'");
    expect(src).not.toContain("'/admin'");
    expect(src).not.toContain("'/api");
    expect(src).toContain("'/channels'");
    expect(src).toContain("'/trending'");
    expect(src).toContain("'/categories'");
    // Sitemap emits approved public channels only, not pending/rejected.
    expect(src).toContain("status: 'approved'");
  });
});

describe('SEO §8 controlled avatar repair script is safe', () => {
  it('refuses NODE_ENV=production without explicit confirmation env', () => {
    const src = read('scripts/repair_broken_avatars.mjs');
    expect(src).toContain('CONFIRM_PRODUCTION_REPAIR');
    expect(src).toContain('process.exit(2)');
    // Only mutates logo_url (never touches ownership, financial state, etc.)
    expect(src).toContain("$set: { logo_url: null");
    // Never assigns a non-null URL string to logo_url in this repair script.
    expect(src).not.toMatch(/\$set:\s*\{\s*logo_url:\s*['"`]/);
  });
});
