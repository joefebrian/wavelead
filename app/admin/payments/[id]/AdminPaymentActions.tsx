'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function AdminPaymentActions({ paymentId, refunds, refundable }: { paymentId: string; refunds: Array<{ id: string; status: string; requested_amount_minor: number }>; refundable: { refundable_usd_micros: number; refundable_amount_minor: number; has_open_request: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pending = refunds.find((r) => r.status === 'pending' || r.status === 'processing');
  async function reconcile() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/payments/${paymentId}/reconcile`, { method: 'POST' });
      const j = await r.json();
      setMsg(j.ok ? `Reconciled: ${j.data.action}` : `Failed: ${j.error}`);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function openRefund() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/payments/${paymentId}/refunds`, { method: 'POST' });
      const j = await r.json();
      setMsg(j.ok ? `Refund request opened for $${(refundable.refundable_amount_minor/100).toFixed(2)}` : `Failed: ${j.error}`);
      router.refresh();
    } finally { setBusy(false); }
  }
  async function execute(refundId: string) {
    if (!confirm('Execute PayPal refund now? This is irreversible.')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/refunds/${refundId}/execute`, { method: 'POST' });
      const j = await r.json();
      setMsg(j.ok ? `Refund executed: ${j.data.refund.status}` : `Failed: ${j.error}`);
      router.refresh();
    } finally { setBusy(false); }
  }
  const canOpenRefund = !pending && refundable.refundable_amount_minor > 0 && !refundable.has_open_request;
  return (
    <div className="mt-6 wh-card p-5">
      <h2 className="font-semibold mb-3">Actions</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={reconcile} disabled={busy} data-testid="admin-reconcile">Reconcile with provider</Button>
        {canOpenRefund && <Button onClick={openRefund} disabled={busy} data-testid="admin-open-refund">Open refund request (${(refundable.refundable_amount_minor/100).toFixed(2)})</Button>}
        {pending && <Button onClick={() => execute(pending.id)} disabled={busy} data-testid="admin-execute-refund">Execute PayPal refund now</Button>}
      </div>
      {msg && <div className="mt-3 text-sm" role="status">{msg}</div>}
    </div>
  );
}
