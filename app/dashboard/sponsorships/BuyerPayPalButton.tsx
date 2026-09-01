'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function BuyerPayPalButton({ orderId, amountMinor, currency = 'USD' }: {
  orderId: string;
  amountMinor: number;
  currency?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPay() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/paypal/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not start payment');
      const approve = j.data?.approve_url || j.data?.attempt?.approve_url;
      if (!approve) throw new Error('Payment provider did not return a checkout URL');
      // Hard redirect to PayPal hosted approval.
      window.location.href = approve;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="buyer-paypal-cta">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <div className="font-medium">Ready for payment</div>
        <div className="text-xs mt-0.5">Amount due: <span className="font-mono">${(amountMinor / 100).toFixed(2)} {currency}</span>. Payment is processed on PayPal&apos;s secure hosted checkout.</div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onPay} disabled={busy} className="bg-[#ffc439] text-[#003087] hover:bg-[#f0b833]" data-testid="buyer-paypal-button">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Redirecting to PayPal…</> : 'Pay with PayPal'}
        </Button>
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
