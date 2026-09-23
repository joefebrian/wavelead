/**
 * WaveLead — Central SEO metadata helper.
 *
 * Every PUBLIC INDEXABLE page must go through `buildMetadata(...)` so that:
 *   - title is unique and reasonably short
 *   - description is unique and describes THIS page (never a generic default)
 *   - canonical URL is explicit (query strings and UTM params are dropped)
 *   - robots directives are explicit (noindex is opt-in, not accidental)
 *   - Open Graph inherits the layout base image unless overridden
 *
 * Non-indexable auth / private pages should call `buildMetadata` with
 * `robots: 'noindex,follow'`. They still get a unique title / description so
 * they don't collide with each other or with the layout defaults.
 */
import type { Metadata } from 'next';

export const SITE_NAME = 'WaveLead';

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Absolute canonical URL for a path. Query string is intentionally dropped. */
export function canonicalUrl(pathname: string): string {
  const base = siteOrigin();
  // strip query/hash and normalize leading slash
  const cleanPath = pathname.split('?')[0].split('#')[0];
  const p = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  // Home path canonicalizes to base (no trailing slash + '/')
  if (p === '/') return `${base}/`;
  return `${base}${p.replace(/\/+$/, '')}`;
}

/**
 * Return a title that fits SERP display width (target ~60 chars).
 * We keep the WaveLead suffix intact and shorten the leading name if needed.
 * Never truncates mid-word: falls back to hard clip with an ellipsis only
 * when even a one-word title would overflow (should be extremely rare).
 */
export function fitTitle(rawTitle: string, suffix = ` | ${SITE_NAME}`, maxLen = 60): string {
  const base = rawTitle.trim();
  const full = `${base}${suffix}`;
  if (full.length <= maxLen) return full;
  const room = maxLen - suffix.length;
  if (room <= 4) return `${base.slice(0, maxLen - 1)}…`;
  const words = base.split(/\s+/);
  let out = '';
  for (const w of words) {
    if ((out ? out.length + 1 : 0) + w.length > room) break;
    out = out ? `${out} ${w}` : w;
  }
  if (!out) out = base.slice(0, room - 1) + '…';
  return `${out.trimEnd()}${suffix}`;
}

interface BuildMetadataInput {
  /** Page title WITHOUT the " | WaveLead" suffix. */
  title: string;
  description: string;
  /** Canonical pathname for this page (query is stripped). Required. */
  path: string;
  /** Set to 'noindex' or 'noindex,follow' to keep the page out of the index. */
  robots?: 'index,follow' | 'noindex,follow' | 'noindex,nofollow';
  /** Optional OG image override. Defaults to the layout brand image. */
  ogImage?: string;
  /** If false, suffix " | WaveLead" is omitted (used when title already contains WaveLead). */
  appendSuffix?: boolean;
}

/** Canonical entry point for every page's metadata export. */
export function buildMetadata(input: BuildMetadataInput): Metadata {
  const { title, description, path, robots = 'index,follow', ogImage, appendSuffix = true } = input;
  const suffix = appendSuffix && !/wavelead/i.test(title) ? ` | ${SITE_NAME}` : '';
  const fitted = fitTitle(title, suffix, 60);
  const canonical = canonicalUrl(path);
  const [indexTok, followTok] = robots.split(',').map((s) => s.trim());
  return {
    // `absolute` bypasses the layout template `%s · WaveLead`, so we never
    // produce a doubled suffix like "Title | WaveLead · WaveLead".
    title: { absolute: fitted },
    description,
    alternates: { canonical },
    robots: {
      index: indexTok === 'index',
      follow: followTok !== 'nofollow',
    },
    openGraph: {
      title: fitted,
      description,
      type: 'website',
      siteName: SITE_NAME,
      url: canonical,
      images: [{ url: ogImage || '/brand/wavelead-logo.png', width: 2172, height: 724, alt: SITE_NAME }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fitted,
      description,
      images: [ogImage || '/brand/wavelead-logo.png'],
    },
  };
}
