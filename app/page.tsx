import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import PositioningHero from '@/components/home/PositioningHero';
import { PersonaEntry, ProductLoop, OwnerValue, BrandValue, TrustSection, PricingTeaser, FinalCta } from '@/components/home/LaunchSections';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import ChannelCard from '@/components/discovery/ChannelCard';
import EmptyState from '@/components/discovery/EmptyState';
import SponsoredCard from '@/components/promo/SponsoredCard';
import OwnerGrowthCta from '@/components/discovery/OwnerGrowthCta';
import TopChannelsCountryPicker from '@/components/discovery/TopChannelsCountryPicker';
import { discoveryService, type CategoryWithCount, type CountryWithCount } from '@/lib/services/discoveryService';
import { categoryVisual } from '@/lib/constants/categoryIcons';
import { COLLECTIONS as _NS } from '@/lib/db/collections';
import { COLLECTIONS as EDITORIAL_COLLECTIONS } from '@/lib/constants/discovery-collections';
import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

void _NS;

export const metadata: Metadata = buildMetadata({
  title: 'WaveLead — Growth for WhatsApp Channels',
  description:
    'Discover, grow and monetize public WhatsApp Channels with WaveLead. Connect channel owners and brands through sponsorships, campaigns and honest performance insights.',
  path: '/',
});

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const bundle = await discoveryService.getHomepageBundle();
  // M11-Batch5 — Homepage pricing teaser reads the same admin-configurable
  // pricing config as /pricing (no hardcoded amounts anywhere).
  const { pricingConfigService } = await import('@/lib/services/pricingConfigService');
  const pricing = await pricingConfigService.getPublicPricing();
  // M05.1: fetch a sponsored homepage candidate. Kept separate from organic.
  const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
  const sponsored = await promotionDeliveryService.selectCandidates({
    placement: 'sponsored_homepage', anonymous_session_id: null, country_code: null,
  }, 1).catch(() => []);
  const topCategories: CategoryWithCount[] = bundle.categories
    .slice()
    .sort((a, b) => b.channel_count - a.channel_count)
    .slice(0, 10);
  const pillCats = bundle.categories.slice(0, 10);
  // M18.1 Phase B — homepage shows a COMPACT set only: countries that actually
  // have at least one approved public channel, ranked by that count, capped at
  // 12. The canonical country dataset, /country/<slug> URLs and the full
  // /countries directory are untouched.
  const HOMEPAGE_COUNTRY_LIMIT = 12;
  const activeCountries: CountryWithCount[] = bundle.countries.filter((c) => c.channel_count > 0);
  const countries: CountryWithCount[] = activeCountries
    .slice()
    .sort((a, b) => b.channel_count - a.channel_count || a.name.localeCompare(b.name))
    .slice(0, HOMEPAGE_COUNTRY_LIMIT);
  const hasMoreCountries = activeCountries.length > countries.length || bundle.countries.length > countries.length;

  return (
    <>
      <Header />
      <main>
        <PositioningHero totalApproved={bundle.stats.totalApproved} />
        <PersonaEntry />
        <ProductLoop />
        <CategoryPills categories={pillCats} />

        {/* Discover WhatsApp Channels — reuses existing public discovery data */}
        <section className="container py-10" data-testid="home-discovery-proof">
          <SectionHeader
            title="Discover WhatsApp Channels"
            subtitle="Channels getting attention right now."
            href="/trending"
          />
          {bundle.popular.length === 0 ? <EmptyState /> : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sponsored[0] && <SponsoredCard data={sponsored[0]} sourcePath="/" />}
              {bundle.popular.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
          <div className="mt-6">
            <Link href="/channels" className="text-sm text-primary hover:underline">Explore All Channels →</Link>
          </div>
        </section>

        <OwnerValue />
        <BrandValue />

        {/* Featured — only rendered when moderators have curated at least one slot */}
        {bundle.featured.length > 0 && (
          <section className="container py-8">
            <SectionHeader
              title="Featured"
              subtitle="Editorial picks by the WaveLead team."
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bundle.featured.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          </section>
        )}

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

        {/* Top by country */}
        <TopChannelsCountryPicker
          initial={bundle.topIndonesia}
          initialCountry={{ code: 'ID', slug: 'indonesia', name: 'Indonesia', flag: '🇮🇩' }}
          countries={countries.map((c) => ({ code: c.code, slug: c.slug, name: c.name, flag: c.flag }))}
          limit={5}
        />

        <TrustSection />

        {/* Browse by category */}
        <section className="container py-10">
          <SectionHeader
            title="Browse by category"
            subtitle="Explore what people follow on WaveLead."
            href="/channels"
            cta="View all categories"
          />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {topCategories.map((cat) => {
              const { icon: Icon, accent } = categoryVisual(cat.slug, cat.name);
              return (
                <Link key={cat.id} href={`/category/${cat.slug}`} className="wh-card group p-4 transition-colors hover:border-primary/40" data-testid={`home-category-card-${cat.slug}`}>
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 shrink-0 grid place-items-center rounded-lg ${accent} transition-transform group-hover:scale-105`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate group-hover:text-primary">{cat.name}</div>
                      <div className="text-xs text-muted-foreground">{cat.channel_count} {cat.channel_count === 1 ? 'channel' : 'channels'}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Discover by country */}
        <section className="container py-10">
          <SectionHeader
            title="Discover by country"
            subtitle="See what’s popular near you — or far from you."
          />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="home-country-grid">
            {countries.map((c) => (
              <Link key={c.code} href={`/country/${c.slug}`} className="wh-card p-4 flex items-center gap-3">
                <span className="text-2xl" aria-hidden>{c.flag}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.channel_count} {c.channel_count === 1 ? 'channel' : 'channels'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {countries.length === 0 && (
            <p className="text-sm text-muted-foreground">No country has an approved public channel yet.</p>
          )}
          {hasMoreCountries && (
            <div className="mt-4">
              <Link href="/countries" className="text-sm font-semibold text-primary hover:underline" data-testid="home-view-all-countries">
                View all countries →
              </Link>
            </div>
          )}
        </section>

        {/* Explore interests */}
        <section className="container py-10">
          <SectionHeader
            title="Explore interests"
            subtitle="Editorial picks across popular themes."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EDITORIAL_COLLECTIONS.map((col) => (
              <Link
                key={col.title}
                href={col.href}
                className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${col.gradient} p-5 text-white min-h-[130px] flex flex-col justify-end shadow-md ring-1 ring-white/10 hover:shadow-xl hover:-translate-y-0.5 transition`}
              >
                {/* Bottom-left gradient overlay so the label always has contrast even before hover */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-black/10 to-transparent" aria-hidden />
                <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" aria-hidden />
                <div className="relative">
                  <div className="font-semibold text-lg leading-tight drop-shadow-sm">{col.title}</div>
                  <div className="text-sm text-white/90 mt-1 drop-shadow-sm">{col.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <PricingTeaser pricing={pricing} />
        <OwnerGrowthCta />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
