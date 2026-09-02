'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function BrandRequestRevisionButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (notes.trim().length < 3) { setErr('Please provide at least a short revision note.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/request-revision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ revision_notes: notes.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to request revision');
      setDone(true);
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (done) return <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Revision requested</span>;

  if (!open) {
    return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Request Revision</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2">
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Explain what needs to change (visible to the channel owner)"
        className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Sending…</> : 'Send Revision Request'}
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        {err && <span className="text-xs text-rose-600">{err}</span>}
      </div>
    </form>
  );
}
