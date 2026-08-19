import { channelService } from '@/lib/services/channelService';
import { discoveryService } from '@/lib/services/discoveryService';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import SponsoredCard from '@/components/promo/SponsoredCard';
import { loadOneSponsored, shouldRenderSponsored } from '@/lib/services/promotion/deliveryHelpers';
import type { Metadata } from 'next';

interface SP { q?: string; category?: string; country?: string; sort?: string; }

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const title = sp.q ? `"${sp.q}" — Search WhatsApp Channels` : 'Search Channels';
  return { title };
}

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q || '').trim();
  const category = sp.category;
  const country = sp.country?.toUpperCase();
  const sort = (sp.sort as 'newest' | 'top' | 'trending' | undefined) || 'top';

  const [result, cats] = await Promise.all([
    channelService.listPublic({ q, category, country, sort, limit: 30 }),
    discoveryService.getCategoryCounts().then((rows) => rows.slice(0, 12)),
  ]);
  // Sponsored search — only when there's a query. Site-wide Trending / Top
  // pages have their own routes and never call this branch.
  const sponsored = (q && sort !== 'trending')
    ? await loadOneSponsored({ placement: 'sponsored_search', search_query: q, category_slug: category || null, country_code: country || null })
    : [];

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Search</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">
              {q ? <>Results for &ldquo;<span className="text-primary">{q}</span>&rdquo;</> : 'Search WhatsApp Channels'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {result.total} {result.total === 1 ? 'channel' : 'channels'} found.
            </p>
          </div>
        </div>
        <CategoryPills categories={cats} active={category} />

        <section className="container py-8">
          <SectionHeader
            title={q ? 'Search results' : 'All approved channels'}
            subtitle={country ? `Filtered by country: ${country}` : undefined}
          />
          {result.items.length === 0 ? (
            <EmptyState title="No channels match your search" message="Try a broader keyword, or explore all channels." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sponsored[0] && shouldRenderSponsored(result.items.length) && <SponsoredCard data={sponsored[0]} sourcePath="/search" />}
              {result.items.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
