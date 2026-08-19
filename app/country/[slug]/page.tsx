import { notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import SponsoredCard from '@/components/promo/SponsoredCard';
import { loadOneSponsored, shouldRenderSponsored } from '@/lib/services/promotion/deliveryHelpers';
import { channelService } from '@/lib/services/channelService';
import { countryBySlug } from '@/lib/constants/countries';
import type { Metadata } from 'next';

interface Params { slug: string; }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const c = countryBySlug(slug);
  if (!c) return { title: 'Country not found' };
  return { title: `${c.name} channels`, alternates: { canonical: `/country/${c.slug}` } };
}

export const dynamic = 'force-dynamic';

export default async function CountryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const country = countryBySlug(slug);
  if (!country) notFound();
  const result = await channelService.listPublic({ country: country.code, sort: 'top', limit: 30 });
  const sponsored = await loadOneSponsored({ placement: 'sponsored_country', country_code: country.code });

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Country</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold flex items-center gap-3">
              <span aria-hidden className="text-3xl">{country.flag}</span> {country.name} channels
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{result.total} channels approved on WaveLead.</p>
          </div>
        </div>

        <section className="container py-8">
          <SectionHeader title={`Top channels in ${country.name}`} subtitle="Ranked by reach." />
          {result.items.length === 0 ? (
            <EmptyState title="No channels here yet" message="Be the first to submit a channel from this country." ctaHref="/submit" ctaLabel="Submit a Channel" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sponsored[0] && shouldRenderSponsored(result.items.length) && <SponsoredCard data={sponsored[0]} sourcePath={`/country/${slug}`} />}
              {result.items.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
