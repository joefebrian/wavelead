'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type EType = 'website' | 'youtube' | 'instagram' | 'tiktok' | 'x' | 'facebook' | 'other';
interface EvidenceItem { evidence_type: EType; evidence_url: string; note: string | null; }

interface Props {
  claimId: string;
  initialNote: string;
  initialMethod: 'domain' | 'social' | 'manual';
  initialEvidence: EvidenceItem[];
}

export default function ClaimResubmitClient({ claimId, initialNote, initialMethod, initialEvidence }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const [evidence, setEvidence] = useState<EvidenceItem[]>(initialEvidence.map((e) => ({ ...e, note: e.note ?? '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<EvidenceItem>) { setEvidence((prev) => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e)); }
  function add() { setEvidence((prev) => [...prev, { evidence_type: 'youtube', evidence_url: '', note: '' }]); }
  function remove(i: number) { setEvidence((prev) => prev.filter((_, idx) => idx !== i)); }

  async function resubmit() {
    setError(null); setBusy(true);
    try {
      const r = await fetch(`/api/claims/${claimId}/resubmit`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_method: initialMethod,
          claimant_note: note.trim(),
          evidence_urls: evidence.filter((e) => e.evidence_url.trim()).map((e) => ({ evidence_type: e.evidence_type, evidence_url: e.evidence_url.trim(), note: (e.note || '').trim() || null })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not resubmit.'); return; }
      setOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  if (!open) return <div className="mt-3"><Button size="sm" onClick={() => setOpen(true)}>Update evidence & resubmit</Button></div>;

  return (
    <div className="mt-4 grid gap-3 border-t border-border/60 pt-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your response</div>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" placeholder="Explain what changed / provide the requested info." />
        <p className="mt-1 text-xs text-muted-foreground">{note.length}/2000 · minimum 10 characters.</p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence</div>
          <Button variant="outline" size="sm" onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <div className="mt-2 grid gap-2">
          {evidence.map((e, i) => (
            <div key={i} className="border border-border rounded-md p-2 grid gap-1.5">
              <div className="flex gap-1.5 flex-col sm:flex-row">
                <select value={e.evidence_type} onChange={(ev) => update(i, { evidence_type: ev.target.value as EType })} className="rounded-md border border-input bg-transparent px-2 py-1 text-sm sm:w-32">
                  <option value="website">Website</option>
                  <option value="youtube">YouTube</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="x">X</option>
                  <option value="facebook">Facebook</option>
                  <option value="other">Other</option>
                </select>
                <Input placeholder="https://…" value={e.evidence_url} onChange={(ev) => update(i, { evidence_url: ev.target.value })} />
                <Button variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
              <Input placeholder="Optional note" value={e.note ?? ''} onChange={(ev) => update(i, { note: ev.target.value })} />
            </div>
          ))}
        </div>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={resubmit} disabled={busy || note.trim().length < 10}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Resubmitting…</> : 'Resubmit for review'}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
