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
import Link from 'next/link';
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
  live_checkout_enabled: boolean;
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

export default function ChannelActivationCard({ channelId, channelSlug, ownershipUnderReview = false, returnActivationId, returnStatus }: {
  channelId: string;
  channelSlug: string;
  ownershipUnderReview?: boolean;
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
  //   • Sandbox environment → show the CTA for previewing / QA.
  //   • Live + LIVE checkout capability ON (CHANNEL_OWNER_ACTIVATION_LIVE_ENABLED)
  //     → show the CTA (activation officially rolled out).
  //   • Live + activation required ON → show the CTA.
  //   • Live + both flags OFF → positioning-only tile ("Rollout Coming Soon")
  //     so owners see $1 pricing but can never be routed into a live 503.
  // NOTE: this only governs which SURFACE renders. Ownership + payment
  // eligibility is still fully enforced server-side (start endpoint stays
  // fail-closed) and gated below by `ownershipApproved`.
  const isLive = state.environment === 'live';
  const showActiveCta = state.environment === 'sandbox' || state.activation_required || state.live_checkout_enabled;
  const isActive = state.activation_status === 'active';
  const isPending = state.activation_status === 'pending' || state.latest_payment?.status === 'captured_pending_fee';
  const isRevoked = state.activation_status === 'revoked';
  // M13.1 — grandfathered owners (activation_status='not_required') must never
  // see the "$1 required" activation banner even after
  // CHANNEL_OWNER_ACTIVATION_REQUIRED is flipped ON. They already carry public
  // Owner Verified state via lib/utils/sanitize.ts.
  const isNotRequired = state.activation_status === 'not_required';
  const ownershipApproved = state.ownership_status === 'approved';

  if (!showActiveCta) {
    // Positioning-only tile. No fetch to /start, no 503 exposure.
    return (
      <section className="wh-card p-5" data-testid="activation-card">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Verified Owner Activation</h2>
          <span className="ml-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] uppercase tracking-wide" data-testid="activation-rollout-pill">Rollout Coming Soon</span>
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
            <div className="mt-1 text-sm font-semibold">$1 per channel <span className="ml-1 text-xs text-muted-foreground font-normal">— coming soon</span></div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Verified Owner Activation is a one-time $1 transaction that unlocks the public &ldquo;Owner Verified&rdquo; state
          for your channel. Rollout to production is coming soon — until then your existing verified status remains
          intact and no action is required.
        </p>
      </section>
    );
  }

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
          {isLive ? (
            <span className="ml-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] uppercase tracking-wide" data-testid="activation-environment-pill">Live</span>
          ) : (
            <span className="ml-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] uppercase tracking-wide" data-testid="activation-environment-pill">Sandbox</span>
          )}
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
              isNotRequired && ownershipApproved ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Owner Verified</> :
              isPending ? <>Pending confirmation</> :
              <>Complete Verified Owner Activation</>}
          </div>
        </div>
      </div>

      {!isActive && !isNotRequired && ownershipApproved && (
        <div className="mt-4 rounded-md bg-primary/5 border border-primary/30 p-4" data-testid="activation-approved-notice">
          <div className="text-sm font-semibold flex items-center gap-1.5" data-testid="activation-approved-heading">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ownership Approved
          </div>
          <p className="mt-1 text-sm">
            Complete your one-time <span className="font-semibold">$1 activation</span> to unlock <span className="font-semibold">Owner Verified</span>.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Button onClick={onStart} disabled={busy !== null || !ownershipApproved} data-testid="start-activation-btn" className="gap-1.5">
              {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Activate Owner Verified — $1
            </Button>
            {state.latest_payment && state.latest_payment.status === 'captured_pending_fee' && (
              <Button variant="outline" onClick={onManualCapture} disabled={busy !== null} className="gap-1.5" data-testid="refresh-activation-btn">
                {busy === 'capture' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                Refresh status
              </Button>
            )}
            {isLive ? (
              <span className="text-xs text-muted-foreground">One-time $1.00 USD charge · processed securely via PayPal · not a subscription.</span>
            ) : (
              <span className="text-xs text-muted-foreground">Sandbox activation transaction — no real money is charged.</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            After PayPal processing fees, the remaining amount is returned to your account as WaveLead Credit.
          </p>
        </div>
      )}

      {!isActive && isNotRequired && ownershipApproved && (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 text-sm" data-testid="activation-not-required-panel">
          <div className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Owner Verified — no activation required</div>
          <div className="mt-1 text-xs">Your ownership is verified and your public Owner Verified badge is active. The $1 activation does not apply to your channel.</div>
        </div>
      )}

      {!isActive && !ownershipApproved && ownershipUnderReview && (
        <div className="mt-4 rounded-md bg-primary/5 border border-primary/30 p-4" data-testid="ownership-under-review-panel">
          <div className="text-sm font-semibold flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-primary" /> Under Review</div>
          <div className="mt-1 text-sm text-muted-foreground">
            WaveLead is reviewing your channel listing and ownership verification. You&rsquo;ll be able to activate your
            verified owner profile once it&rsquo;s approved — no further action needed right now.
          </div>
        </div>
      )}

      {!isActive && !ownershipApproved && !ownershipUnderReview && (
        <div className="mt-4 rounded-md bg-muted/40 border border-border p-4" data-testid="ownership-required-panel">
          <div className="text-sm">
            Complete ownership verification before activating this channel. Choose Fast Verification ($1, no second manual
            review) or free Manual Verification with ownership evidence.
          </div>
          <div className="mt-3">
            <Link href={`/dashboard/channels/${channelId}/verify`}>
              <Button className="gap-1.5" data-testid="ownership-pending-cta">
                <ShieldCheck className="h-4 w-4" />
                Complete Ownership Verification First
              </Button>
            </Link>
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
