'use client';
// M17.1 — OWNERSHIP VERIFICATION landing.
//
// This is now the FIRST screen a new owner sees after "Submit & verify
// ownership". It presents exactly two primary options:
//
//    A. FAST VERIFICATION — $1     (identity + payout + $1, no second review)
//    B. MANUAL VERIFICATION — FREE (evidence, reviewed by a human)
//
// The legacy three-method claim selector is NO LONGER the entry screen. The
// legacy /claim/[slug] surface and its backend stay untouched for ownership
// disputes, reclaims and legacy claims.
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, Loader2, AlertTriangle, ShieldCheck, Zap, FileSearch } from 'lucide-react';
import { ga4Track } from '@/components/analytics/GoogleAnalytics';
import FastVerificationForm, { type IdentityForm } from './FastVerificationForm';
import ManualVerificationForm from './ManualVerificationForm';

interface VState {
  step: string;
  listing_approved: boolean;
  fast_amount_minor: number;
  currency: string;
  requirements: { listing_approved: boolean; payment_finalized: boolean; identity_complete: boolean; declaration_accepted: boolean; payout_configured: boolean };
  verification_status: string | null;
  activation_status: string;
  approve_url?: string | null;
}

interface Identity {
  full_legal_name: string; country_code: string; city: string; email: string;
  mobile_number: string; role_in_channel: string; company_name: string | null;
}

type View = 'choice' | 'fast' | 'manual';

