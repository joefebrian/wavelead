import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { paymentRefundRepo } from '@/lib/repositories/paymentRefundRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { refundService } from '@/lib/services/payments/refundService';
import { ledgerService } from '@/lib/services/ledger/ledgerService';
import AdminPaymentActions from './AdminPaymentActions';

export const metadata: Metadata = { title: 'Admin · Payment' };
export const dynamic = 'force-dynamic';
function dollars(minor: number | null | undefined) { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }
function dollarsFromMicros(m: number) { return `$${(m/1_000_000).toFixed(6)}`; }

export default async function AdminPaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const { id } = await params;
  const f = await paymentFundingOrderRepo.findById(id);
  if (!f) notFound();
  const camp = await promotionCampaignRepo.findById(f.campaign_id);
  const refunds = await paymentRefundRepo.list({ funding_order_id: f.id });
  const refundability = await refundService.computeRefundability(f.campaign_id);
  const balances = await ledgerService.campaignBalances(f.campaign_id);
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-4xl flex-1">
        <Link href="/admin/payments" className="text-sm text-primary hover:underline">← Payments</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">{camp?.name || 'Payment'}</h1>
        <div className="text-sm text-muted-foreground mb-6">Owner {f.owner_user_id.slice(0, 8)}… · {f.provider.toUpperCase()}</div>

        <section className="wh-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label="Payment status" value={<Badge variant="outline">{f.status}</Badge>} />
          <Stat label="Amount requested" value={dollars(f.amount_minor)} />
          <Stat label="Amount captured" value={dollars(f.amount_captured_minor)} />
          <Stat label="Refunded" value={dollars(f.amount_refunded_minor)} />
          <Stat label="PayPal order" value={f.provider_order_id || '—'} />
          <Stat label="PayPal capture" value={f.provider_capture_id || '—'} />
        </section>

        <section className="mt-6 wh-card p-5">
          <h2 className="font-semibold mb-3">Ledger reconciliation</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Funded" value={dollarsFromMicros(balances.funded_usd_micros)} />
            <Stat label="Spent" value={dollarsFromMicros(balances.spent_usd_micros)} />
            <Stat label="Refunded (ledger)" value={dollarsFromMicros(balances.refunded_usd_micros)} />
            <Stat label="Remaining" value={dollarsFromMicros(balances.remaining_usd_micros)} />
            <Stat label="Refundable" value={dollarsFromMicros(refundability.refundable_usd_micros)} />
            <Stat label="Refundable minor" value={dollars(refundability.refundable_amount_minor)} />
            <Stat label="Rounding residual" value={dollarsFromMicros(refundability.rounding_adjustment_usd_micros)} />
          </div>
        </section>

        <section className="mt-6 wh-card p-5">
          <h2 className="font-semibold mb-3">Refund history</h2>
          {refunds.length === 0 && <div className="text-sm text-muted-foreground">None.</div>}
          {refunds.map((r) => (
            <div key={r.id} className="pt-3 mt-3 border-t first:border-t-0 first:mt-0 first:pt-0">
              <div className="flex justify-between"><span className="text-sm text-muted-foreground">{new Date(r.requested_at).toLocaleString()}</span><Badge variant="outline">{r.status}</Badge></div>
              <div className="text-sm mt-1">Requested {dollars(r.requested_amount_minor)} · Refunded {dollars(r.actual_refunded_amount_minor)}</div>
              {r.provider_refund_id && <div className="text-xs text-muted-foreground mt-1">provider_refund_id: {r.provider_refund_id}</div>}
              {r.failure_reason && <div className="text-xs text-red-600 mt-1">{r.failure_reason}</div>}
            </div>
          ))}
        </section>

        <AdminPaymentActions paymentId={f.id} refunds={refunds.map((r) => ({ id: r.id, status: r.status, requested_amount_minor: r.requested_amount_minor }))} refundable={refundability} />
      </main>
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium break-all">{value}</div>
    </div>
  );
}
