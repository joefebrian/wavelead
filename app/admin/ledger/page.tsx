import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { ledgerRepo } from '@/lib/repositories/ledgerRepo';

export const metadata: Metadata = { title: 'Admin · Ledger' };
export const dynamic = 'force-dynamic';
function usd(m: number) { return `$${(m / 1_000_000).toFixed(6)}`; }

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<{ campaign_id?: string; transaction_type?: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const q = await searchParams;
  const filter: Record<string, unknown> = {};
  if (q.campaign_id) filter.campaign_id = q.campaign_id;
  if (q.transaction_type) filter.transaction_type = q.transaction_type;
  const rows = await ledgerRepo.list(filter);
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-6xl flex-1">
        <h1 className="text-2xl font-bold mb-1">Ledger</h1>
        <p className="text-sm text-muted-foreground mb-6">Read-only. Corrections require reversal transactions.</p>
        <form className="flex flex-wrap gap-2 mb-4 text-sm">
          <input name="campaign_id" placeholder="campaign_id" defaultValue={q.campaign_id || ''} className="rounded-md border px-3 py-2 bg-background" />
          <select name="transaction_type" defaultValue={q.transaction_type || ''} className="rounded-md border px-3 py-2 bg-background">
            <option value="">All types</option>
            <option value="funding_credit">funding_credit</option>
            <option value="spend_debit">spend_debit</option>
            <option value="refund_debit">refund_debit</option>
          </select>
          <button className="rounded-md border px-3 py-2 bg-primary text-primary-foreground">Filter</button>
          <Link href="/admin/ledger" className="rounded-md border px-3 py-2">Reset</Link>
        </form>
        <div className="wh-card overflow-x-auto">
          <table className="w-full text-xs" data-testid="admin-ledger-table">
            <thead className="bg-muted text-muted-foreground text-left"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Campaign</th><th className="p-3">Amount</th><th className="p-3">Debits</th><th className="p-3">Credits</th><th className="p-3">Balanced</th><th className="p-3">Idempotency key</th></tr></thead>
            <tbody>
              {rows.map((t) => {
                const dr = t.postings.filter(p => p.direction==='debit').reduce((s,p)=>s+p.amount_usd_micros,0);
                const cr = t.postings.filter(p => p.direction==='credit').reduce((s,p)=>s+p.amount_usd_micros,0);
                return (
                  <tr key={t.id} className="border-t align-top">
                    <td className="p-3">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="p-3">{t.transaction_type}</td>
                    <td className="p-3">{t.campaign_id.slice(0, 12)}…</td>
                    <td className="p-3 tabular-nums">{usd(t.amount_usd_micros)}</td>
                    <td className="p-3 tabular-nums">{usd(dr)}</td>
                    <td className="p-3 tabular-nums">{usd(cr)}</td>
                    <td className="p-3">{dr === cr ? '✓' : '✗'}</td>
                    <td className="p-3 break-all">{t.idempotency_key}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
      <Footer />
    </div>
  );
}
