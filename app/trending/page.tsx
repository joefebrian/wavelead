import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import { discoveryService } from '@/lib/services/discoveryService';
import { TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO — Trending has route-specific description reflecting WaveLead's data model.
// WaveLead is still building continuous follower history; today the page surfaces
// most-followed and recently-added channels based on real public observations.
export const metadata: Metadata = buildMetadata({
  title: 'Trending WhatsApp Channels',
  description:
    'Explore trending WhatsApp Channels on WaveLead using real public follower observations, categories and countries. Continuous growth history is still being collected.',
  path: '/trending',
});

export const dynamic = 'force-dynamic';

export default async function TrendingPage() {
  const [popular, rising] = await Promise.all([
    discoveryService.getPopular(12),
    discoveryService.getRising(12),
  ]);

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary"><TrendingUp className="h-5 w-5" /></span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Trending WhatsApp Channels</h1>
                <p className="text-sm text-muted-foreground mt-1">Most-followed and recently-added public channels on WaveLead.</p>
              </div>
            </div>
            {/* SEO — server-rendered explanation of what "trending" means on WaveLead. */}
            <div className="mt-5 max-w-3xl text-sm text-muted-foreground space-y-2">
              <p>
                WaveLead ranks &ldquo;trending&rdquo; from real public follower observations captured on WhatsApp,
                combined with the newest approved listings. We only report follower growth when we have enough
                observations to compare against a prior point in time.
              </p>
              <p>
                Until continuous growth history is collected for a channel, this page falls back to a
                <em> most-followed</em> view based on the latest observed public audience size. It never fabricates
                trend statistics.
              </p>
            </div>
          </div>
        </div>
        <section className="container py-8">
          <SectionHeader title="Popular on WaveLead" subtitle="Highest observed reach across approved channels." />
          {popular.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {popular.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
        <section className="container py-8">
          <SectionHeader title="New & noteworthy" subtitle="Recently added and approved public channels." />
          {rising.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {rising.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
