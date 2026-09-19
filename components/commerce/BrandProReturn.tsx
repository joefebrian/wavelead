'use client';
// M17.1 — Brand Pro browser-return handler.
//
// Brand Pro's PayPal return_url is /dashboard/billing?brand_pro=<id>&status=paid.
// Nothing was listening there, so a paid term never finalized from the browser
// return. This component asks the server to capture. The BROWSER RETURN GRANTS
// NOTHING: brandProService only grants a 30-day term when PayPal confirms the
// capture (internal_status === 'paid').
import { useEffect, useState } from 'react';
import { ga4Track } from '@/components/analytics/GoogleAnalytics';

export default function BrandProReturn() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'active' | 'pending' | 'error'>('idle');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let orderId: string | null = null;
    let status: string | null = null;
    try {
      const sp = new URLSearchParams(window.location.search);
      orderId = sp.get('brand_pro');
      status = sp.get('status');
    } catch { return; }
    if (!orderId) return;
    if (status === 'cancelled') { setPhase('pending'); setDetail('Brand Pro checkout was cancelled. Nothing was charged.'); return; }
    if (status !== 'paid') return;

    (async () => {
      setPhase('working');
      try {
        const r = await fetch('/api/brand-pro/capture', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: orderId }),
        });
        const j = await r.json();
        const plan = j?.data?.state?.membership?.plan;
        const end = j?.data?.state?.membership?.period_end_at;
        if (plan === 'brand_pro') {
          ga4Track('brand_pro_activated');
          setPhase('active');
          setDetail(end ? `Brand Pro is active until ${new Date(end).toLocaleDateString()}. Renewal is manual — PayPal will not charge you automatically.` : 'Brand Pro is active.');
        } else {
          setPhase('pending');
          setDetail('We are still confirming your payment with PayPal. Refresh in a moment — access opens only once PayPal confirms.');
        }
      } catch {
        setPhase('error');
        setDetail('We could not confirm the payment automatically. Refresh in a moment.');
      } finally {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('brand_pro');
          url.searchParams.delete('status');
          window.history.replaceState({}, '', url.toString());
        } catch { /* ignore */ }
      }
    })();
  }, []);

  if (phase === 'idle') return null;
  const tone = phase === 'active'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : phase === 'error'
    ? 'border-destructive/40 bg-destructive/5 text-destructive'
    : 'border-border bg-muted/40';

  return (
    <div className={`mb-5 rounded-md border p-3 text-sm ${tone}`} data-testid="brand-pro-return">
      {phase === 'working' ? 'Confirming your Brand Pro payment with PayPal…' : detail}
    </div>
  );
}
