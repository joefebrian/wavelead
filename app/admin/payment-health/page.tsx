import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { paymentRefundRepo } from '@/lib/repositories/paymentRefundRepo';
import { ledgerService } from '@/lib/services/ledger/ledgerService';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';

export const metadata: Metadata = { title: 'Admin · Payment Health' };
export const dynamic = 'force-dynamic';

export default async function PaymentHealthPage() {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const all = await paymentFundingOrderRepo.list({});
  const pending = all.filter(f => ['created','checkout_created','pending'].includes(f.status)).length;
  const failed = all.filter(f => f.status === 'failed').length;
  const refunds = await paymentRefundRepo.list({});
  const refunds_pending = refunds.filter(r => ['pending','processing'].includes(r.status)).length;
  const refunds_failed = refunds.filter(r => r.status === 'failed').length;
  const webhookColl = await getCollection<{ processed?: boolean; process_error?: string | null }>(COLLECTIONS.PAYMENT_WEBHOOK_EVENTS);
  const webhook_failed = await webhookColl.countDocuments({ processed: true, process_error: { $ne: null } });
  // Integrity: run a bounded check to avoid overwhelming the dev-server RSC
  // stream. For a lightweight per-page signal we only need "is anything wrong
  // right now?" — the full report is available via the /admin/ledger deep dive.
  const integrityCount = await ledgerService.checkIntegrityCount();
  const reconciliation_needed = all.filter(f => f.status === 'pending' && f.provider_order_id).length;

  const cards = [
    { label: 'Pending payments', value: pending, tone: pending > 0 ? 'warn' : 'ok' },
    { label: 'Failed payments', value: failed, tone: failed > 0 ? 'warn' : 'ok' },
    { label: 'Refunds pending', value: refunds_pending, tone: refunds_pending > 0 ? 'warn' : 'ok' },
    { label: 'Refunds failed', value: refunds_failed, tone: refunds_failed > 0 ? 'critical' : 'ok' },
    { label: 'Webhook processing failures', value: webhook_failed, tone: webhook_failed > 0 ? 'warn' : 'ok' },
    { label: 'Ledger integrity issues', value: integrityCount, tone: integrityCount > 0 ? 'critical' : 'ok' },
    { label: 'Reconciliation needed', value: reconciliation_needed, tone: reconciliation_needed > 0 ? 'warn' : 'ok' },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-4xl flex-1">
        <AdminNav active="/admin/payment-health" />
        <h1 className="text-2xl font-bold mb-1">Payment Health</h1>
        <p className="text-sm text-muted-foreground mb-6">Operational visibility. Correction actions live on individual payment pages.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-md border p-4 ${c.tone === 'critical' ? 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900' : c.tone === 'warn' ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900' : 'border-border bg-card'}`}>
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>
        {integrityCount > 0 && (
          <section className="mt-6 wh-card p-5 border-red-300">
            <h2 className="font-semibold text-red-700">Ledger integrity issues detected</h2>
            <p className="mt-2 text-sm">
              {integrityCount} issue{integrityCount === 1 ? '' : 's'} found. Use the{' '}
              <Link href="/admin/ledger" className="underline text-primary">ledger</Link> to inspect
              individual transactions and drill into affected campaigns.
            </p>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
