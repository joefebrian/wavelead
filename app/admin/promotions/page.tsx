import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { promotionCampaignService } from '@/lib/services/promotion/campaignService';
import type { PromotionCampaignStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Admin · Promotions — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function dollars(minor: number): string { return `$${(minor / 100).toFixed(2)}`; }

export default async function AdminPromotionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/promotions');
  const sp = await searchParams;
  const status = (sp?.status || 'pending_review') as PromotionCampaignStatus;
  const items = await promotionCampaignService.listForAdmin(actor, status);
  const tabs: PromotionCampaignStatus[] = ['pending_review', 'active', 'scheduled', 'paused', 'completed', 'rejected'];

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-5xl">
        <AdminNav active="/admin/promotions" />
        <h1 className="text-3xl font-bold tracking-tight">Admin · Promotions</h1>
        <p className="mt-1 text-muted-foreground">Review and manage sponsored discovery campaigns.</p>
        <div className="mt-4 flex gap-2 flex-wrap">
          {tabs.map((t) => (
            <Link key={t} href={`/admin/promotions?status=${t}`}
              className={`px-3 py-1 rounded-full text-xs border ${status === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
              {t.replace('_', ' ')}
            </Link>
          ))}
        </div>
        <ul className="mt-6 space-y-3">
          {items.length === 0 && <li className="text-sm text-muted-foreground">No campaigns in this queue.</li>}
          {items.map((c) => (
            <li key={c.id} className="wh-card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/admin/promotions/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                  <span>Budget {dollars(c.budget_total_usd_minor)}</span>
                  <span>· Spend {dollars(c.estimated_spend_usd_minor)}</span>
                  <span>· {c.placements.length} placement{c.placements.length !== 1 ? 's' : ''}</span>
                  <span>· owner {c.owner_user_id.slice(0, 8)}…</span>
                </div>
              </div>
              <Badge>{c.status.replace('_', ' ')}</Badge>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
