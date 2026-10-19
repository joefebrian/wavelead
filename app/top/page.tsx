import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import LoadMoreChannels from '@/components/discovery/LoadMoreChannels';
import TopCountrySelector from '@/components/discovery/TopCountrySelector';
import { channelService } from '@/lib/services/channelService';
import { discoveryService } from '@/lib/services/discoveryService';
import { COUNTRIES } from '@/lib/constants/countries';
import { Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

interface SP { country?: string; page?: string; }

// SEO — Top channels page canonicalizes to /top; ?country=… variants share the
// same indexable resource. Country-specific discovery lives on /country/[slug].
export const metadata: Metadata = buildMetadata({
  title: 'Top WhatsApp Channels',
  description:
    'The highest-reach public WhatsApp Channels on WaveLead, ranked by observed follower audience across supported countries.',
  path: '/top',
});

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function TopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1);
  // Default market stays Indonesia (unchanged). `?country=all` is an ADDITIVE
  // worldwide view introduced for the new selector; every existing
  // /top?country=XX deep link keeps working exactly as before.
  const requested = (sp.country || 'ID').toUpperCase();
  const isAll = requested === 'ALL';
  const activeCountry = isAll ? null : (COUNTRIES.find((c) => c.code === requested) || COUNTRIES[0]);
  const active = isAll ? 'all' : (activeCountry as { code: string }).code;
  const scopeName = isAll ? 'Worldwide' : (activeCountry as { name: string }).name;

  // Ranked through the SAME canonical effective-follower utility as every
  // other surface (channelService -> channelRepo.listRanked). Country scoping
  // is applied in $match BEFORE ranking, and we now get a real `total` so the
  // page can paginate instead of silently truncating at the first screenful.
  const [result, countryCounts] = await Promise.all([
    channelService.listPublic({
      country: isAll ? undefined : activeCountry!.code,
      sort: 'top', limit: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE,
    }),
    discoveryService.getCountryCounts(),
  ]);
  const items = result.items;

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  {isAll ? 'Top WhatsApp Channels Worldwide' : <>Top WhatsApp Channels in {scopeName} <span aria-hidden>{activeCountry!.flag}</span></>}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Ranked by observed public audience on WaveLead.</p>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              WaveLead orders these channels by the most recent public follower observation collected for each
              channel. Verified owner-submitted evidence takes precedence when available. WaveLead does not track
              individual WhatsApp identities.
            </p>
            <TopCountrySelector countries={countryCounts} active={active} basePath="/top" homeMarket="ID" />
          </div>
        </div>
        <section className="container py-8">
          <SectionHeader
            title={isAll ? 'Top channels worldwide' : `Top channels in ${scopeName}`}
            subtitle={`${result.total.toLocaleString()} approved ${result.total === 1 ? 'channel' : 'channels'} ranked by observed audience.`}
          />
          {items.length === 0 ? (
            <EmptyState
              title="No ranking yet"
              message={isAll
                ? 'No approved channels have a public follower observation yet.'
                : `No approved channels are ranked in ${scopeName} yet.`}
              ctaHref="/channels"
              ctaLabel="Browse all channels"
            />
          ) : (
            <>
              <div className="wh-card p-2 md:p-3 divide-y divide-border/60">
                {items.map((c, i) => (
                  <ChannelCard key={c.id} channel={c} variant="ranking" rank={(page - 1) * PAGE_SIZE + i + 1} />
                ))}
              </div>
              <LoadMoreChannels
                initialCount={items.length}
                total={result.total}
                pageSize={PAGE_SIZE}
                page={page}
                query={{ country: isAll ? undefined : activeCountry!.code, sort: 'top' }}
                basePath="/top"
                variant="ranking"
                rankOffset={(page - 1) * PAGE_SIZE}
                gridClassName="wh-card p-2 md:p-3 divide-y divide-border/60"
              />
            </>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
