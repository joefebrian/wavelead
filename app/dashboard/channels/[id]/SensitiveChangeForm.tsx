'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

interface Initial { name: string; whatsapp_url: string; website_url: string; country_code: string; category_slug: string; }
interface CategoryOpt { slug: string; name: string; }

interface Props { channelId: string; initial: Initial; categories: CategoryOpt[]; hasPending: boolean; }

export default function SensitiveChangeForm({ channelId, initial, categories, hasPending }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const diff = useMemo(() => {
    const changes: Record<string, string> = {};
    (Object.keys(initial) as (keyof Initial)[]).forEach((k) => {
      if ((values[k] || '') !== (initial[k] || '')) changes[k] = values[k];
    });
    return changes;
  }, [values, initial]);

  async function submit() {
    setError(null); setSuccess(false); setBusy(true);
    try {
      const r = await fetch(`/api/me/channels/${channelId}/change-request`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: diff }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not submit change request.'); return; }
      setSuccess(true);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="wh-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-600" /> Sensitive changes</h2>
        <p className="text-xs text-muted-foreground">Reviewed by a moderator before going live.</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Editing your channel name, WhatsApp URL, website domain, category or country requires moderator approval to protect this Verified listing.</p>

      {hasPending && (
        <div className="mt-3 border border-amber-300 bg-amber-50 rounded-md p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <div>A change request is already pending review. Submit new changes after the current one is decided.</div>
        </div>
      )}

      <div className="mt-4 grid gap-4">
        <div>
          <Label htmlFor="cname">Channel name</Label>
          <Input id="cname" value={values.name} onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="cwa">WhatsApp Channel URL</Label>
          <Input id="cwa" type="url" value={values.whatsapp_url} onChange={(e) => setValues((s) => ({ ...s, whatsapp_url: e.target.value }))} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="cwebsite">Website (domain change)</Label>
          <Input id="cwebsite" type="url" value={values.website_url} onChange={(e) => setValues((s) => ({ ...s, website_url: e.target.value }))} className="mt-1.5" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ccountry">Country code</Label>
            <Input id="ccountry" maxLength={2} placeholder="e.g. ID, US" value={values.country_code} onChange={(e) => setValues((s) => ({ ...s, country_code: e.target.value.toUpperCase() }))} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ccat">Primary category</Label>
            <select id="ccat" value={values.category_slug} onChange={(e) => setValues((s) => ({ ...s, category_slug: e.target.value }))} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
              <option value="">— keep current —</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {Object.keys(diff).length > 0 && (
        <div className="mt-4 border border-border rounded-md p-3 text-xs">
          <div className="font-semibold mb-1">Requested changes</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {Object.entries(diff).map(([k, v]) => (
              <li key={k}><span className="font-mono">{k}</span> → <span className="font-semibold">{v || <em>(empty)</em>}</span></li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-destructive flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5" /> {error}</div>}
      {success && <div className="mt-3 text-sm text-primary flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Change request submitted — awaiting moderator review.</div>}

      <div className="mt-5 flex gap-2">
        <Button onClick={submit} disabled={busy || hasPending || Object.keys(diff).length === 0}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Submitting…</> : 'Submit for review'}
        </Button>
        <Button variant="ghost" onClick={() => setValues(initial)} disabled={busy}>Reset</Button>
      </div>
    </section>
  );
}
