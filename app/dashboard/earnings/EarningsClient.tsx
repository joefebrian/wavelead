'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

type Bucket = 'pending' | 'available' | 'paid_out' | 'blocked';

interface EarningsRow {
  id: string;
  channel_slug: string;
  buyer_company: string;
  completed_at: string | Date | null;
  payout_available_at: string | Date | null;
  payout_requested_at: string | Date | null;
  owner_earnings_minor: number | null;
  owner_payable_status: string;
  bucket: Bucket;
}

interface PayoutMethod {
  id: string;
  method: 'paypal';
  paypal_email_masked: string;
  is_active: boolean;
  is_verified: boolean;
  verified_at: string | Date | null;
}

interface EarningsData {
  settlement_hold_hours: number;
  payout_method: PayoutMethod | null;
  totals: {
    pending_earnings_minor: number;
    available_payout_minor: number;
    paid_out_minor: number;
    blocked_minor: number;
    currency: 'USD';
  };
  orders: EarningsRow[];
}

const $$ = (m: number | null | undefined) => m == null ? '—' : `$${(m / 100).toFixed(2)}`;
const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

export default function EarningsClient({ initial }: { initial: EarningsData }) {
  const [data, setData] = useState<EarningsData>(initial);
  const [payoutEmail, setPayoutEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refetch() {
    const r = await fetch('/api/owner/earnings', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) setData(j.data);
  }

  async function upsertMethod(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/owner/payout-method', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ paypal_email: payoutEmail.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to save');
      setDevCode(j.data.verification_code_dev || null);
      setMsg({ ok: true, text: j.data.verification_required
        ? 'Verification code generated. In production this will be emailed to the address above — for this MVP the code is shown below. Enter it to complete verification.'
        : 'Payout method saved and verified.' });
      await refetch();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !verifyCode.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/owner/payout-method/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ verification_code: verifyCode.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Verification failed');
      setMsg({ ok: true, text: 'Payout account verified.' });
      setVerifyCode(''); setDevCode(null);
      await refetch();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function requestPayout(orderId: string) {
    if (busy) return;
    if (!confirm('Request an external payout for this order? This does not send money — a WaveLead operator will complete the payout.')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/request-payout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: '{}',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Request failed');
      setMsg({ ok: true, text: 'Payout requested. WaveLead will complete this externally.' });
      await refetch();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const method = data.payout_method;
  const canRequest = !!method && method.is_verified;
  const nowMs = Date.now();

  return (
    <div className="mt-6 space-y-6" data-testid="owner-earnings">
      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending Earnings" value={$$(data.totals.pending_earnings_minor)} accent="amber" note={`Held for ${data.settlement_hold_hours}h after buyer accept`} />
        <KpiCard label="Available for Payout" value={$$(data.totals.available_payout_minor)} accent="emerald" note="Settlement hold elapsed" />
        <KpiCard label="Paid Out" value={$$(data.totals.paid_out_minor)} accent="primary" note="External payouts already completed" />
        <KpiCard label="On Hold" value={$$(data.totals.blocked_minor)} accent="rose" note="Reconciliation required — contact WaveLead" />
      </div>

      {/* Payment Protection copy */}
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
        <div className="font-semibold text-primary">Payment Protection</div>
        <div className="mt-0.5 text-muted-foreground">
          Your sponsorship payment has been secured by WaveLead. Your earnings become eligible for payout after the brand accepts
          your delivery or WaveLead resolves an eligible delivery review in your favor. A {data.settlement_hold_hours}h settlement
          hold applies before you can request payout. WaveLead does not provide regulated escrow, bank, wallet, or custodian services.
        </div>
      </div>

      {/* Payout method */}
      <section className="wh-card p-4" data-testid="payout-method">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-base font-semibold">PayPal Payout Account</div>
          {method && (method.is_verified
            ? <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="h-3 w-3 mr-1" />Verified</Badge>
            : <Badge className="bg-amber-100 text-amber-800"><AlertTriangle className="h-3 w-3 mr-1" />Unverified</Badge>)}
        </div>
        {method && (
          <div className="mt-2 text-sm">
            <span className="text-muted-foreground">Payout destination: </span>
            <span className="font-mono">{method.paypal_email_masked}</span>
          </div>
        )}
        <form onSubmit={upsertMethod} className="mt-3 space-y-2 max-w-md">
          <label className="block text-sm">
            <span className="block text-xs uppercase text-muted-foreground mb-1">{method ? 'Change PayPal email' : 'Add PayPal email'}</span>
            <input type="email" placeholder="you@paypal.com" value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} className={inputCls} />
          </label>
          <Button size="sm" type="submit" disabled={busy || !payoutEmail.trim()}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</> : 'Save & Send Verification'}
          </Button>
        </form>

        {method && !method.is_verified && (
          <form onSubmit={verify} className="mt-4 space-y-2 max-w-md" data-testid="verify-form">
            <label className="block text-sm">
              <span className="block text-xs uppercase text-muted-foreground mb-1">Enter verification code</span>
              <input type="text" inputMode="numeric" pattern="\d{6}" placeholder="6-digit code" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} className={inputCls} />
            </label>
            {devCode && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
                <div className="font-semibold text-amber-900">MVP: verification code (production will email this)</div>
                <div className="mt-1 font-mono text-amber-900">{devCode}</div>
              </div>
            )}
            <Button size="sm" type="submit" disabled={busy || !verifyCode.trim()}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Verifying…</> : 'Verify Payout Account'}
            </Button>
          </form>
        )}

        {msg && <div className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</div>}
      </section>

      {/* Per-order history */}
      <section className="wh-card p-4">
        <div className="text-base font-semibold">Order Earnings</div>
        {data.orders.length === 0 && <div className="mt-3 text-sm text-muted-foreground">No sponsorship orders yet.</div>}
        <div className="mt-3 divide-y divide-border/60">
          {data.orders.map((o) => {
            const availableAtMs = o.payout_available_at ? new Date(o.payout_available_at).getTime() : null;
            const availableSoon = o.bucket === 'pending' && availableAtMs;
            return (
              <div key={o.id} className="py-3 flex items-start justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{o.buyer_company} <span className="text-xs text-muted-foreground">· {o.channel_slug}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {o.completed_at ? `Completed ${new Date(o.completed_at).toLocaleDateString()}` : `Status ${o.owner_payable_status.replace(/_/g, ' ')}`}
                    {availableSoon && ` · Available at ${new Date(availableAtMs!).toLocaleString()}`}
                    {o.payout_requested_at && ` · Payout requested ${new Date(o.payout_requested_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{$$(o.owner_earnings_minor)}</div>
                  <div className="mt-1"><BucketBadge b={o.bucket} /></div>
                  {o.bucket === 'available' && !o.payout_requested_at && (
                    <div className="mt-2">
                      <Button size="sm" onClick={() => requestPayout(o.id)}
                        disabled={busy || !canRequest}
                        title={canRequest ? '' : 'Verify a PayPal payout account first'}>
                        Request Payout
                      </Button>
                    </div>
                  )}
                  {o.bucket === 'available' && o.payout_requested_at && (
                    <div className="mt-2 text-xs text-muted-foreground">Awaiting WaveLead payout</div>
                  )}
                </div>
                {void nowMs}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function BucketBadge({ b }: { b: Bucket }) {
  const cls =
    b === 'available' ? 'bg-emerald-100 text-emerald-800' :
    b === 'paid_out' ? 'bg-primary/10 text-primary' :
    b === 'blocked' ? 'bg-rose-100 text-rose-800' :
    'bg-amber-100 text-amber-800';
  const label =
    b === 'available' ? 'Available' :
    b === 'paid_out' ? 'Paid out' :
    b === 'blocked' ? 'On hold' :
    'Pending';
  return <Badge className={cls}>{label}</Badge>;
}

function KpiCard({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: 'emerald' | 'amber' | 'primary' | 'rose' }) {
  const border =
    accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/40' :
    accent === 'amber' ? 'border-amber-200 bg-amber-50/40' :
    accent === 'rose' ? 'border-rose-200 bg-rose-50/40' :
    'border-primary/20 bg-primary/5';
  return (
    <div className={`rounded-md border ${border} p-4`}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}
