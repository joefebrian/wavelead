import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, TrendingUp, BarChart3, Globe2, ShieldCheck, Sparkles, Users, ArrowRight } from 'lucide-react';
import type { Category, PublicChannel } from '@/lib/types';

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    const res = await fetch(`${base}/api${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? null) as T | null;
  } catch { return null; }
}

interface FeaturedData { items: PublicChannel[]; }
interface CategoriesData { categories: Category[]; }
interface Stats { totalApproved: number; totalPending: number; }

export default async function HomePage() {
  const [featured, categoriesData, stats] = await Promise.all([
    fetchJson<FeaturedData>('/channels/featured'),
    fetchJson<CategoriesData>('/categories'),
    fetchJson<Stats>('/stats'),
  ]);
  const featuredItems = featured?.items || [];
  const categories = (categoriesData?.categories || []).slice(0, 12);
  const approvedCount = stats?.totalApproved ?? 0;

  return (
    <>
      <Header />
      <main>
        <section className="wh-gradient-hero">
          <div className="container py-20 md:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                Independent · Not affiliated with WhatsApp or Meta
              </Badge>
              <h1 className="mt-6 text-4xl md:text-6xl font-extrabold tracking-tight text-foreground">
                The growth infrastructure for
                <span className="block text-primary">WhatsApp Channels</span>
              </h1>
              <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
                Discover public channels worldwide. Grow your audience with analytics, promotion and
                measurement tools built for creators, publishers and brands.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/channels">
                  <Button size="lg" className="gap-2"><Search className="h-4 w-4" /> Discover Channels</Button>
                </Link>
                <Link href="/submit">
                  <Button size="lg" variant="outline" className="gap-2">Submit your channel <ArrowRight className="h-4 w-4" /></Button>
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <Stat label="Channels" value={approvedCount.toLocaleString()} />
                <Stat label="Categories" value={(categoriesData?.categories?.length || 0).toString()} />
                <Stat label="Countries" value="11+" />
              </div>
            </div>
          </div>
        </section>

        <section className="container py-16">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold">Discover → Grow → Measure → Monetize</h2>
            <p className="mt-3 text-muted-foreground">
              WaveLead is a directory, an analytics platform and a promotion engine — in one place.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            <Pillar icon={<Search className="h-5 w-5" />} title="Discover" desc="Free public directory with search, categories and country pages." />
            <Pillar icon={<TrendingUp className="h-5 w-5" />} title="Grow" desc="Follow-click tracking, WaveScore ranking and promotion tools." />
            <Pillar icon={<BarChart3 className="h-5 w-5" />} title="Measure" desc="Real analytics for verified owners — acquisition, funnels, sources." />
            <Pillar icon={<Sparkles className="h-5 w-5" />} title="Monetize" desc="Pro tools, featured slots and enterprise growth partnerships." />
          </div>
        </section>

        {featuredItems.length > 0 && (
          <section className="container py-10">
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold">Featured channels</h2>
                <p className="text-muted-foreground text-sm mt-1">Hand-picked from the community.</p>
              </div>
              <Link href="/channels" className="text-sm font-medium text-primary hover:underline">View all →</Link>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featuredItems.map((c) => <ChannelCard key={c.id} channel={c} />)}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Demo data shown for development. Real channel submissions will appear once approved by moderators.
            </p>
          </section>
        )}

        {categories.length > 0 && (
          <section className="container py-16">
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold">Browse by category</h2>
                <p className="text-muted-foreground text-sm mt-1">Explore what people follow on WaveLead.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {categories.map((cat) => (
                <Link key={cat.id} href={`/category/${cat.slug}`} className="wh-card p-4 flex items-center gap-3">
                  <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary text-lg font-bold">
                    {cat.name.charAt(0)}
                  </span>
                  <div>
                    <div className="font-semibold text-sm">{cat.name}</div>
                    <div className="text-xs text-muted-foreground">Explore →</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="border-y border-border/60 bg-secondary/40">
          <div className="container py-10 grid gap-6 md:grid-cols-3 text-sm">
            <TrustPoint icon={<ShieldCheck className="h-4 w-4" />} title="Owner-first & privacy safe" desc="We never store WhatsApp user identities. Channel data comes from owner submissions." />
            <TrustPoint icon={<Globe2 className="h-4 w-4" />} title="Built for a global audience" desc="Multi-country and multi-language architecture from day one." />
            <TrustPoint icon={<Users className="h-4 w-4" />} title="For creators & brands" desc="Free discovery for users. Freemium growth tools for channel owners." />
          </div>
        </section>

        <section className="container py-20">
          <div className="rounded-2xl bg-foreground text-background p-10 md:p-14 relative overflow-hidden">
            <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/30 blur-3xl" />
            <div className="relative max-w-xl">
              <h3 className="text-3xl md:text-4xl font-bold">Own a WhatsApp Channel?</h3>
              <p className="mt-3 text-background/80">Claim your profile, unlock analytics and start promoting. Free to submit.</p>
              <div className="mt-6 flex gap-3">
                <Link href="/submit"><Button size="lg">Submit Channel</Button></Link>
                <Link href="/signup"><Button size="lg" variant="outline" className="bg-transparent border-background/40 text-background hover:bg-background hover:text-foreground">Create account</Button></Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (<div className="flex items-baseline gap-2"><span className="text-2xl font-bold text-foreground">{value}</span><span>{label}</span></div>);
}
function Pillar({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (<div className="wh-card p-6"><div className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div><div className="mt-4 font-semibold">{title}</div><div className="mt-1 text-sm text-muted-foreground">{desc}</div></div>);
}
function TrustPoint({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (<div className="flex gap-3"><div className="h-8 w-8 shrink-0 grid place-items-center rounded-md bg-primary/10 text-primary">{icon}</div><div><div className="font-semibold">{title}</div><div className="text-muted-foreground mt-1">{desc}</div></div></div>);
}
function ChannelCard({ channel }: { channel: PublicChannel }) {
  return (
    <Link href={`/channel/${channel.slug}`} className="wh-card p-5 block">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground text-lg font-bold">
          {channel.name?.[0] || 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{channel.name}</div>
            {channel.is_verified && <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{channel.country_code} · {channel.primary_language}</div>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{channel.short_description || channel.description}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{Number(channel.follower_count || 0).toLocaleString()} followers</span>
            <span className="text-xs font-medium text-primary">View profile →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
