import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import { discoveryService } from '@/lib/services/discoveryService';
import { TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trending',
  description: 'Channels getting attention on WaveLead right now.',
  alternates: { canonical: '/trending' },
};

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
                <h1 className="text-2xl md:text-3xl font-bold">Trending on WaveLead</h1>
                <p className="text-sm text-muted-foreground mt-1">Popular right now. Real-time follow-intent ranking arrives in a later milestone.</p>
              </div>
            </div>
          </div>
        </div>
        <section className="container py-8">
          <SectionHeader title="Popular on WaveLead" subtitle="Featured and highest reach." />
          {popular.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {popular.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
        <section className="container py-8">
          <SectionHeader title="New & Noteworthy" subtitle="Recently added channels." />
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