export default function VerifyClient({
  channelId, channelSlug, initialState, initialIdentity, declarationText, initialView = 'choice',
}: {
  channelId: string;
  channelSlug: string;
  initialState: VState | null;
  initialIdentity: Identity | null;
  declarationText: string;
  initialView?: View;
}) {
  const [state, setState] = useState<VState | null>(initialState);
  const [view, setView] = useState<View>(initialView);
  const [capturing, setCapturing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const identityForm: IdentityForm = {
    full_legal_name: initialIdentity?.full_legal_name || '',
    country_code: initialIdentity?.country_code || '',
    city: initialIdentity?.city || '',
    email: initialIdentity?.email || '',
    mobile_number: initialIdentity?.mobile_number || '',
    role_in_channel: initialIdentity?.role_in_channel || 'owner',
    company_name: initialIdentity?.company_name || '',
    declaration_accepted: false,
  };

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/owner/channels/${channelId}/verification/state`, { credentials: 'include' });
      const j = await r.json();
      if (j?.data) setState(j.data as VState);
    } catch { /* keep previous state */ }
  }, [channelId]);

  // Browser return from PayPal. NON-AUTHORITATIVE: this only asks the server
  // to call PayPal. The server decides whether the capture is real, and
  // verification still requires identity + declaration + payout.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const pid = sp.get('activation');
    if (!pid || sp.get('status') !== 'paid') return;
    (async () => {
      setCapturing(true);
      try {
        await fetch(`/api/owner/channels/${channelId}/verification/capture`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_id: pid }),
        });
        ga4Track('fast_verification_payment_completed', { channel: channelSlug });
        await refresh();
        const url = new URL(window.location.href);
        url.searchParams.delete('activation');
        url.searchParams.delete('status');
        window.history.replaceState({}, '', url.toString());
      } catch { setErr('We could not confirm the payment automatically. Refresh in a moment.'); }
      finally { setCapturing(false); }
    })();
  }, [channelId, channelSlug, refresh]);

  const req = state?.requirements;
  const verified = state?.step === 'verified';
  const listingApproved = !!state?.listing_approved;

  if (verified) {
    return (
      <div className="mt-6 wh-card p-6 border-emerald-300 bg-emerald-50/60" data-testid="verify-complete">
        <div className="inline-flex items-center gap-2 font-semibold text-emerald-900"><ShieldCheck className="h-5 w-5" /> Owner Verified</div>
        <p className="mt-1 text-sm text-emerald-900/80">Monetization and payouts are unlocked for this channel.</p>
        <div className="mt-3">
          <Link href={`/dashboard/channels/${channelId}/monetization`}><Button size="sm">Open monetization</Button></Link>
        </div>
      </div>
    );
  }

  if (view === 'fast') {
    return (
      <FastVerificationForm
        channelId={channelId}
        channelSlug={channelSlug}
        listingApproved={listingApproved}
        payoutConfigured={!!req?.payout_configured}
        paymentFinalized={!!req?.payment_finalized}
        declarationText={declarationText}
        initialForm={identityForm}
        onBack={() => setView('choice')}
        onRefresh={refresh}
      />
    );
  }

  if (view === 'manual') {
    return (
      <ManualVerificationForm
        channelId={channelId}
        channelSlug={channelSlug}
        listingApproved={listingApproved}
        declarationText={declarationText}
        initialForm={identityForm}
        onBack={() => setView('choice')}
      />
    );
  }

  return (
    <div className="mt-6 space-y-5" data-testid="verification-choice">
      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex gap-2" data-testid="verify-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{err}
        </div>
      )}
      {capturing && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm flex gap-2 items-center" data-testid="verify-capturing">
          <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment with PayPal…
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Option A — paid fast path */}
        <div className="wh-card p-6 flex flex-col ring-1 ring-primary/40" data-testid="fast-verification-card">
          <div className="inline-flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-primary" /> Fast Verification</div>
          <div className="mt-1 text-2xl font-bold">$1 one-time</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete your owner details, payout setup and one-time $1 verification to activate Owner Verified without waiting for manual review.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            The $1 verification helps deter impersonation, spam and scam attempts.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm flex-1" data-testid="fast-compare">
            <Compare label="No second manual review" />
            <Compare label="Identity + payout + payment" />
            <Compare label="Fastest route to Owner Verified" />
          </ul>
          <Button className="mt-5" onClick={() => setView('fast')} disabled={!listingApproved} data-testid="choose-fast-verification">
            Start Fast Verification — $1
          </Button>
          {!listingApproved && (
            <p className="mt-2 text-xs text-amber-700" data-testid="fast-locked-note">
              Opens as soon as WaveLead approves your channel listing.
            </p>
          )}
          {req && (
            <ul className="mt-4 space-y-1.5 text-xs" data-testid="fast-requirements">
              <Step done={!!req.listing_approved} label="Channel listing approved" />
              <Step done={!!req.identity_complete} label="Owner details completed" />
              <Step done={!!req.payout_configured} label="Payout destination configured" />
              <Step done={!!req.payment_finalized} label="$1 verification payment confirmed" />
            </ul>
          )}
        </div>

        {/* B — MANUAL VERIFICATION (never styled as disabled or second-class) */}
        <div className="wh-card p-6 flex flex-col" data-testid="manual-verification-card">
          <div className="inline-flex items-center gap-2 text-sm font-semibold"><FileSearch className="h-4 w-4 text-primary" /> Manual Verification</div>
          <div className="mt-1 text-2xl font-bold">Free</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Submit your owner details and whatever public ownership evidence you have. A WaveLead reviewer checks it manually.
          </p>
          <ul className="mt-4 space-y-1.5 text-sm flex-1" data-testid="manual-compare">
            <Compare label="Always free — no payment required" />
            <Compare label="Submit ownership evidence" />
            <Compare label="Reviewed manually by WaveLead" />
          </ul>
          <Button className="mt-5" variant="outline" onClick={() => setView('manual')} data-testid="choose-manual-verification">
            Manual Verification — Free
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">Available now, even while your listing is still being reviewed.</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="legacy-claim-link">
        Reporting an ownership dispute or reclaiming a channel already linked to another account?{' '}
        <Link href={`/claim/${channelSlug}`} className="text-primary hover:underline">Use the ownership claim form</Link>.
      </p>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className={done ? '' : 'text-muted-foreground'}>{label}</span>
    </li>
  );
}

function Compare({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <span>{label}</span>
    </li>
  );
}
