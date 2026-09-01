'use client';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { MarketplaceOrder, MarketplaceOwnerPayout, MarketplacePaymentMethod } from '@/lib/types';

interface Kpis {
  orders_total: number; awaiting_payment: number; paid: number;
  gross_gmv_minor: number; finalized_net_minor: number;
  finalized_owner_earnings_minor: number; finalized_commission_minor: number;
  pending_fee_reconciliation: number;
}
type Tab = 'orders' | 'payables' | 'payouts';

export default function AdminMarketplaceClient({ initialItems, initialKpis }: { initialItems: MarketplaceOrder[]; initialKpis: Kpis }) {
  const [tab, setTab] = useState<Tab>('orders');
  const [items, setItems] = useState(initialItems);
  const [kpis, setKpis] = useState(initialKpis);
  const [busy, setBusy] = useState<string | null>(null);
  const [modalOrder, setModalOrder] = useState<MarketplaceOrder | null>(null);
  const [feeModalOrder, setFeeModalOrder] = useState<MarketplaceOrder | null>(null);
  const [payoutModalOrder, setPayoutModalOrder] = useState<MarketplaceOrder | null>(null);
  const [payables, setPayables] = useState<MarketplaceOrder[]>([]);
  const [payouts, setPayouts] = useState<MarketplaceOwnerPayout[]>([]);
  const [payableFilter, setPayableFilter] = useState<'all' | 'eligible_for_payout' | 'paid_out' | 'blocked_fee_reconciliation' | 'submitted_for_review' | 'manual_reconciliation_required'>('eligible_for_payout');

  async function refetch() {
    const r = await fetch('/api/admin/marketplace/orders', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) { setItems(j.data.items); setKpis(j.data.kpis); }
  }
  async function refetchPayables() {
    const qs = payableFilter === 'all' ? '' : `?status=${payableFilter}`;
    const r = await fetch(`/api/admin/marketplace/payables${qs}`, { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) setPayables(j.data.items);
  }
  async function refetchPayouts() {
    const r = await fetch('/api/admin/marketplace/payouts', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) setPayouts(j.data.items);
  }

  useEffect(() => { if (tab === 'payables') refetchPayables(); }, [tab, payableFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'payouts') refetchPayouts(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const $$ = (m: number | null | undefined) => m == null ? '—' : `$${(m / 100).toFixed(2)}`;

  return (
    <div className="mt-6 space-y-6" data-testid="admin-marketplace">
      <div className="flex gap-2 border-b border-border pb-3 flex-wrap">
        <button className={tabClass(tab === 'orders')} onClick={() => setTab('orders')}>Orders</button>
        <button className={tabClass(tab === 'payables')} onClick={() => setTab('payables')}>Owner Payables</button>
        <button className={tabClass(tab === 'payouts')} onClick={() => setTab('payouts')}>Payouts</button>
      </div>

      {tab === 'orders' && (
        <>
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
        </>
      )}

      {tab === 'payables' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs uppercase text-muted-foreground">Filter:</span>
            {(['eligible_for_payout', 'paid_out', 'blocked_fee_reconciliation', 'submitted_for_review', 'manual_reconciliation_required', 'all'] as const).map((s) => (
              <button key={s} className={`text-xs px-2 py-1 rounded-md border ${payableFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                onClick={() => setPayableFilter(s)}>{s.replace(/_/g, ' ')}</button>
            ))}
            <Button variant="outline" size="sm" onClick={refetchPayables} className="ml-auto">Refresh</Button>
          </div>
          <div className="wh-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Order</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Completed</th><th className="px-3 py-2">Owner Earnings</th>
                <th className="px-3 py-2">Payable Status</th><th className="px-3 py-2">Actions</th>
              </tr></thead>
              <tbody>
                {payables.length === 0 && (<tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No payables.</td></tr>)}
                {payables.map((o) => (
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.owner_user_id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{o.snapshot?.channel_name || o.channel_slug}</td>
                    <td className="px-3 py-2 text-xs">{o.completed_at ? new Date(o.completed_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2">{$$(o.owner_earnings_minor)}</td>
                    <td className="px-3 py-2"><Badge className={payableStyle(o.owner_payable_status)}>{o.owner_payable_status.replace(/_/g, ' ')}</Badge></td>
                    <td className="px-3 py-2">
                      {o.owner_payable_status === 'eligible_for_payout' && (
                        <Button size="sm" onClick={() => setPayoutModalOrder(o)} data-testid={`open-record-external-payout-${o.id}`}>Record External Payout</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'payouts' && (
        <div className="wh-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2">Order</th><th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Reference</th><th className="px-3 py-2">Paid At</th>
              <th className="px-3 py-2">Recorded By</th>
            </tr></thead>
            <tbody>
              {payouts.length === 0 && (<tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No payouts recorded yet.</td></tr>)}
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono text-xs">{p.order_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.owner_user_id.slice(0, 8)}</td>
                  <td className="px-3 py-2 font-semibold text-emerald-700">{$$(p.amount_minor)}</td>
                  <td className="px-3 py-2 text-xs">{p.payout_method}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.payout_reference_display}</td>
                  <td className="px-3 py-2 text-xs">{new Date(p.paid_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.created_by.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
      {payoutModalOrder && (
        <RecordPayoutModal order={payoutModalOrder} onClose={() => setPayoutModalOrder(null)}
          onDone={async () => { setPayoutModalOrder(null); await refetchPayables(); await refetchPayouts(); }}
          busy={busy} setBusy={setBusy} />
      )}
    </div>
  );
}

/**
 * B2.1 — Manual payout safety.
 * WaveLead does NOT transfer money from this action. It only records a payout
 * that already happened externally (bank / manual PayPal). Because it flips
 * owner_payable_status → paid_out, the admin must type the exact phrase below.
 * The client check is UX only — the server independently requires the same
 * phrase and rejects anything else with 400 (no payout row, no event, no
 * order mutation).
 */
const PAYOUT_CONFIRM_PHRASE = 'PAYOUT COMPLETED EXTERNALLY';

function RecordPayoutModal({ order, onClose, onDone, busy, setBusy }: { order: MarketplaceOrder; onClose: () => void; onDone: () => Promise<void>; busy: string | null; setBusy: (b: string | null) => void }) {
  const [method, setMethod] = useState<MarketplacePaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ order: MarketplaceOrder; payout: MarketplaceOwnerPayout } | null>(null);

  // Server-authoritative amount. Rendered read-only; never submitted.
  const amountMinor = order.owner_earnings_minor ?? 0;
  const amountUsd = `$${(amountMinor / 100).toFixed(2)}`;
  const phraseOk = confirmText === PAYOUT_CONFIRM_PHRASE;

  async function submit() {
    setBusy('payout'); setError(null);
    try {
      const r = await fetch(`/api/admin/marketplace/orders/${order.id}/record-payout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          payout_method: method,
          payout_reference: reference.trim(),
          paid_at: new Date(paidAt).toISOString(),
          notes: notes.trim() || null,
          // Sent verbatim — the server is the authority on this phrase.
          confirm: confirmText,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not record external payout');
      setRecorded({ order: j.data.order, payout: j.data.payout });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (recorded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
        <div className="wh-card bg-background p-5 max-w-md w-full my-8" data-testid="external-payout-success">
          <div className="font-semibold text-lg text-emerald-700">External payout recorded</div>
          <p className="mt-1 text-xs text-muted-foreground">A payout completed outside WaveLead has been logged against this order. No transfer was initiated by WaveLead.</p>
          <dl className="mt-4 grid gap-2 text-sm">
            <Row k="Payable status" v={<Badge className={payableStyle(recorded.order.owner_payable_status)}>{recorded.order.owner_payable_status.replace(/_/g, ' ')}</Badge>} />
            <Row k="Payout amount" v={<span className="font-mono font-semibold">{`$${(recorded.payout.amount_minor / 100).toFixed(2)} ${recorded.payout.currency}`}</span>} />
            <Row k="Payout method" v={<span className="text-xs">{recorded.payout.payout_method}</span>} />
            <Row k="Payout reference" v={<span className="font-mono text-xs">{recorded.payout.payout_reference_display}</span>} />
            <Row k="Paid at" v={<span className="text-xs">{new Date(recorded.payout.paid_at).toLocaleString()}</span>} />
            <Row k="Recorded by" v={<span className="font-mono text-xs">{recorded.payout.created_by.slice(0, 8)}</span>} />
          </dl>
          <div className="flex justify-end mt-4">
            <Button onClick={() => { void onDone(); }} data-testid="external-payout-success-close">Done</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="wh-card bg-background p-5 max-w-md w-full my-8" data-testid="record-external-payout-modal">
        <div className="font-semibold text-lg">Record External Payout</div>
        <p className="mt-1 text-xs text-muted-foreground">
          WaveLead does not send money from this action. Use this only after the owner payout has been completed externally.
        </p>

        {/* Read-only, server-authoritative summary */}
        <dl className="mt-3 rounded-md border border-border bg-muted/40 p-3 grid gap-1.5 text-sm" data-testid="payout-summary">
          <Row k="Owner" v={<span className="font-mono text-xs">{order.owner_user_id.slice(0, 8)}</span>} />
          <Row k="Channel" v={<span className="text-xs">{order.snapshot?.channel_name || order.channel_slug}</span>} />
          <Row k="Order" v={<span className="font-mono text-xs">{order.id.slice(0, 8)}</span>} />
          <Row k="Owner Earnings" v={<span className="font-mono">{amountUsd}</span>} />
          <Row k="Currency" v={<span className="font-mono text-xs">USD</span>} />
          <Row k="Payout Amount" v={<span className="font-mono font-semibold text-emerald-700" data-testid="payout-amount-readonly">{amountUsd}</span>} />
          <p className="text-[11px] text-muted-foreground mt-1">Payout amount is derived by the server from finalized owner earnings and cannot be edited.</p>
        </dl>

        <div className="mt-3 grid gap-3">
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Payout method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as MarketplacePaymentMethod)} className={inputCls}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="paypal_manual">PayPal (manual)</option>
              <option value="other">Other</option>
            </select></label>
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Payout reference (external txn / batch id)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="OUT-2026-001234" data-testid="payout-reference" /></label>
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Paid at</span>
            <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Notes (optional)</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></label>

          <div className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="payout-warning">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                This action records a payout that has already happened externally. It does not initiate a bank or PayPal transfer.
              </p>
            </div>
            <label className="block text-sm mt-3">
              <span className="block text-xs uppercase text-amber-900 mb-1">Type <span className="font-mono font-semibold">{PAYOUT_CONFIRM_PHRASE}</span> to confirm</span>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputCls} placeholder={PAYOUT_CONFIRM_PHRASE} autoComplete="off" spellCheck={false} data-testid="payout-confirm-phrase" />
            </label>
            {confirmText.length > 0 && !phraseOk && (
              <p className="mt-1 text-[11px] text-rose-700">Phrase does not match exactly (case sensitive).</p>
            )}
          </div>

          {error && <div className="text-sm text-rose-600" data-testid="payout-error">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy !== null}>Cancel</Button>
            <Button onClick={submit} disabled={busy !== null || !reference.trim() || !phraseOk} data-testid="submit-record-external-payout">
              {busy === 'payout' ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Recording…</> : 'Record External Payout'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase text-muted-foreground">{k}</dt>
      <dd className="text-right">{v}</dd>
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
const tabClass = (a: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`;
function statusStyle(s: string): string {
  if (s === 'paid' || s === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'in_progress') return 'bg-indigo-100 text-indigo-800';
  if (s === 'submitted_for_review') return 'bg-violet-100 text-violet-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
function econStyle(s: string): string {
  if (s === 'finalized') return 'bg-emerald-100 text-emerald-800';
  if (s === 'pending_fee_reconciliation') return 'bg-rose-100 text-rose-800';
  if (s === 'accepted_awaiting_payment') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}
function payableStyle(s: string): string {
  if (s === 'eligible_for_payout') return 'bg-emerald-100 text-emerald-800';
  if (s === 'paid_out') return 'bg-primary/15 text-primary';
  if (s === 'blocked_fee_reconciliation') return 'bg-rose-100 text-rose-800';
  if (s === 'submitted_for_review') return 'bg-violet-100 text-violet-800';
  if (s === 'manual_reconciliation_required') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}
