import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { promotionCampaignService } from '@/lib/services/promotion/campaignService';
import { channelRepo } from '@/lib/repositories/channelRepo';
import AdminActions from './AdminActions';

export const metadata: Metadata = { title: 'Admin campaign review — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function dollars(minor: number): string { return `$${(minor / 100).toFixed(2)}`; }

interface Params { id: string; }

export default async function AdminCampaignDetail({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/admin/promotions/${id}`);
  let camp; try { camp = await promotionCampaignService.getForAdmin(actor, id); } catch { notFound(); }
  const channel = await channelRepo.findById(camp.channel_id);
  const canReview = camp.status === 'pending_review';
  const estImpressions = camp.rate_snapshot && camp.rate_snapshot.length > 0
    ? Math.floor((camp.budget_total_usd_minor / (camp.rate_snapshot[0].cpm_usd_minor || 1)) * 1000)
    : 0;

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <Link href="/admin/promotions" className="text-sm text-muted-foreground hover:text-foreground">← All admin promotions</Link>
        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{camp.name}</h1>
            <div className="mt-1 flex items-center gap-2"><Badge>{camp.status.replace('_', ' ')}</Badge><span className="text-sm text-muted-foreground">Objective: {camp.objective}</span></div>
          </div>
          {canReview && <AdminActions id={camp.id} />}
        </div>

        <section className="mt-6 wh-card p-5 text-sm space-y-2">
          <div className="font-semibold">Channel</div>
          <div>{channel?.name} · <Link href={`/channel/${channel?.slug}`} className="underline">{channel?.slug}</Link></div>
          <div className="text-muted-foreground">{channel?.country_code} · {channel?.primary_language}</div>
        </section>

        <section className="mt-4 wh-card p-5 text-sm space-y-2">
          <div className="font-semibold">Campaign details</div>
          <div><span className="text-muted-foreground">Placements:</span> {camp.placements.join(', ')}</div>
          <div><span className="text-muted-foreground">Countries:</span> {camp.targeting.countries.join(', ') || 'Any'}</div>
          <div><span className="text-muted-foreground">Languages:</span> {camp.targeting.languages.join(', ').toUpperCase() || 'Any'}</div>
          <div><span className="text-muted-foreground">Categories:</span> {camp.targeting.categories.join(', ') || 'Any'}</div>
          <div><span className="text-muted-foreground">Budget:</span> {dollars(camp.budget_total_usd_minor)}</div>
          <div><span className="text-muted-foreground">Duration:</span> {new Date(camp.start_at).toLocaleString()} → {new Date(camp.end_at).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Resolved rates:</span> {(camp.rate_snapshot || []).map((s) => `${s.placement} @ $${(s.cpm_usd_minor / 100).toFixed(2)} CPM`).join(' · ') || '—'}</div>
          <div><span className="text-muted-foreground">Est. impressions:</span> ~ {estImpressions.toLocaleString()}</div>
        </section>
      </main>
      <Footer />
    </>
  );
}
