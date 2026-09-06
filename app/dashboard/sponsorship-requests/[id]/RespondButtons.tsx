'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface Props { requestId: string; }

export default function RespondButtons({ requestId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function respond(action: 'accept' | 'decline') {
    if (busy) return;
    setError(null); setBusy(action);
    try {
      const r = await fetch(`/api/me/sponsorship-requests/${requestId}/respond`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not update request'); return; }
      startTransition(() => router.refresh());
    } catch { setError('Network error. Please try again.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="mt-6 wh-card p-5" data-testid="respond-panel">
      <div className="text-sm font-semibold">Respond to this request</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Accepting confirms interest. WaveLead will then coordinate the booking, escrow the payment, and manage delivery. You keep 90% of the applicable net; WaveLead retains 10%. You&apos;re not committed to a fixed price until the booking is confirmed.
      </p>
      {error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => respond('accept')} disabled={busy !== null || pending} data-testid="respond-accept-btn" className="gap-1.5">
          {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept
        </Button>
        <Button variant="outline" onClick={() => respond('decline')} disabled={busy !== null || pending} data-testid="respond-decline-btn" className="gap-1.5">
          {busy === 'decline' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Decline
        </Button>
      </div>
    </div>
  );
}
