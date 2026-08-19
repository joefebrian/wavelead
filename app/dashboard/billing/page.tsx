import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';

export const metadata: Metadata = { title: 'Billing · WaveLead' };
export const dynamic = 'force-dynamic';

function dollars(minor: number | null | undefined) { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }
function statusLabel(s: string) {
  const map: Record<string, string> = {
    paid: 'Paid', pending: 'Pending', checkout_created: 'Awaiting payment', created: 'Draft',
    failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded', partially_refunded: 'Partial refund',
    legacy_waived: 'Legacy — waived',
  };
  return map[s] || s;
}

export default async function OwnerBillingPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login');
  const rows = await paymentFundingOrderRepo.list({ owner_user_id: actor.user.id });
  const items = await Promise.all(rows.map(async (r) => {
    const camp = await promotionCampaignRepo.findById(r.campaign_id);
    return { r, campaign_name: camp?.name || r.campaign_id };
  }));
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-4xl flex-1">
        <h1 className="text-2xl font-bold mb-1">Billing</h1>
        <p className="text-sm text-muted-foreground mb-6">Your campaign payments &amp; refunds.</p>
        {items.length === 0 && <div className="wh-card p-6 text-center text-muted-foreground">No payments yet.</div>}
        <div className="space-y-3 md:hidden" data-testid="billing-cards">
          {items.map(({ r, campaign_name }) => (
            <Link key={r.id} href={`/dashboard/billing/${r.id}`} className="block wh-card p-4">
              <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span><Badge variant="outline">{statusLabel(r.status)}</Badge></div>
              <div className="mt-2 font-medium">{campaign_name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{r.provider.toUpperCase()} · {dollars(r.amount_minor)}</div>
              {r.amount_refunded_minor > 0 && <div className="mt-1 text-xs text-orange-700 dark:text-orange-300">Refunded {dollars(r.amount_refunded_minor)}</div>}
            </Link>
          ))}
        </div>
        <div className="hidden md:block wh-card overflow-hidden">
          <table className="w-full text-sm" data-testid="billing-table">
            <thead className="bg-muted text-muted-foreground text-left"><tr><th className="p-3">Date</th><th className="p-3">Campaign</th><th className="p-3">Provider</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Refunded</th></tr></thead>
            <tbody>
              {items.map(({ r, campaign_name }) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3"><Link href={`/dashboard/billing/${r.id}`} className="text-primary hover:underline">{campaign_name}</Link></td>
                  <td className="p-3">{r.provider.toUpperCase()}</td>
                  <td className="p-3 tabular-nums">{dollars(r.amount_minor)}</td>
                  <td className="p-3"><Badge variant="outline">{statusLabel(r.status)}</Badge></td>
                  <td className="p-3 tabular-nums">{r.amount_refunded_minor > 0 ? dollars(r.amount_refunded_minor) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <Footer />
    </div>
  );
}
