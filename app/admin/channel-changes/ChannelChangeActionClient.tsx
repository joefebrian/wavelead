'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function ChannelChangeActionClient({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [, startTransition] = useTransition();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function call(kind: 'approve' | 'reject') {
    setBusy(kind); setError(null);
    try {
      const r = await fetch(`/api/admin/channel-changes/${requestId}/${kind}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moderator_notes: notes.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Action failed.'); return; }
      startTransition(() => router.refresh());
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-2 border-t border-border/60 pt-3">
      <Textarea rows={2} placeholder="Optional moderator notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={() => call('approve')} disabled={busy !== null}>{busy === 'approve' ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Approving…</> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve & apply</>}</Button>
        <Button variant="destructive" onClick={() => call('reject')} disabled={busy !== null}>{busy === 'reject' ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Rejecting…</> : <><XCircle className="h-4 w-4 mr-1.5" /> Reject</>}</Button>
      </div>
    </div>
  );
}
