import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import { channelService } from '@/lib/services/channelService';
import { discoveryService } from '@/lib/services/discoveryService';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

interface SP { sort?: string; }

// SEO — unique title/description + explicit canonical (strips any ?sort=... query).
export const metadata: Metadata = buildMetadata({
  title: 'Discover WhatsApp Channels',
  description:
    'Discover public WhatsApp Channels across categories and countries on WaveLead. Compare audience size, creator profiles, rate cards and sponsorship opportunities.',
  path: '/channels',
});

export const dynamic = 'force-dynamic';

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort = (sp.sort as 'newest' | 'top' | 'trending' | undefined) || 'top';
  const [result, cats] = await Promise.all([
    channelService.listPublic({ sort, limit: 30 }),
    discoveryService.getCategoryCounts().then((rows) => rows.slice(0, 14)),
  ]);

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Discover</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">All approved WhatsApp Channels</h1>
            <p className="text-sm text-muted-foreground mt-1">{result.total} channels across {cats.length}+ categories.</p>
            {/* SEO — server-rendered explanatory copy (no keyword filler). */}
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              Browse every public WhatsApp Channel approved on WaveLead. Filter by category and country, compare
              reach and creator profiles, and open sponsorship or growth conversations directly with the channel
              owner. Every listing is reviewed before it goes live.
            </p>
          </div>
        </div>
        <CategoryPills categories={cats} />
        <section className="container py-8">
          <SectionHeader
            title="Latest & greatest"
            subtitle={sort === 'newest' ? 'Sorted by newest.' : 'Sorted by reach.'}
          />
          {result.items.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {result.items.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
