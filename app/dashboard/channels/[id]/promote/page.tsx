import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { COUNTRIES } from '@/lib/constants/countries';
import PromoteWizard from './PromoteWizard';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = { title: 'Promote channel — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

export default async function PromotePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/channels/${id}/promote`);
  const channel = await channelRepo.findById(id);
  const [cats] = await Promise.all([categoryRepo.listActive()]);
  const eligible = !!channel
    && channel.owner_id === actor.user.id
    && channel.status === 'approved'
    && ['verified', 'official'].includes((channel as unknown as { verification_status?: string }).verification_status || '');
  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-3xl">
        <Link href={`/dashboard/channels/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to channel
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Promote channel</h1>
        <p className="mt-2 text-muted-foreground">Reach more people on WaveLead discovery. Sponsored placements are separate from organic ranking and clearly labeled.</p>
        {!eligible ? (
          <div className="mt-8 wh-card p-6">
            <div className="font-semibold">This channel isn&apos;t eligible for promotion yet</div>
            <p className="text-sm text-muted-foreground mt-2">Only your own <span className="font-medium text-foreground">approved</span> and <span className="font-medium text-foreground">verified</span> (or official) channels can be promoted.</p>
            <div className="mt-4 flex gap-2">
              <Link href={`/dashboard/channels/${id}`}><Button variant="outline">Manage channel</Button></Link>
              <Link href="/dashboard/promotions"><Button variant="ghost">See my promotions</Button></Link>
            </div>
          </div>
        ) : (
          <PromoteWizard
            channel={{
              id: channel!.id, slug: channel!.slug, name: channel!.name,
              logo_url: channel!.logo_url, short_description: channel!.short_description,
              country_code: channel!.country_code, primary_language: channel!.primary_language,
              category_id: (channel as unknown as { category_id?: string | null }).category_id ?? null,
            }}
            categories={cats.map((c) => ({ slug: c.slug, name: c.name }))}
            countries={COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: c.flag }))}
          />
        )}
      </main>
      <Footer />
    </>
  );
}
