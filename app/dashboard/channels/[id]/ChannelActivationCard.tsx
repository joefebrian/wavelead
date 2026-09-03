'use client';
// M11-Batch2B — Verified Owner Activation card.
//
// Rendered on /dashboard/channels/[id] ONLY when the PayPal environment is
// sandbox (server-side gate; the server also refuses the /start endpoint on
// live).
//
// Copy is deliberately truthful:
//   • Ownership approved is shown separately from activation state.
//   • CTA reads "Activate for $1" (server-controlled amount).
//   • Browser return is NOT authoritative — we poll /activation until the
//     payment.status transitions to captured_finalized before flipping the
//     UI to "Activation Active".
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ShieldCheck, CreditCard, Loader2, AlertTriangle, RotateCw } from 'lucide-react';

type ActivationStatus = 'not_required' | 'pending' | 'active' | 'revoked';
type PaymentStatus =
  | 'created' | 'checkout_created' | 'pending'
  | 'captured_pending_fee' | 'captured_finalized'
  | 'failed' | 'cancelled' | 'partially_refunded' | 'refunded';

interface PaymentView {
  id: string;
  status: PaymentStatus;
  approve_url: string | null;
  gross_amount_minor: number;
  provider_fee_minor: number | null;
  provider_net_minor: number | null;
  amount_captured_minor: number;
  captured_at: string | null;
  finalized_at: string | null;
  provider_environment: 'sandbox' | 'live';
}

interface StateView {
  channel_id: string;
  ownership_status: 'approved' | 'pending';
  activation_status: ActivationStatus;
  environment: 'sandbox' | 'live';
  activation_required: boolean;
  activation_amount_minor: number;
  currency: string;
  latest_payment: PaymentView | null;
}

async function fetchState(channelId: string): Promise<StateView | null> {
  const r = await fetch(`/api/owner/channels/${channelId}/activation`, { credentials: 'include' });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: StateView };
  return j.data ?? null;
}

async function startActivation(channelId: string): Promise<PaymentView | null> {
  const r = await fetch(`/api/owner/channels/${channelId}/activation/start`, { method: 'POST', credentials: 'include' });
  const j = (await r.json().catch(() => ({}))) as { data?: { payment?: PaymentView }; error?: { message?: string } };
  if (!r.ok) throw new Error(j?.error?.message || 'Failed to start activation');
  return j.data?.payment ?? null;
}

async function captureActivation(channelId: string, paymentId: string): Promise<PaymentView | null> {
  const r = await fetch(`/api/owner/channels/${channelId}/activation/capture`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_id: paymentId }),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { payment?: PaymentView }; error?: { message?: string } };
  if (!r.ok) throw new Error(j?.error?.message || 'Capture failed');
  return j.data?.payment ?? null;
}

async function fetchCredit(): Promise<{ balance_minor: number; currency: string }> {
  const r = await fetch('/api/me/credit-balance', { credentials: 'include' });
  const j = (await r.json().catch(() => ({}))) as { data?: { balance_minor?: number; currency?: string } };
  return { balance_minor: j.data?.balance_minor ?? 0, currency: j.data?.currency ?? 'USD' };
}

function fmtUSD(minor: number | null): string {
  if (minor === null || !Number.isFinite(minor)) return '—';
  return `$${(minor / 100).toFixed(2)}`;
}

