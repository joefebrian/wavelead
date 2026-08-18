import { notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ChannelCard from '@/components/discovery/ChannelCard';
import CategoryPills from '@/components/discovery/CategoryPills';
import SectionHeader from '@/components/discovery/SectionHeader';
import EmptyState from '@/components/discovery/EmptyState';
import { channelService } from '@/lib/services/channelService';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { discoveryService } from '@/lib/services/discoveryService';
import type { Metadata } from 'next';

interface Params { slug: string; }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const cat = await categoryRepo.findBySlug(slug);
  if (!cat) return { title: 'Category not found' };
  return {
    title: `${cat.name} channels`,
    description: `Discover ${cat.name.toLowerCase()} WhatsApp Channels on WaveLead.`,
    alternates: { canonical: `/category/${cat.slug}` },
  };
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

  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Category</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">{cat.name} channels</h1>
            <p className="text-sm text-muted-foreground mt-1">{result.total} channels approved on WaveLead.</p>
          </div>
        </div>
        <CategoryPills categories={cats} active={cat.slug} />

        <section className="container py-8">
          <SectionHeader title={`Top ${cat.name} channels`} subtitle="Ranked by reach and verification." />
          {result.items.length === 0 ? (
            <EmptyState title="No channels here yet" message="Be the first to submit a channel to this category." ctaHref="/submit" ctaLabel="Submit a Channel" />
          ) : (
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
