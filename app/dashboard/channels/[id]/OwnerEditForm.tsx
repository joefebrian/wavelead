'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

interface Initial { short_description: string; description: string; website_url: string; logo_url: string; cover_url: string; primary_language: string; }
interface Props { channelId: string; initial: Initial; }

export default function OwnerEditForm({ channelId, initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update<K extends keyof Initial>(k: K, v: Initial[K]) { setValues((s) => ({ ...s, [k]: v })); }

  async function save() {
    setError(null); setBusy(true); setSaved(false);
    try {
      const r = await fetch(`/api/me/channels/${channelId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_description: values.short_description || undefined,
          description: values.description || undefined,
          website_url: values.website_url || '',
          logo_url: values.logo_url || '',
          cover_url: values.cover_url || '',
          primary_language: values.primary_language || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not save.'); return; }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  }

  return (
    <section className="wh-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">Public profile</h2>
        <p className="text-xs text-muted-foreground">Changes are applied immediately.</p>
      </div>
      <div className="mt-4 grid gap-4">
        <div>
          <Label htmlFor="short">Short description</Label>
          <Input id="short" maxLength={180} value={values.short_description} onChange={(e) => update('short_description', e.target.value)} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{values.short_description.length}/180</p>
        </div>
        <div>
          <Label htmlFor="desc">Description</Label>
          <Textarea id="desc" rows={4} maxLength={2000} value={values.description} onChange={(e) => update('description', e.target.value)} className="mt-1.5" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="website">Website URL</Label>
            <Input id="website" type="url" value={values.website_url} onChange={(e) => update('website_url', e.target.value)} className="mt-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">Changing the website <em>domain</em> requires a sensitive change request below.</p>
          </div>
          <div>
            <Label htmlFor="lang">Primary language</Label>
            <Input id="lang" placeholder="e.g. en, id, hi" value={values.primary_language} onChange={(e) => update('primary_language', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="logo">Logo URL</Label>
            <Input id="logo" type="url" value={values.logo_url} onChange={(e) => update('logo_url', e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="cover">Cover image URL</Label>
            <Input id="cover" type="url" value={values.cover_url} onChange={(e) => update('cover_url', e.target.value)} className="mt-1.5" />
          </div>
        </div>
      </div>

      {error && <div className="mt-3 text-sm text-destructive flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5" /> {error}</div>}
      {saved && <div className="mt-3 text-sm text-primary flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Saved.</div>}

      <div className="mt-5 flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Saving…</> : 'Save changes'}</Button>
        <Button variant="ghost" onClick={() => setValues(initial)} disabled={busy}>Reset</Button>
      </div>
    </section>
  );
}
