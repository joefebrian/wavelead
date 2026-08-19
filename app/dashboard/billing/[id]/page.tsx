import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { paymentRefundRepo } from '@/lib/repositories/paymentRefundRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';

export const metadata: Metadata = { title: 'Payment · WaveLead' };
export const dynamic = 'force-dynamic';

function dollars(minor: number | null | undefined) { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }

export default async function OwnerPaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login');
  const { id } = await params;
  const f = await paymentFundingOrderRepo.findById(id);
  if (!f || f.owner_user_id !== actor.user.id) notFound();
  const camp = await promotionCampaignRepo.findById(f.campaign_id);
  const refunds = await paymentRefundRepo.list({ funding_order_id: f.id });
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-3xl flex-1">
        <Link href="/dashboard/billing" className="text-sm text-primary hover:underline">← Billing</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">{camp?.name || 'Payment'}</h1>
        <div className="text-sm text-muted-foreground mb-6">Payment reference {f.provider_order_id?.slice(0, 12)}…</div>

        <section className="wh-card p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Stat label="Provider" value={f.provider.toUpperCase()} />
          <Stat label="Amount" value={dollars(f.amount_minor)} />
          <Stat label="Payment status" value={<Badge variant="outline">{f.status}</Badge>} />
          <Stat label="Captured" value={dollars(f.amount_captured_minor)} />
          <Stat label="Refunded" value={dollars(f.amount_refunded_minor)} />
          <Stat label="Paid date" value={f.paid_at ? new Date(f.paid_at).toLocaleString() : '—'} />
        </section>

        <section className="mt-6 wh-card p-5">
          <h2 className="font-semibold">Refunds</h2>
          {refunds.length === 0 && <div className="mt-3 text-sm text-muted-foreground">No refunds requested.</div>}
          {refunds.map((r) => (
            <div key={r.id} className="mt-3 pt-3 border-t first:border-t-0 first:pt-0">
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">{new Date(r.requested_at).toLocaleString()}</span><Badge variant="outline">{r.status}</Badge></div>
              <div className="mt-1 text-sm">Requested {dollars(r.requested_amount_minor)} · Processed {dollars(r.actual_refunded_amount_minor)}</div>
              {r.reason && <div className="mt-1 text-xs text-muted-foreground">{r.reason}</div>}
            </div>
          ))}
        </section>

        <section className="mt-6 text-xs text-muted-foreground">
          <p>Payment Receipt — this is not a tax invoice.</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
