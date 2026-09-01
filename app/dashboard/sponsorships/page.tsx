import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';
import BrandAcceptDeliveryButton from './BrandAcceptDeliveryButton';
import BuyerPayPalButton from './BuyerPayPalButton';
import BuyerPaymentReturnPanel from './BuyerPaymentReturnPanel';

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
        <p className="mt-1 text-sm text-muted-foreground">Track the sponsorship packages you&apos;ve requested from WaveLead channels.</p>
        {/* B3 — banner that appears only after a PayPal return / cancel round-trip. */}
        <div className="mt-6">
          <Suspense fallback={null}><BuyerPaymentReturnPanel /></Suspense>
        </div>
        <div className="mt-2 space-y-3" data-testid="brand-sponsorships">
          {orders.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">You haven&apos;t booked any sponsorships yet. Browse the directory and select a channel to sponsor.</div>}
          {orders.map((o) => {
            const priceMinor = o.snapshot?.gross_price_minor ?? o.quoted_price_minor ?? 0;
            return (
              <div key={o.id} className="wh-card p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{o.snapshot?.channel_name || o.channel_slug}</div>
                    <div className="text-xs text-muted-foreground">{o.package_type} · requested {new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <Badge className={statusStyle(o.status)}>{o.status.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="mt-2 text-sm">Price: <span className="font-medium">${(priceMinor / 100).toFixed(2)}</span></div>
                <div className="mt-1 text-sm text-muted-foreground line-clamp-3">{o.brief.brief}</div>

                {/* B3 — Pay with PayPal for awaiting_payment fixed-price orders. */}
                {o.status === 'awaiting_payment' && o.snapshot && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <BuyerPayPalButton orderId={o.id} amountMinor={o.snapshot.gross_price_minor} currency={o.snapshot.currency} />
                  </div>
                )}

                {o.status === 'paid' && (
                  <div className="mt-2 text-sm text-emerald-700">Payment confirmed. Awaiting channel owner to begin work.</div>
                )}

                {o.status === 'submitted_for_review' && (
                  <div className="mt-3 border-t border-border/60 pt-3 space-y-2">
                    <div className="text-xs uppercase tracking-wide font-semibold text-primary">Delivery Submitted</div>
                    {o.delivery_notes && <div className="text-sm"><span className="text-muted-foreground">Notes: </span>{o.delivery_notes}</div>}
                    {(o.delivery_urls?.length ?? 0) > 0 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Proof: </span>
                        {o.delivery_urls.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noopener nofollow noreferrer" className="text-primary underline break-all">{u}</a>
                        )).reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, <span key={`sep-${idx}`} className="text-muted-foreground">, </span>, el], [] as React.ReactNode[])}
                      </div>
                    )}
                    {o.proof_description && <div className="text-sm text-muted-foreground">{o.proof_description}</div>}
                    <BrandAcceptDeliveryButton orderId={o.id} />
                  </div>
                )}
                {o.status === 'completed' && (
                  <div className="mt-2 text-sm text-emerald-700">Completed{o.completed_at ? ` on ${new Date(o.completed_at).toLocaleDateString()}` : ''}. Thank you.</div>
                )}
              </div>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
function statusStyle(s: string): string {
  if (s === 'paid' || s === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'in_progress') return 'bg-indigo-100 text-indigo-800';
  if (s === 'submitted_for_review') return 'bg-violet-100 text-violet-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
