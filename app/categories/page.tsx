import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import SectionHeader from '@/components/discovery/SectionHeader';
import { discoveryService } from '@/lib/services/discoveryService';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Categories', alternates: { canonical: '/categories' } };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const cats = await discoveryService.getCategoryCounts();
  return (
    <>
      <Header />
      <main>
        <div className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Categories</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-bold">Explore all categories</h1>
            <p className="text-sm text-muted-foreground mt-1">{cats.length} categories on WaveLead.</p>
          </div>
        </div>
        <section className="container py-8">
          <SectionHeader title="All categories" />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {cats.map((cat) => (
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
      </main>
      <Footer />
    </>
  );
}
