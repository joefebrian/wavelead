import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { channelActivationService } from '@/lib/services/channelActivationService';
import { ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: 'Admin · Owner Activation', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function dollars(minor: number | null | undefined) {
  if (minor == null) return '—';
  return `$${(minor / 100).toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const green = status === 'captured_finalized';
  const amber = status === 'captured_pending_fee' || status === 'pending' || status === 'checkout_created' || status === 'created';
  const red = status === 'failed' || status === 'cancelled' || status === 'refunded' || status === 'partially_refunded';
  const cls = green ? 'bg-emerald-100 text-emerald-800' : red ? 'bg-rose-100 text-rose-800' : amber ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
}

export default async function AdminActivationPaymentsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');

  const report = await channelActivationService.adminListActivations(actor);
  const { items, summary } = report;

  const cards = [
    { label: 'Total Activation Payments', value: String(summary.total_payments) },
    { label: 'Gross Captured', value: dollars(summary.gross_captured_minor) },
    { label: 'Gateway Fees', value: dollars(summary.gateway_fees_minor) },
    { label: 'Provider Net', value: dollars(summary.provider_net_minor) },
    { label: 'WaveLead Credit Issued', value: dollars(summary.wavelead_credit_issued_minor) },
    { label: 'Active Activations', value: String(summary.active_activations) },
    { label: 'Refunded / Reversed', value: String(summary.refunded_or_reversed) },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-6xl flex-1">
        <AdminNav active="/admin/activation-payments" />
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Owner Activation</h1>
          <span className="ml-1 rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold">Live</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Verified Owner Activation payments (source of truth: <code className="text-xs">channel_activation_payments</code>).
          Read-only — isolated from Marketplace &amp; Promote. WaveLead Credit is issued equal to provider net.
        </p>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-7 mb-6">
          {cards.map((c) => (
            <div key={c.label} className="wh-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="wh-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-activation-payments-table">
            <thead className="bg-muted text-muted-foreground text-left">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Gross</th>
                <th className="p-3">Gateway Fee</th>
                <th className="p-3">Provider Net</th>
                <th className="p-3">WaveLead Credit</th>
                <th className="p-3">Payment</th>
                <th className="p-3">Activation</th>
                <th className="p-3">Provider</th>
                <th className="p-3">Capture ID</th>
                <th className="p-3">Env</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">No activation payments yet.</td></tr>
              ) : items.map((r) => {
                const it = r as Record<string, unknown>;
                const created = it.created_at ? new Date(it.created_at as string).toLocaleString() : '—';
                const env = String(it.provider_environment || '');
                return (
                  <tr key={String(it.id)} className="border-t hover:bg-muted/40 align-top">
                    <td className="p-3 whitespace-nowrap">{created}</td>
                    <td className="p-3">
                      {it.channel_slug ? (
                        <Link href={`/channel/${String(it.channel_slug)}`} className="text-primary hover:underline">{String(it.channel_name)}</Link>
                      ) : String(it.channel_name)}
                    </td>
                    <td className="p-3">{String(it.owner_masked ?? '—')}</td>
                    <td className="p-3 tabular-nums">{dollars(it.amount_captured_minor as number)}</td>
                    <td className="p-3 tabular-nums">{dollars(it.provider_fee_minor as number)}</td>
                    <td className="p-3 tabular-nums">{dollars(it.provider_net_minor as number)}</td>
                    <td className="p-3 tabular-nums">{dollars(it.wavelead_credit_minor as number)}</td>
                    <td className="p-3"><StatusBadge status={String(it.status)} /></td>
                    <td className="p-3"><Badge variant="outline">{String(it.activation_status ?? '—')}</Badge></td>
                    <td className="p-3">{String(it.provider || '').toUpperCase()}</td>
                    <td className="p-3 font-mono text-xs">{String(it.provider_capture_id_masked ?? '—')}</td>
                    <td className="p-3">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${env === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{env || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Read-only reporting. This surface intentionally has no payout, edit, or payment-mutation controls.
          Provider order/capture references are masked. The $1.00 charge is server-authoritative and not editable from Admin.
        </p>
      </main>
      <Footer />
    </div>
  );
}
