import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { channelService } from '@/lib/services/channelService';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { countryByCode } from '@/lib/constants/countries';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import SponsorForm from './SponsorForm';
import { BadgeCheck, ShieldCheck, Users, ArrowLeft } from 'lucide-react';

interface Params { slug: string; }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await channelService.getPublicBySlug(slug);
  if (!c) return { title: 'Sponsor a Channel — WaveLead' };
  return { title: `Sponsor ${c.name} — WaveLead`, robots: { index: false, follow: false } };
}
export const dynamic = 'force-dynamic';

export default async function SponsorChannelPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const channel = await channelService.getPublicBySlug(slug);
  if (!channel) notFound();
  const [category, actor] = await Promise.all([
    channel.category_id ? categoryRepo.listActive().then((cs) => cs.find((c) => c.id === channel.category_id) || null) : Promise.resolve(null),
    resolveActorFromCookies(),
  ]);
  const country = countryByCode(channel.country_code);
  const followers = channel.follower_count > 0 ? `${Number(channel.follower_count).toLocaleString()} followers` : 'Reach not verified';

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <Link href={`/channel/${channel.slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to channel
        </Link>
        <div className="mt-4 grid md:grid-cols-[1fr_auto] gap-6 items-start">
          <div>
            <div className="text-xs uppercase tracking-wide text-primary font-semibold">Sponsor this Channel</div>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {channel.is_official && <span className="inline-flex items-center gap-1 text-primary"><BadgeCheck className="h-4 w-4" /> Official</span>}
              {channel.is_verified && !channel.is_official && <span className="inline-flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> Verified</span>}
              {category && <Link href={`/category/${category.slug}`} className="hover:text-foreground">{category.name}</Link>}
              {country && <span>{country.flag} {country.name}</span>}
              <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {followers}</span>
            </div>
            {channel.short_description && <p className="mt-3 text-sm text-muted-foreground max-w-xl">{channel.short_description}</p>}
          </div>
        </div>
        <div className="mt-8">
          <SponsorForm
            channelSlug={channel.slug}
            channelName={channel.name}
            presetTargetCountry={channel.country_code}
            initialContactName={actor?.user.display_name || ''}
            initialWorkEmail={actor?.user.email || ''}
          />
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Sales-assisted. WaveLead will coordinate with the channel owner and follow up manually. No payment is collected on this page.</p>
      </main>
      <Footer />
    </>
  );
}