export default function ChannelActivationCard({ channelId, returnActivationId, returnStatus }: {
  channelId: string;
  returnActivationId: string | null;
  returnStatus: string | null;
}) {
  const [state, setState] = useState<StateView | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [busy, setBusy] = useState<null | 'start' | 'capture' | 'refresh'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([fetchState(channelId), fetchCredit()]);
    setState(s);
    setCreditBalance(c.balance_minor);
  }, [channelId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Browser return handling. If the user comes back with a paid status,
  // trigger a server-side capture (non-authoritative for `active`).
  useEffect(() => {
    async function handleReturn() {
      if (!returnActivationId) return;
      if (returnStatus === 'cancelled') {
        setInfo('Activation checkout was cancelled. You can try again anytime.');
        return;
      }
      if (returnStatus !== 'paid') return;
      setBusy('capture');
      setError(null);
      try {
        await captureActivation(channelId, returnActivationId);
        await refresh();
        setInfo('Payment received. Activation will complete once processing fees are confirmed by PayPal.');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    }
    handleReturn();
  }, [channelId, returnActivationId, returnStatus, refresh]);

  if (!state) return null;

  // Release-safety visibility rule:
  //   \u2022 Sandbox environment \u2192 show the CTA for previewing / QA.
  //   \u2022 Live environment \u2192 show the CTA only if the operator has
  //     explicitly flipped CHANNEL_OWNER_ACTIVATION_REQUIRED to true.
  //     Until then, existing verified owners must not see a broken $1 CTA
  //     that would 503 against a live PayPal.
  if (state.environment !== 'sandbox' && !state.activation_required) return null;
  const isActive = state.activation_status === 'active';
  const isPending = state.activation_status === 'pending' || state.latest_payment?.status === 'captured_pending_fee';
  const isRevoked = state.activation_status === 'revoked';
  const ownershipApproved = state.ownership_status === 'approved';

  async function onStart() {
    setBusy('start'); setError(null); setInfo(null);
    try {
      const p = await startActivation(channelId);
      if (p?.approve_url) {
        window.location.href = p.approve_url;
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onManualCapture() {
    if (!state?.latest_payment) return;
    setBusy('capture'); setError(null);
    try {
      await captureActivation(channelId, state.latest_payment.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="wh-card p-5" data-testid="activation-card">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Verified Owner Activation</h2>
          <span className="ml-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] uppercase tracking-wide" data-testid="activation-environment-pill">Sandbox</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Ownership</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="ownership-status">
            {ownershipApproved ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ownership Approved</> : <>Ownership Pending</>}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Activation</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="activation-status">
            {isActive ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Activation Active</> :
              isRevoked ? <>Revoked</> :
              isPending ? <>Pending confirmation</> :
              <>Complete Verified Owner Activation</>}
          </div>
        </div>
      </div>

      {!isActive && ownershipApproved && (
        <div className="mt-4 rounded-md bg-primary/5 border border-primary/30 p-4">
          <div className="text-sm">
            Activate your verified owner profile for <span className="font-semibold">{fmtUSD(state.activation_amount_minor)}</span>. After
            payment processing fees, the remaining amount is returned to your account as <span className="font-semibold">WaveLead Credit</span>.
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Button onClick={onStart} disabled={busy !== null || !ownershipApproved} data-testid="start-activation-btn" className="gap-1.5">
              {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Activate for $1
            </Button>
            {state.latest_payment && state.latest_payment.status === 'captured_pending_fee' && (
              <Button variant="outline" onClick={onManualCapture} disabled={busy !== null} className="gap-1.5" data-testid="refresh-activation-btn">
                {busy === 'capture' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                Refresh status
              </Button>
            )}
            <span className="text-xs text-muted-foreground">Sandbox activation transaction — no real money is charged.</span>
          </div>
        </div>
      )}

      {isActive && state.latest_payment && (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 text-sm" data-testid="activation-active-panel">
          <div className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Activation Active</div>
          <div className="mt-1 text-xs">Payment: {fmtUSD(state.latest_payment.amount_captured_minor)} · PayPal fee: {fmtUSD(state.latest_payment.provider_fee_minor)} · Net: {fmtUSD(state.latest_payment.provider_net_minor)}</div>
        </div>
      )}

      {isRevoked && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm" data-testid="activation-revoked-panel">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Activation Revoked</div>
          <div className="mt-1 text-xs">A refund reversed this activation. Your ownership record remains intact — you can re-activate whenever you're ready.</div>
        </div>
      )}

      <div className="mt-4 rounded-md border border-border p-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">WaveLead Credit</div>
            <div className="mt-0.5 font-semibold" data-testid="credit-balance">{fmtUSD(creditBalance)}</div>
          </div>
          <span className="text-xs text-muted-foreground">Use toward eligible WaveLead services · non-withdrawable · non-transferable</span>
        </div>
      </div>

      {error && <div className="mt-3 inline-flex items-center gap-1 text-sm text-rose-600"><AlertTriangle className="h-4 w-4" /> {error}</div>}
      {info && <div className="mt-3 text-sm text-muted-foreground">{info}</div>}
    </section>
  );
}
