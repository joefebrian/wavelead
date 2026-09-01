'use client';
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2 } from 'lucide-react';

/**
 * M03.7 — Admin "Verify Current Owner" surface for the channel detail page.
 *
 * This exists in addition to the same action inside a claim's detail page so
 * that a moderator can verify an already-assigned owner even when NO claim
 * record exists (e.g. legacy channels where owner_id was set outside the
 * ownership-claim flow). It calls the exact same server method:
 *   POST /api/admin/channels/:id/verify-current-owner
 * which routes to claimModerationService.verifyCurrentOwner and never
 * fabricates a claim owned by the acting admin.
 */
export default function ChannelOwnerVerifyClient({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [, startTransition] = useTransition();

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/channels/${channelId}/verify-current-owner`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moderator_notes: notes.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setErr(j?.error || 'Action failed'); return; }
      setOk(true); setOpen(false);
      startTransition(() => router.refresh());
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="admin-verify-current-owner-panel">
      {!open && (
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={busy || ok} data-testid="admin-verify-current-owner-btn">
          <CheckCircle2 className="h-4 w-4 mr-1.5" /> Verify Current Owner
        </Button>
      )}
      {open && (
        <div className="grid gap-3">
          <div className="text-sm text-muted-foreground">
            This action <span className="font-semibold">preserves the existing owner</span> and flips <code>verification_status</code> to <code>verified</code>. It does NOT create a claim owned by you. Use this only when the currently-assigned owner is legitimate.
          </div>
          <div>
            <Label htmlFor="verify-owner-notes">Admin notes (internal, optional)</Label>
            <Textarea id="verify-owner-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Evidence source or ticket reference." className="mt-1.5" />
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy} data-testid="admin-verify-current-owner-confirm">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Verifying…</> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Confirm verify current owner</>}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {ok && <div className="mt-3 text-sm text-emerald-700">Ownership verified. Refresh to see the updated status.</div>}
      {err && <div className="mt-3 text-sm text-rose-600">{err}</div>}
    </div>
  );
}
