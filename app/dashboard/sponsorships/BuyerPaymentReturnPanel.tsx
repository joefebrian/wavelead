'use client';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

type Phase = 'idle' | 'processing' | 'confirmed' | 'cancelled' | 'failed';

/**
 * Renders a banner when the buyer returns from PayPal to /dashboard/sponsorships.
 * Triggers server-side capture (browser return is NEVER payment proof), then
 * polls the attempt status until captured / failed / times out.
 * Reloads the page once server confirms success so the order list reflects paid.
 */
export default function BuyerPaymentReturnPanel() {
  const params = useSearchParams();
  const status = params.get('status');       // 'return' | 'cancelled'
  const attemptId = params.get('attempt');
  const paymentKind = params.get('payment'); // 'paypal'
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (paymentKind !== 'paypal' || !attemptId) return;
    if (status === 'cancelled') {
      setPhase('cancelled');
      return;
    }
    if (status !== 'return') return;

    let cancelled = false;
    setPhase('processing');
    (async () => {
      try {
        // Trigger server-side capture. Both the return callback and PayPal's
        // CHECKOUT.ORDER.APPROVED webhook may race here — the server is idempotent.
        try {
          await fetch(`/api/marketplace/payments/${attemptId}/capture`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          });
        } catch { /* still poll; webhook may resolve it */ }

        // Poll (max ~30s).
        const deadline = Date.now() + 30_000;
        while (!cancelled && Date.now() < deadline) {
          const r = await fetch(`/api/marketplace/payments/${attemptId}`, { credentials: 'include' });
          const j = await r.json();
          const st: string | undefined = j?.data?.attempt?.status;
          const errMsg: string | null = j?.data?.attempt?.failure_message_safe ?? null;
          if (st === 'captured') {
            if (!cancelled) {
              setPhase('confirmed');
              setTimeout(() => { window.location.href = '/dashboard/sponsorships'; }, 900);
            }
            return;
          }
          if (st === 'failed' || st === 'cancelled' || st === 'reversed') {
            if (!cancelled) {
              setPhase('failed');
              setMessage(errMsg || 'Payment could not be completed. Please try again.');
            }
            return;
          }
          await new Promise((rs) => setTimeout(rs, 1500));
        }
        if (!cancelled) {
          // Still processing after timeout — leave UX explicit.
          setMessage('Payment is still being confirmed. Refresh in a moment.');
        }
      } catch (e) {
        if (!cancelled) {
          setPhase('failed');
          setMessage((e as Error).message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [attemptId, status, paymentKind]);

  if (paymentKind !== 'paypal' || !attemptId) return null;
  if (phase === 'idle') return null;

  return (
    <div className="mb-4" data-testid="paypal-return-panel">
      {phase === 'processing' && (
        <div className="wh-card p-4 flex items-center gap-3 border-l-4 border-l-primary">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <div className="font-medium">Processing payment…</div>
            <div className="text-xs text-muted-foreground">Please wait while we confirm your PayPal payment with our servers. This can take a few seconds.</div>
          </div>
        </div>
      )}
      {phase === 'confirmed' && (
        <div className="wh-card p-4 flex items-center gap-3 border-l-4 border-l-emerald-500">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <div className="font-medium text-emerald-700">Payment confirmed</div>
            <div className="text-xs text-muted-foreground">Your sponsorship is now paid. The channel owner can begin work.</div>
          </div>
        </div>
      )}
      {phase === 'cancelled' && (
        <div className="wh-card p-4 flex items-center gap-3 border-l-4 border-l-slate-400">
          <XCircle className="h-5 w-5 text-slate-500" />
          <div>
            <div className="font-medium">Payment was not completed</div>
            <div className="text-xs text-muted-foreground">You cancelled the PayPal checkout. You can retry payment on the order below.</div>
          </div>
        </div>
      )}
      {phase === 'failed' && (
        <div className="wh-card p-4 flex items-center gap-3 border-l-4 border-l-rose-500">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
          <div>
            <div className="font-medium text-rose-700">Payment could not be completed</div>
            <div className="text-xs text-muted-foreground">{message || 'Please try again or contact support.'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
