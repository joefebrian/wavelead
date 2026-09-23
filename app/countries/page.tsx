import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import SectionHeader from '@/components/discovery/SectionHeader';
import { discoveryService } from '@/lib/services/discoveryService';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'WhatsApp Channels by Country',
  description:
    'Explore public WhatsApp Channels by country on WaveLead. Discover creators and communities across supported markets, with real audience information where available.',
  path: '/countries',
});
export const dynamic = 'force-dynamic';

export default async function CountriesPage() {
  const countries = await discoveryService.getCountryCounts();
  const withChannels = countries.filter((c) => c.channel_count > 0).sort((a, b) => b.channel_count - a.channel_count);
  const withoutChannels = countries.filter((c) => c.channel_count === 0).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Countries</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">Explore WhatsApp Channels by country</h1>
            <p className="text-sm text-muted-foreground mt-1">{withChannels.length} countries with active WaveLead listings.</p>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              Discover public WhatsApp Channels in specific countries. Every listing is reviewed before it goes
              live. Reach numbers come from real public observations on WhatsApp and, where available, verified
              owner evidence.
            </p>
          </div>
        </div>

        <section className="container py-8">
          <SectionHeader title="Countries with channels" />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {withChannels.map((c) => (
              <Link key={c.code} href={`/country/${c.slug}`} className="wh-card p-4" data-testid={`country-card-${c.slug}`}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 grid place-items-center rounded-lg bg-primary/10 text-2xl">{c.flag}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.channel_count} {c.channel_count === 1 ? 'channel' : 'channels'}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {withoutChannels.length > 0 && (
          <section className="container py-8 border-t border-border/60">
            <SectionHeader title="Other supported countries" subtitle="No channels listed yet — be the first from your country." />
            <div className="flex flex-wrap gap-2">
              {withoutChannels.map((c) => (
                <span key={c.code} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
                  <span aria-hidden>{c.flag}</span>{c.name}
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
