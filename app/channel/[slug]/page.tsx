import { notFound } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import SectionHeader from '@/components/discovery/SectionHeader';
import ChannelCard from '@/components/discovery/ChannelCard';
import { Button } from '@/components/ui/button';
import { channelService } from '@/lib/services/channelService';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { countryByCode } from '@/lib/constants/countries';
import { ShieldCheck, Users, Share2, ArrowUpRight, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

interface Params { slug: string; }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await channelService.getPublicBySlug(slug);
  if (!c) return { title: 'Channel not found' };
  return {
    title: `${c.name} — WhatsApp Channel`,
    description: c.short_description || c.description || `Discover the ${c.name} channel on WaveLead.`,
    alternates: { canonical: `/channel/${c.slug}` },
    openGraph: { title: c.name, description: c.short_description || c.description || '', type: 'website' },
  };
}

export const dynamic = 'force-dynamic';

export default async function ChannelProfilePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const channel = await channelService.getPublicBySlug(slug);
  if (!channel) notFound();

  const [category, related] = await Promise.all([
    channel.category_id ? (await import('@/lib/repositories/channelRepo')).channelRepo.findById(channel.id).then(() => categoryRepo.listActive()).then((cs) => cs.find((c) => c.id === channel.category_id) || null) : Promise.resolve(null),
    channel.category_id
      ? channelService.listPublic({ limit: 6, sort: 'top' }).then((r) => r.items.filter((c) => c.id !== channel.id && c.category_id === channel.category_id).slice(0, 3))
      : Promise.resolve([]),
  ]);

  const country = countryByCode(channel.country_code);
  const followers = channel.follower_count > 0 ? `${Number(channel.follower_count).toLocaleString()} followers` : 'Followers not verified';

  return (
    <>
      <Header />
      <main>
        <section className="wh-gradient-hero border-b border-border/60">
          <div className="container py-10 md:py-14">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="h-20 w-20 md:h-24 md:w-24 rounded-2xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground text-4xl font-extrabold shrink-0" aria-hidden>
                {(channel.name || 'W').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
                  {channel.is_verified && <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full"><ShieldCheck className="h-3.5 w-3.5" /> Verified</span>}
                  {channel.is_featured && <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full"><Sparkles className="h-3.5 w-3.5" /> Featured</span>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground uppercase tracking-wider flex items-center flex-wrap gap-x-2 gap-y-1">
                  {country && <span>{country.flag} {country.name}</span>}
                  {channel.primary_language && <span aria-hidden>·</span>}
                  {channel.primary_language && <span>{channel.primary_language}</span>}
                  {category && <span aria-hidden>·</span>}
                  {category && <Link href={`/category/${category.slug}`} className="hover:text-primary">{category.name}</Link>}
                </div>
                <p className="mt-3 text-base text-foreground max-w-2xl">{channel.description || channel.short_description}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href={channel.whatsapp_url} target="_blank" rel="noopener noreferrer">
                    <Button size="lg" className="gap-2">Follow on WhatsApp <ArrowUpRight className="h-4 w-4" /></Button>
                  </a>
                  <Button size="lg" variant="outline" className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Clicking &ldquo;Follow&rdquo; will open the public WhatsApp Channel link in a new tab. WaveLead does not track WhatsApp user identities.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="container py-8 grid gap-6 md:grid-cols-3">
          <Stat label="Reach" value={followers} icon={<Users className="h-4 w-4" />} />
          <Stat label="Country" value={country ? `${country.flag} ${country.name}` : channel.country_code || '—'} icon={null} />
          <Stat label="Category" value={category?.name || '—'} icon={null} />
        </section>

        {related.length > 0 && (
          <section className="container py-8">
            <SectionHeader title="Similar channels" subtitle="Others in this category worth a look." />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {related.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="wh-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">{icon}{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
