import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import HeroSearch from '@/components/discovery/HeroSearch';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import ChannelCard from '@/components/discovery/ChannelCard';
import EmptyState from '@/components/discovery/EmptyState';
import OwnerGrowthCta from '@/components/discovery/OwnerGrowthCta';
import { discoveryService, type CategoryWithCount, type CountryWithCount } from '@/lib/services/discoveryService';
import { COLLECTIONS as _NS } from '@/lib/db/collections';
import { COLLECTIONS as EDITORIAL_COLLECTIONS } from '@/lib/constants/discovery-collections';
import type { PublicChannel } from '@/lib/types';
import Link from 'next/link';
import type { Metadata } from 'next';

void _NS;

export const metadata: Metadata = {
  title: 'Discover WhatsApp Channels | WaveLead',
  description: 'Explore WhatsApp Channels for news, creators, sports, finance, entertainment, communities, deals and more on WaveLead.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Discover WhatsApp Channels | WaveLead',
    description: 'Explore WhatsApp Channels for news, creators, sports, finance, entertainment, communities, deals and more on WaveLead.',
    type: 'website',
  },
};

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const bundle = await discoveryService.getHomepageBundle();
  const topCategories: CategoryWithCount[] = bundle.categories
    .slice()
    .sort((a, b) => b.channel_count - a.channel_count)
    .slice(0, 10);
  const pillCats = bundle.categories.slice(0, 10);
  const countries: CountryWithCount[] = bundle.countries;

  return (
    <>
      <Header />
      <main>
        <HeroSearch totalApproved={bundle.stats.totalApproved} />
        <CategoryPills categories={pillCats} />

        {/* Popular on WaveLead */}
        <section className="container py-10">
          <SectionHeader
            title="Popular on WaveLead"
            subtitle="Channels getting attention right now."
            href="/trending"
          />
          {bundle.popular.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bundle.popular.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>

        {/* New & Noteworthy */}
        <section className="container py-8">
          <SectionHeader
            title="New & Noteworthy"
            subtitle="Fresh channels worth checking out."
            href="/channels?sort=newest"
          />
          {bundle.rising.length === 0 ? <EmptyState /> : (
            <div className="flex md:grid gap-4 md:grid-cols-2 lg:grid-cols-3 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none">
              {bundle.rising.map((c) => (
                <div key={c.id} className="snap-start shrink-0 w-[78%] sm:w-[55%] md:w-auto">
                  <ChannelCard channel={c} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top in Indonesia */}
        <section className="container py-10">
          <SectionHeader
            title="Top Channels in Indonesia"
            subtitle="Ranked by follower reach on WaveLead."
            href="/top"
            cta="View Top Channels"
            right={<span className="hidden md:inline-flex text-xs text-muted-foreground border border-border rounded-full px-3 py-1">🇮🇩 Indonesia</span>}
          />
          {bundle.topIndonesia.length === 0 ? <EmptyState /> : (
            <div className="wh-card p-2 md:p-3 divide-y divide-border/60">
              {bundle.topIndonesia.map((c: PublicChannel, i: number) => (
                <ChannelCard key={c.id} channel={c} variant="ranking" rank={i + 1} />
              ))}
            </div>
          )}
        </section>

        {/* Browse by category */}
        <section className="container py-10">
          <SectionHeader
            title="Browse by category"
            subtitle="Explore what people follow on WaveLead."
            href="/channels"
            cta="View all categories"
          />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {topCategories.map((cat) => (
              <Link key={cat.id} href={`/category/${cat.slug}`} className="wh-card p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 grid place-items-center rounded-lg bg-primary/10 text-primary text-lg font-bold">{cat.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{cat.name}</div>
                    <div className="text-xs text-muted-foreground">{cat.channel_count} {cat.channel_count === 1 ? 'channel' : 'channels'}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Discover by country */}
        <section className="container py-10">
          <SectionHeader
            title="Discover by country"
            subtitle="See what’s popular near you — or far from you."
          />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {countries.map((c) => (
              <Link key={c.code} href={`/country/${c.slug}`} className="wh-card p-4 flex items-center gap-3">
                <span className="text-2xl" aria-hidden>{c.flag}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.channel_count > 0 ? `${c.channel_count} ${c.channel_count === 1 ? 'channel' : 'channels'}` : 'Coming soon'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Explore interests */}
        <section className="container py-10">
          <SectionHeader
            title="Explore interests"
            subtitle="Editorial picks across popular themes."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EDITORIAL_COLLECTIONS.map((col) => (
              <Link key={col.title} href={col.href} className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${col.gradient} p-5 text-white min-h-[130px] flex flex-col justify-end`}>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                <div className="relative">
                  <div className="font-semibold text-lg leading-tight">{col.title}</div>
                  <div className="text-sm text-white/80 mt-1">{col.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <OwnerGrowthCta />
      </main>
      <Footer />
    </>
  );
}
