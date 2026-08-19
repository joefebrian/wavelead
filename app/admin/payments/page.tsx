import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';

export const metadata: Metadata = { title: 'Admin · Payments' };
export const dynamic = 'force-dynamic';
function dollars(minor: number | null | undefined) { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }

export default async function AdminPaymentsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const rows = await paymentFundingOrderRepo.list({});
  const items = await Promise.all(rows.map(async (r) => {
    const camp = await promotionCampaignRepo.findById(r.campaign_id);
    return { r, campaign_name: camp?.name || r.campaign_id };
  }));
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-5xl flex-1">
        <h1 className="text-2xl font-bold mb-1">Payments</h1>
        <p className="text-sm text-muted-foreground mb-6">All campaign payments across owners.</p>
        <div className="wh-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-payments-table">
            <thead className="bg-muted text-muted-foreground text-left"><tr><th className="p-3">Created</th><th className="p-3">Campaign</th><th className="p-3">Provider</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Refunded</th></tr></thead>
            <tbody>
              {items.map(({ r, campaign_name }) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3"><Link href={`/admin/payments/${r.id}`} className="text-primary hover:underline">{campaign_name}</Link></td>
                  <td className="p-3">{r.provider.toUpperCase()}</td>
                  <td className="p-3 tabular-nums">{dollars(r.amount_minor)}</td>
                  <td className="p-3"><Badge variant="outline">{r.status}</Badge></td>
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
