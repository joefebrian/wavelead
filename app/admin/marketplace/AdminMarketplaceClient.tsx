'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { MarketplaceOrder, MarketplacePaymentMethod } from '@/lib/types';

interface Kpis {
  orders_total: number; awaiting_payment: number; paid: number;
  gross_gmv_minor: number; finalized_net_minor: number;
  finalized_owner_earnings_minor: number; finalized_commission_minor: number;
  pending_fee_reconciliation: number;
}

export default function AdminMarketplaceClient({ initialItems, initialKpis }: { initialItems: MarketplaceOrder[]; initialKpis: Kpis }) {
  const [items, setItems] = useState(initialItems);
  const [kpis, setKpis] = useState(initialKpis);
  const [busy, setBusy] = useState<string | null>(null);
  const [modalOrder, setModalOrder] = useState<MarketplaceOrder | null>(null);
  const [feeModalOrder, setFeeModalOrder] = useState<MarketplaceOrder | null>(null);

  async function refetch() {
    const r = await fetch('/api/admin/marketplace/orders', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) { setItems(j.data.items); setKpis(j.data.kpis); }
  }

  const $$ = (m: number | null | undefined) => m == null ? '—' : `$${(m / 100).toFixed(2)}`;

  return (
    <div className="mt-6 space-y-6" data-testid="admin-marketplace">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Orders total" v={String(kpis.orders_total)} />
        <Kpi label="Awaiting payment" v={String(kpis.awaiting_payment)} accent="amber" />
        <Kpi label="Paid" v={String(kpis.paid)} accent="emerald" />
        <Kpi label="Pending fee reconciliation" v={String(kpis.pending_fee_reconciliation)} accent="rose" />
        <Kpi label="Gross GMV" v={$$(kpis.gross_gmv_minor)} />
        <Kpi label="Finalized Net" v={$$(kpis.finalized_net_minor)} />
        <Kpi label="Owner Earnings (finalized)" v={$$(kpis.finalized_owner_earnings_minor)} accent="emerald" />
        <Kpi label="WaveLead Commission (finalized)" v={$$(kpis.finalized_commission_minor)} accent="primary" />
      </div>

      <div className="wh-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="px-3 py-2">Order</th><th className="px-3 py-2">Buyer</th><th className="px-3 py-2">Channel</th>
            <th className="px-3 py-2">Package</th><th className="px-3 py-2">Gross</th><th className="px-3 py-2">Fee</th>
            <th className="px-3 py-2">Net</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Com.</th>
            <th className="px-3 py-2">Status</th><th className="px-3 py-2">Econ.</th><th className="px-3 py-2">Actions</th>
          </tr></thead>
          <tbody>
            {items.length === 0 && (<tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">No orders.</td></tr>)}
            {items.map((o) => (
              <tr key={o.id} className="border-b border-border/60" data-testid={`order-row-${o.id}`}>
                <td className="px-3 py-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
                <td className="px-3 py-2">{o.brief.company_name}</td>
                <td className="px-3 py-2">{o.snapshot?.channel_name || o.channel_slug}</td>
                <td className="px-3 py-2 text-xs">{o.package_type}</td>
                <td className="px-3 py-2">{$$(o.snapshot?.gross_price_minor ?? o.quoted_price_minor)}</td>
                <td className="px-3 py-2">{o.gateway_fee_minor === null ? <Badge className="bg-rose-100 text-rose-800 text-xs">unknown</Badge> : $$(o.gateway_fee_minor)}</td>
                <td className="px-3 py-2">{$$(o.net_transaction_value_minor)}</td>
                <td className="px-3 py-2">{$$(o.owner_earnings_minor)}</td>
                <td className="px-3 py-2">{$$(o.wavelead_commission_minor)}</td>
                <td className="px-3 py-2"><Badge className={statusStyle(o.status)}>{o.status}</Badge></td>
                <td className="px-3 py-2"><Badge className={econStyle(o.economics_status)}>{o.economics_status.replace(/_/g, ' ')}</Badge></td>
                <td className="px-3 py-2">
                  {o.status === 'awaiting_payment' && (
                    <Button size="sm" onClick={() => setModalOrder(o)}>Confirm payment</Button>
                  )}
                  {o.economics_status === 'pending_fee_reconciliation' && (
                    <Button size="sm" variant="outline" onClick={() => setFeeModalOrder(o)}>Reconcile fee</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOrder && (
        <ConfirmPaymentModal order={modalOrder} onClose={() => setModalOrder(null)}
          onDone={async () => { setModalOrder(null); await refetch(); }}
          busy={busy} setBusy={setBusy} />
      )}
      {feeModalOrder && (
        <ReconcileFeeModal order={feeModalOrder} onClose={() => setFeeModalOrder(null)}
          onDone={async () => { setFeeModalOrder(null); await refetch(); }}
          busy={busy} setBusy={setBusy} />
      )}
    </div>
  );
}

function ConfirmPaymentModal({ order, onClose, onDone, busy, setBusy }: { order: MarketplaceOrder; onClose: () => void; onDone: () => Promise<void>; busy: string | null; setBusy: (b: string | null) => void }) {
  const [method, setMethod] = useState<MarketplacePaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 16));
  const [feeMode, setFeeMode] = useState<'unknown' | 'zero' | 'positive'>('unknown');
  const [feeUsd, setFeeUsd] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy('confirm'); setError(null);
    try {
      const gateway_fee_minor = feeMode === 'unknown' ? null : feeMode === 'zero' ? 0 : Math.round(Number(feeUsd) * 100);
      const r = await fetch(`/api/admin/marketplace/orders/${order.id}/confirm-payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          payment_method: method,
          payment_reference: reference.trim(),
          amount_received_minor: order.snapshot?.gross_price_minor,
          currency: 'USD',
          payment_received_at: new Date(receivedAt).toISOString(),
          gateway_fee_minor,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Confirm failed');
      await onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="wh-card bg-background p-5 max-w-lg w-full">
        <div className="font-semibold text-lg">Confirm payment received</div>
        <p className="mt-1 text-xs text-muted-foreground">Manual/off-platform confirmation. Do not fabricate a PayPal ID.</p>
        <div className="mt-3 grid gap-3">
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as MarketplacePaymentMethod)} className={inputCls}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="paypal_manual">PayPal (manual)</option>
              <option value="other">Other</option>
            </select></label>
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Payment reference (invoice / txn id)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="INV-2026-01234" /></label>
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Payment received at</span>
            <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inputCls} /></label>
          <div>
            <div className="block text-xs uppercase text-muted-foreground mb-1">Gateway / processing fee</div>
            <div className="flex gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-sm"><input type="radio" checked={feeMode === 'unknown'} onChange={() => setFeeMode('unknown')} />Unknown</label>
              <label className="flex items-center gap-1 text-sm"><input type="radio" checked={feeMode === 'zero'} onChange={() => setFeeMode('zero')} />$0.00 (known zero)</label>
              <label className="flex items-center gap-1 text-sm"><input type="radio" checked={feeMode === 'positive'} onChange={() => setFeeMode('positive')} />Known amount</label>
            </div>
            {feeMode === 'positive' && (
              <input type="number" step={0.01} value={feeUsd} onChange={(e) => setFeeUsd(e.target.value)} placeholder="7.50" className={inputCls + ' mt-2'} />
            )}
            {feeMode === 'unknown' && <p className="mt-1 text-xs text-rose-700">Owner Payable will be BLOCKED until you reconcile the actual fee.</p>}
          </div>
          {error && <div className="text-sm text-rose-600">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>Cancel</Button>
            <Button onClick={submit} disabled={busy !== null || !reference.trim() || (feeMode === 'positive' && !feeUsd)}>
              {busy === 'confirm' ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Confirming…</> : 'Confirm payment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReconcileFeeModal({ order, onClose, onDone, busy, setBusy }: { order: MarketplaceOrder; onClose: () => void; onDone: () => Promise<void>; busy: string | null; setBusy: (b: string | null) => void }) {
  const [feeUsd, setFeeUsd] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy('reconcile'); setError(null);
    try {
      const r = await fetch(`/api/admin/marketplace/orders/${order.id}/reconcile-fee`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ gateway_fee_minor: Math.round(Number(feeUsd) * 100) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      await onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="wh-card bg-background p-5 max-w-sm w-full">
        <div className="font-semibold text-lg">Reconcile gateway fee</div>
        <p className="mt-1 text-xs text-muted-foreground">Enter the actual processing fee for order <span className="font-mono">{order.id.slice(0, 8)}</span>. This appends a GATEWAY_FEE_RECONCILED event and finalizes economics.</p>
        <label className="block text-sm mt-3"><span className="block text-xs uppercase text-muted-foreground mb-1">Actual fee (USD)</span>
          <input type="number" step={0.01} value={feeUsd} onChange={(e) => setFeeUsd(e.target.value)} placeholder="7.50" className={inputCls} /></label>
        {error && <div className="text-sm text-rose-600 mt-2">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>Cancel</Button>
          <Button onClick={submit} disabled={busy !== null || !feeUsd}>
            {busy === 'reconcile' ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />…</> : 'Reconcile'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, v, accent }: { label: string; v: string; accent?: 'amber' | 'emerald' | 'primary' | 'rose' }) {
  const map: Record<string, string> = { amber: 'text-amber-700', emerald: 'text-emerald-700', primary: 'text-primary', rose: 'text-rose-700' };
  return (<div className="wh-card p-3"><div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div><div className={`mt-1 text-lg font-bold ${accent ? map[accent] : ''}`}>{v}</div></div>);
}
const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
function statusStyle(s: string): string {
  if (s === 'paid') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
function econStyle(s: string): string {
  if (s === 'finalized') return 'bg-emerald-100 text-emerald-800';
  if (s === 'pending_fee_reconciliation') return 'bg-rose-100 text-rose-800';
  if (s === 'accepted_awaiting_payment') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}
