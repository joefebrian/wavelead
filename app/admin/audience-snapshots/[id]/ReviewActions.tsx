'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'illegible', label: 'Screenshot too blurry / cropped' },
  { value: 'watermark_missing', label: 'Missing WhatsApp UI watermark' },
  { value: 'suspected_edit', label: 'Image looks edited' },
  { value: 'wrong_channel', label: 'Screenshot is from a different channel' },
  { value: 'stale_evidence', label: 'Screenshot is too old' },
  { value: 'inconsistent_count', label: 'Follower count did not match the screenshot' },
  { value: 'insufficient_evidence', label: 'Not enough evidence to verify' },
  { value: 'other', label: 'Other' },
];

export default function ReviewActions({ snapshotId }: { snapshotId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'verify' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('illegible');
  const [err, setErr] = useState<string | null>(null);

  async function post(kind: 'verify' | 'reject') {
    setErr(null); setBusy(kind);
    try {
      const body = kind === 'verify' ? { review_note: note.trim() || null } : { rejection_reason: reason, review_note: note.trim() || null };
      const res = await fetch(`/api/admin/audience-snapshots/${snapshotId}/${kind}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rb = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(rb?.error?.message || `${kind} failed`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-4 wh-card p-5" data-testid="review-actions">
      <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Take action</div>

      <div className="mt-3 space-y-2">
        <div className="text-sm font-medium">Rejection reason (only used on reject)</div>
        <select data-testid="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <div className="text-sm font-medium mt-2">Admin note (internal, optional)</div>
        <textarea data-testid="review-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      </div>

      {err && <div className="mt-3 inline-flex items-center gap-1 text-sm text-rose-600"><AlertTriangle className="h-4 w-4" /> {err}</div>}

      <div className="mt-4 flex gap-2 flex-wrap">
        <Button data-testid="verify-btn" onClick={() => post('verify')} disabled={busy !== null} className="gap-1.5">
          {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Verify
        </Button>
        <Button data-testid="reject-btn" onClick={() => post('reject')} disabled={busy !== null} variant="destructive" className="gap-1.5">
          {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
          Reject
        </Button>
      </div>
    </section>
  );
}
