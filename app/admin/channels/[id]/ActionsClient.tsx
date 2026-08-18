'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, XCircle, PencilLine, AlertTriangle } from 'lucide-react';

interface Props {
  channelId: string;
  currentStatus: string;
  currentValues: { name: string; short_description: string; description: string };
}

const REJECT_REASONS: { value: string; label: string }[] = [
  { value: 'duplicate', label: 'Duplicate listing' },
  { value: 'invalid_url', label: 'Invalid / broken URL' },
  { value: 'spam', label: 'Spam' },
  { value: 'misleading', label: 'Misleading' },
  { value: 'unsupported_content', label: 'Unsupported content' },
  { value: 'missing_information', label: 'Missing information' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
];

export default function ModerationActions({ channelId, currentStatus, currentValues }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [pending, startTransition] = useTransition();
  const [showEdit, setShowEdit] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [edits, setEdits] = useState({ ...currentValues });
  const [rejectReason, setRejectReason] = useState('spam');
  const [rejectNotes, setRejectNotes] = useState('');

  const editingChanged =
    edits.name.trim() !== currentValues.name ||
    edits.short_description.trim() !== currentValues.short_description ||
    (edits.description.trim() || '') !== (currentValues.description || '');

  async function approve(withEdits: boolean) {
    setError(null);
    setBusy('approve');
    try {
      const body: Record<string, unknown> = {};
      if (withEdits && editingChanged) {
        body.edits = {};
        if (edits.name.trim() !== currentValues.name) (body.edits as Record<string, unknown>).name = edits.name.trim();
        if (edits.short_description.trim() !== currentValues.short_description) (body.edits as Record<string, unknown>).short_description = edits.short_description.trim();
        if (edits.description.trim() !== currentValues.description) (body.edits as Record<string, unknown>).description = edits.description.trim();
      }
      const r = await fetch(`/api/admin/channels/${channelId}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Approval failed'); return; }
      setShowEdit(false);
      startTransition(() => router.refresh());
    } catch { setError('Network error.'); }
    finally { setBusy(null); }
  }

  async function reject() {
    setError(null);
    setBusy('reject');
    try {
      const r = await fetch(`/api/admin/channels/${channelId}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason, notes: rejectNotes.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Rejection failed'); return; }
      setShowReject(false);
      startTransition(() => router.refresh());
    } catch { setError('Network error.'); }
    finally { setBusy(null); }
  }

  const canAct = currentStatus === 'pending_review';

  return (
    <div className="wh-card p-5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Moderation actions</span>
        {!canAct && (
          <span className="text-xs text-muted-foreground">Current status: {currentStatus}. Approve/reject only from Pending Review.</span>
        )}
      </div>

      {error && (
        <div className="mt-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => approve(false)} disabled={!canAct || busy !== null || pending}>
          {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />} Approve
        </Button>
        <Button variant="outline" onClick={() => setShowEdit((v) => !v)} disabled={!canAct || busy !== null || pending}>
          <PencilLine className="h-4 w-4 mr-1.5" /> Edit & Approve
        </Button>
        <Button variant="destructive" onClick={() => setShowReject((v) => !v)} disabled={!canAct || busy !== null || pending}>
          <XCircle className="h-4 w-4 mr-1.5" /> Reject
        </Button>
      </div>

      {showEdit && canAct && (
        <div className="mt-5 grid gap-3 border-t border-border/60 pt-5">
          <div>
            <Label htmlFor="e-name">Name</Label>
            <Input id="e-name" value={edits.name} onChange={(e) => setEdits((s) => ({ ...s, name: e.target.value }))} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="e-short">Short description</Label>
            <Input id="e-short" value={edits.short_description} onChange={(e) => setEdits((s) => ({ ...s, short_description: e.target.value }))} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="e-desc">Description</Label>
            <Textarea id="e-desc" value={edits.description} onChange={(e) => setEdits((s) => ({ ...s, description: e.target.value }))} className="mt-1.5" rows={4} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => approve(true)} disabled={busy !== null || pending}>
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />} Save edits & Approve
            </Button>
            <Button variant="ghost" onClick={() => { setEdits({ ...currentValues }); setShowEdit(false); }}>Cancel</Button>
          </div>
        </div>
      )}

      {showReject && canAct && (
        <div className="mt-5 grid gap-3 border-t border-border/60 pt-5">
          <div>
            <Label htmlFor="r-reason">Reason</Label>
            <select id="r-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
              {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="r-notes">Internal notes (optional)</Label>
            <Textarea id="r-notes" value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} rows={3} className="mt-1.5" placeholder="Only moderators see this. Explain what changed and any context." />
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={reject} disabled={busy !== null || pending}>
              {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />} Confirm rejection
            </Button>
            <Button variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
