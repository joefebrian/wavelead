'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { SponsorshipLeadStatus } from '@/lib/types';

interface Props { id: string; currentStatus: SponsorshipLeadStatus; currentNotes: string; }

const STATUSES: SponsorshipLeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];

export default function SponsorshipLeadActions({ id, currentStatus, currentNotes }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<SponsorshipLeadStatus>(currentStatus);
  const [notes, setNotes] = useState(currentNotes);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(next: SponsorshipLeadStatus, nextNotes: string | null = notes) {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/admin/sponsorship-leads/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ status: next, admin_notes: nextNotes ?? null }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Failed to update');
      setStatus(next);
      setSaved(true);
      router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 wh-card p-5 space-y-4">
      <div className="text-sm font-semibold">Actions</div>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Button key={s} variant={status === s ? 'default' : 'outline'} size="sm" disabled={busy || status === s} onClick={() => patch(s)}>
            {status === s ? '✓ ' : ''}Mark {s}
          </Button>
        ))}
      </div>
      <div>
        <label className="block text-xs uppercase text-muted-foreground mb-1">Admin notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" placeholder="Internal notes about this lead..." />
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => patch(status, notes)}>{busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</> : 'Save notes'}</Button>
          {saved && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
