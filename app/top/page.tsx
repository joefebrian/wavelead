import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import { discoveryService } from '@/lib/services/discoveryService';
import { COUNTRIES } from '@/lib/constants/countries';
import { Trophy } from 'lucide-react';
import type { Metadata } from 'next';

interface SP { country?: string; }

export const metadata: Metadata = {
  title: 'Top Channels',
  description: 'Highest-reach WhatsApp Channels on WaveLead.',
  alternates: { canonical: '/top' },
};

export const dynamic = 'force-dynamic';

export default async function TopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const active = (sp.country || 'ID').toUpperCase();
  const activeCountry = COUNTRIES.find((c) => c.code === active) || COUNTRIES[0];
  const items = await discoveryService.getTop({ country: activeCountry.code, limit: 25 });

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Top Channels in {activeCountry.name} <span aria-hidden>{activeCountry.flag}</span></h1>
                <p className="text-sm text-muted-foreground mt-1">Ranked by reach on WaveLead. WaveScore ranking arrives in a later milestone.</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar">
              {COUNTRIES.map((c) => (
                <Link key={c.code} href={`/top?country=${c.code}`}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${c.code === active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:border-primary/40'}`}>
                  {c.flag} {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <section className="container py-8">
          <SectionHeader title={`Top in ${activeCountry.name}`} />
          {items.length === 0 ? (
            <EmptyState title="No ranking yet" message="No approved channels ranked in this country yet." ctaHref="/channels" />
          ) : (
            <div className="wh-card p-2 md:p-3 divide-y divide-border/60">
              {items.map((c, i) => <ChannelCard key={c.id} channel={c} variant="ranking" rank={i + 1} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
