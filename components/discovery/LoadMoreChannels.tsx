'use client';

// WaveLead — shared "Load More" control for public channel listings.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// /channels, /category/[slug], /country/[slug], /search and /top each rendered
// a hardcoded first page of 30 results with NO way to reach the rest, even
// though the heading honestly reported the real total (e.g. "149 approved
// channels"). The service layer already supported limit/skip and returned the
// total — the UI simply never exposed it.
//
// ---------------------------------------------------------------------------
// DESIGN — progressive enhancement, not a parallel system
// ---------------------------------------------------------------------------
// The control is a real <a href="?page=N"> that the server can render.
//   • No JS / crawler  → it is an ordinary, crawlable pagination link and the
//     server renders that page. SEO discoverability is preserved and existing
//     canonical URLs are untouched.
//   • With JS          → the click is intercepted, the next page is fetched
//     from the existing public API and appended in place. No full-page reload.
//
// The server still renders page 1 (or the requested ?page=N) itself, so the
// first screenful is always server-rendered HTML.
//
// Pagination happens at the QUERY level (limit/skip) — we never load thousands
// of hidden cards. Ordering is deterministic (the ranking sorts end in the
// unique `id`), so appended pages can neither duplicate nor skip a record.
import * as React from 'react';
import { Loader2, ChevronDown, AlertCircle } from 'lucide-react';
import ChannelCard, { type ChannelCardVariant } from './ChannelCard';
import type { PublicChannel } from '@/lib/types';

export interface LoadMoreQuery {
  category?: string;
  country?: string;
  q?: string;
  sort?: string;
}

interface Props {
  /** Server-rendered first batch — counted, but rendered by the parent. */
  initialCount: number;
  /** Total eligible public records matching the current filters. */
  total: number;
  pageSize: number;
  /** 1-based page the server rendered. */
  page: number;
  /** Filters to replay against the public API for subsequent pages. */
  query?: LoadMoreQuery;
  /**
   * Params to put on the crawlable ?page= link. Defaults to `query`, but
   * pages whose path already encodes a filter (e.g. /category/news) pass `{}`
   * so the link stays clean: /category/news?page=2 rather than
   * /category/news?category=news&sort=top&page=2.
   */
  hrefQuery?: LoadMoreQuery;
  /** Base path used to build the crawlable ?page= link. */
  basePath: string;
  variant?: ChannelCardVariant;
  /** Rank numbering offset for the `ranking` variant. */
  rankOffset?: number;
  /** Tailwind classes for the appended grid; must match the parent grid. */
  gridClassName?: string;
  /** Singular/plural noun used in the progress label. */
  noun?: string;
}

export default function LoadMoreChannels({
  initialCount,
  total,
  pageSize,
  page,
  query = {},
  hrefQuery,
  basePath,
  variant = 'standard',
  rankOffset = 0,
  gridClassName = 'grid gap-4 md:grid-cols-2 lg:grid-cols-3',
  noun = 'channels',
}: Props) {
  const [extra, setExtra] = React.useState<PublicChannel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Number of pages already materialised (server page + appended pages).
  const [pagesLoaded, setPagesLoaded] = React.useState(page);

  const shown = initialCount + extra.length;
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIndex = (page - 1) * pageSize + shown;
  const allShown = lastIndex >= total;
  const nextPage = pagesLoaded + 1;
  const nextHref = buildHref(basePath, hrefQuery ?? query, nextPage);

  async function loadNext(e: React.MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab, etc.) behave like a normal link.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (loading || allShown) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('skip', String(pagesLoaded * pageSize));
      if (query.sort) params.set('sort', query.sort);
      if (query.category) params.set('category', query.category);
      if (query.country) params.set('country', query.country);
      if (query.q) params.set('q', query.q);

      const res = await fetch(`/api/channels?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      const items = (json?.data?.items as PublicChannel[]) || [];
      // Defensive de-duplication: the ordering is deterministic, but never let
      // a transient repeat render two cards with the same React key.
      setExtra((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...items.filter((i) => !seen.has(i.id))];
      });
      setPagesLoaded((p) => p + 1);
    } catch {
      setError('Could not load more channels. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {extra.length > 0 && (
        <div className={`${gridClassName} mt-4`} data-testid="loadmore-appended">
          {extra.map((c, i) => (
            <ChannelCard
              key={c.id}
              channel={c}
              variant={variant}
              rank={variant === 'ranking' ? rankOffset + initialCount + i + 1 : undefined}
            />
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="loadmore-progress">
          {total === 0
            ? `No ${noun} to show`
            : allShown
              ? shown === total && page === 1
                ? `All ${total.toLocaleString()} ${noun} displayed`
                : `Showing ${firstIndex.toLocaleString()}–${lastIndex.toLocaleString()} of ${total.toLocaleString()} — end of results`
              : `Showing ${firstIndex.toLocaleString()}–${lastIndex.toLocaleString()} of ${total.toLocaleString()}`}
        </p>

        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {!allShown && (
          <a
            href={nextHref}
            rel="next"
            onClick={loadNext}
            aria-busy={loading}
            aria-disabled={loading}
            data-testid="loadmore-button"
            className={`inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold transition-colors ${
              loading ? 'pointer-events-none opacity-60' : 'hover:border-primary/40 hover:text-primary'
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading…
              </>
            ) : (
              <>
                {error ? 'Retry' : `Load more ${noun}`}
                <ChevronDown className="h-4 w-4" aria-hidden />
              </>
            )}
          </a>
        )}
      </div>
    </>
  );
}

function buildHref(basePath: string, query: LoadMoreQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.country) params.set('country', query.country);
  if (query.sort) params.set('sort', query.sort);
  params.set('page', String(page));
  return `${basePath}?${params.toString()}`;
}
