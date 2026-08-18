'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, HelpCircle, Loader2, AlertTriangle } from 'lucide-react';

interface Props { claimId: string; currentStatus: string; }

const REJECT_REASONS = [
  { value: 'insufficient_evidence', label: 'Insufficient evidence' },
  { value: 'evidence_mismatch', label: 'Evidence does not match' },
  { value: 'channel_already_owned', label: 'Channel already owned' },
  { value: 'impersonation', label: 'Impersonation concern' },
  { value: 'duplicate_claim', label: 'Duplicate claim' },
  { value: 'fraud', label: 'Fraud / suspicious activity' },
  { value: 'invalid_information', label: 'Invalid information' },
  { value: 'other', label: 'Other' },
];

export default function ClaimActionsClient({ claimId, currentStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | 'request' | null>(null);
  const [, startTransition] = useTransition();
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [modNotes, setModNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('insufficient_evidence');
  const [rejectNotes, setRejectNotes] = useState('');
  const [reqMessage, setReqMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canActApprove = ['pending', 'needs_information'].includes(currentStatus);
  const canActReject = canActApprove;
  const canActRequest = currentStatus === 'pending';

  async function call(url: string, body: Record<string, unknown>, key: 'approve' | 'reject' | 'request') {
    setError(null); setBusy(key);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Action failed.'); return; }
      setShowApprove(false); setShowReject(false); setShowRequest(false);
      startTransition(() => router.refresh());
    } finally { setBusy(null); }
  }

  return (
    <div className="wh-card p-5">
      <div className="text-sm font-semibold">Moderation actions</div>
      {!canActApprove && (
        <p className="text-xs text-muted-foreground mt-1">Actions available only for Pending or Info Requested claims. Current status: {currentStatus}.</p>
      )}

      {error && <div className="mt-3 text-sm text-destructive flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5" /> {error}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!canActApprove || busy !== null} onClick={() => setShowApprove((v) => !v)}><CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve</Button>
        <Button variant="outline" disabled={!canActRequest || busy !== null} onClick={() => setShowRequest((v) => !v)}><HelpCircle className="h-4 w-4 mr-1.5" /> Request more info</Button>
        <Button variant="destructive" disabled={!canActReject || busy !== null} onClick={() => setShowReject((v) => !v)}><XCircle className="h-4 w-4 mr-1.5" /> Reject</Button>
      </div>

      {showApprove && canActApprove && (
        <div className="mt-5 grid gap-3 border-t border-border/60 pt-4">
          <div>
            <Label htmlFor="a-notes">Moderator notes (internal, optional)</Label>
            <Textarea id="a-notes" rows={3} value={modNotes} onChange={(e) => setModNotes(e.target.value)} className="mt-1.5" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => call(`/api/admin/claims/${claimId}/approve`, { moderator_notes: modNotes.trim() || undefined }, 'approve')} disabled={busy !== null}>
              {busy === 'approve' ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Approving…</> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm approve</>}
            </Button>
            <Button variant="ghost" onClick={() => setShowApprove(false)}>Cancel</Button>
          </div>
          <p className="text-xs text-muted-foreground">On approve: channel.owner_id = claimant, verification_status = verified, other active claims cancelled.</p>
        </div>
      )}

      {showRequest && canActRequest && (
        <div className="mt-5 grid gap-3 border-t border-border/60 pt-4">
          <div>
            <Label htmlFor="r-msg">Message to claimant</Label>
            <Textarea id="r-msg" rows={3} value={reqMessage} onChange={(e) => setReqMessage(e.target.value)} className="mt-1.5" placeholder="Tell the claimant what additional evidence you need. Minimum 10 characters." />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => call(`/api/admin/claims/${claimId}/request-info`, { message: reqMessage.trim() }, 'request')} disabled={busy !== null || reqMessage.trim().length < 10}>
              {busy === 'request' ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending…</> : <><HelpCircle className="h-4 w-4 mr-1.5" /> Send request</>}
            </Button>
            <Button variant="ghost" onClick={() => setShowRequest(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {showReject && canActReject && (
        <div className="mt-5 grid gap-3 border-t border-border/60 pt-4">
          <div>
            <Label htmlFor="r-reason">Reason</Label>
            <select id="r-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
              {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="rj-notes">Moderator notes (internal, optional)</Label>
            <Textarea id="rj-notes" rows={3} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} className="mt-1.5" />
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={() => call(`/api/admin/claims/${claimId}/reject`, { reason: rejectReason, moderator_notes: rejectNotes.trim() || undefined }, 'reject')} disabled={busy !== null}>
              {busy === 'reject' ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Rejecting…</> : <><XCircle className="h-4 w-4 mr-1.5" /> Confirm reject</>}
            </Button>
            <Button variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
