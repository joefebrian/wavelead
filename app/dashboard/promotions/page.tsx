import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { promotionCampaignService } from '@/lib/services/promotion/campaignService';

export const metadata: Metadata = { title: 'Promotions — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function dollars(minor: number): string { return `$${(minor / 100).toFixed(2)}`; }

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-sky-100 text-sky-800',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-200 text-slate-800',
  completed: 'bg-slate-100 text-slate-700',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-700',
};

export default async function PromotionsListPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/promotions');
  const items = await promotionCampaignService.listForOwner(actor);
  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Promotions</h1>
          <Link href="/dashboard/channels"><Button variant="outline">Choose channel</Button></Link>
        </div>
        {items.length === 0 ? (
          <div className="mt-8 wh-card p-8 text-center">
            <div className="font-semibold text-lg">Grow your channel with WaveLead</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">Put your channel in front of more relevant people across WaveLead discovery.</p>
            <Link href="/dashboard/channels" className="inline-block mt-4"><Button>Create Promotion</Button></Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((c) => (
              <li key={c.id} className="wh-card p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/promotions/${c.id}`} className="font-medium hover:underline truncate block">{c.name}</Link>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                    <span>Budget {dollars(c.budget_total_usd_minor)}</span>
                    <span>· Spend {dollars(c.estimated_spend_usd_minor)}</span>
                    <span>· {c.placements.length} placement{c.placements.length !== 1 ? 's' : ''}</span>
                    <span>· {new Date(c.start_at).toLocaleDateString()} – {new Date(c.end_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <Badge className={STATUS_BADGE[c.status] || 'bg-muted'}>{c.status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}
