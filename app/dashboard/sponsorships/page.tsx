import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';

export const metadata: Metadata = { title: 'My Sponsorships — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function BrandSponsorshipsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/sponsorships');
  const orders = await marketplaceOrderRepo.listByBuyer(actor.user.id);
  return (
    <>
      <Header />
      <main className="container py-10 max-w-4xl">
        <h1 className="text-2xl md:text-3xl font-bold">My Sponsorships</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track the sponsorship packages you’ve requested from WaveLead channels.</p>
        <div className="mt-6 space-y-3" data-testid="brand-sponsorships">
          {orders.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">You haven’t booked any sponsorships yet. Browse the directory and select a channel to sponsor.</div>}
          {orders.map((o) => (
            <div key={o.id} className="wh-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium">{o.snapshot?.channel_name || o.channel_slug}</div>
                  <div className="text-xs text-muted-foreground">{o.package_type} · requested {new Date(o.created_at).toLocaleString()}</div>
                </div>
                <Badge className={statusStyle(o.status)}>{o.status.replace('_', ' ')}</Badge>
              </div>
              <div className="mt-2 text-sm">Price: <span className="font-medium">${((o.snapshot?.gross_price_minor ?? o.quoted_price_minor ?? 0) / 100).toFixed(2)}</span></div>
              <div className="mt-1 text-sm text-muted-foreground line-clamp-3">{o.brief.brief}</div>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
function statusStyle(s: string): string {
  if (s === 'paid') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
