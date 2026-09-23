import { notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import SponsoredCard from '@/components/promo/SponsoredCard';
import { loadOneSponsored, shouldRenderSponsored } from '@/lib/services/promotion/deliveryHelpers';
import { channelService } from '@/lib/services/channelService';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { discoveryService } from '@/lib/services/discoveryService';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

interface Params { slug: string; }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const cat = await categoryRepo.findBySlug(slug);
  if (!cat) return { title: 'Category not found | WaveLead', robots: { index: false, follow: true } };
  return buildMetadata({
    title: `${cat.name} WhatsApp Channels`,
    description: `Discover ${cat.name} WhatsApp Channels on WaveLead. Explore creators, audience data and sponsorship opportunities in ${cat.name}.`,
    path: `/category/${cat.slug}`,
  });
}

export const dynamic = 'force-dynamic';

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const cat = await categoryRepo.findBySlug(slug);
  if (!cat) notFound();

  const [result, cats] = await Promise.all([
    channelService.listPublic({ category: slug, sort: 'top', limit: 30 }),
    discoveryService.getCategoryCounts().then((rows) => rows.slice(0, 12)),
  ]);
  // Note: sort='top' means organic top ranking within THIS category. Sponsored
  // category slots are allowed here (the M05.1 "no sponsored on Top / Trending"
  // rule refers to the SITE-wide Top / Trending pages, not category ranking).
  const sponsored = await loadOneSponsored({ placement: 'sponsored_category', category_slug: slug });

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Category</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">{cat.name} WhatsApp Channels</h1>
            <p className="text-sm text-muted-foreground mt-1">{result.total} channels approved on WaveLead.</p>
            <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
              Browse public WhatsApp Channels approved on WaveLead in the <strong>{cat.name}</strong> category.
              Every listing is reviewed before it goes live. Open a channel profile to review its audience
              information, rate card, sample work and sponsorship packages.
            </p>
          </div>
        </div>
        <CategoryPills categories={cats} active={cat.slug} />

        <section className="container py-8">
          <SectionHeader title={`Top ${cat.name} channels`} subtitle="Ranked by reach and verification." />
          {result.items.length === 0 ? (
            <EmptyState title="No channels here yet" message="Be the first to submit a channel to this category." ctaHref="/submit" ctaLabel="Submit a Channel" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sponsored[0] && shouldRenderSponsored(result.items.length) && <SponsoredCard data={sponsored[0]} sourcePath={`/category/${slug}`} />}
              {result.items.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
