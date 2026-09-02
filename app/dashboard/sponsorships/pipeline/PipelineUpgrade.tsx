'use client';

// Pipeline upgrade state for Free users. Reuses the existing pro_waitlist
// commercial-lead endpoint (no new email architecture).
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';

export default function PipelineUpgrade({ userEmail }: { userEmail: string | null }) {
  const [email, setEmail] = useState(userEmail || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy || !email) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/commercial-leads/pro-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const j = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wh-card p-6 mt-8 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent" data-testid="pipeline-upgrade">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2"><Lock className="h-5 w-5 text-primary" /></div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Sponsorship Pipeline</h2>
            <Badge className="uppercase tracking-wider text-[10px]"><Sparkles className="h-3 w-3 mr-1" /> Pro</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-md">
            Manage active sponsorship opportunities from request to completion in one workflow —
            stale-request alerts, delivery due-soon indicators, and a clear kanban across every channel.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Free plan continues to see every sponsorship request and complete jobs normally on the existing sponsorship pages.</p>
        </div>
      </div>
      {done ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700" data-testid="pipeline-waitlist-done">
          <CheckCircle2 className="h-4 w-4" />
          You&apos;re on the Pro waitlist. We&apos;ll notify you when it launches.
        </div>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            data-testid="pipeline-waitlist-email"
          />
          <Button onClick={join} disabled={busy || !email} data-testid="pipeline-join-waitlist">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Joining…</> : 'Join Pro Waitlist'}
          </Button>
        </div>
      )}
      {error && <div className="mt-2 text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
    </section>
  );
}
