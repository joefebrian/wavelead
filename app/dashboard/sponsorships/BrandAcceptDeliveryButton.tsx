'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function BrandAcceptDeliveryButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onAccept() {
    if (busy) return;
    if (!confirm('Confirm that the delivery meets the sponsorship brief? This completes the order and makes the owner\'s earnings eligible for external payout.')) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/accept-delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to accept');
      setDone(true);
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (done) {
    return <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Accepted</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAccept} disabled={busy}>
        {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Accepting…</> : 'Accept Delivery'}
      </Button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}
