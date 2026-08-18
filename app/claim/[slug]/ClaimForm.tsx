'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, AlertTriangle, Plus, Trash2 } from 'lucide-react';

type Method = 'domain' | 'social' | 'manual';

interface EvidenceItem { evidence_type: 'website' | 'youtube' | 'instagram' | 'tiktok' | 'x' | 'facebook' | 'other'; evidence_url: string; note: string; }

interface Props {
  channel: { id: string; slug: string; name: string; website_url: string | null };
  claimantEmail: string;
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return null; }
}

export default function ClaimForm({ channel, claimantEmail }: Props) {
  const websiteDomain = domainOf(channel.website_url);
  const emailDomain = (claimantEmail.split('@')[1] || '').toLowerCase();
  const domainMatch = !!(websiteDomain && emailDomain && websiteDomain === emailDomain);
  const router = useRouter();

  const [method, setMethod] = useState<Method>(domainMatch ? 'domain' : 'social');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<EvidenceItem[]>(
    domainMatch && channel.website_url ? [{ evidence_type: 'website', evidence_url: channel.website_url, note: 'Claimant email domain matches this website.' }] : []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (method === 'domain') return domainMatch;
    if (method === 'social') return evidence.length > 0 && evidence.every((e) => e.evidence_url.trim().length > 0);
    if (method === 'manual') return note.trim().length >= 30;
    return false;
  }, [busy, method, domainMatch, evidence, note]);

  function updateEvidence(i: number, patch: Partial<EvidenceItem>) {
    setEvidence((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeEvidence(i: number) { setEvidence((prev) => prev.filter((_, idx) => idx !== i)); }
  function addEvidence() { setEvidence((prev) => [...prev, { evidence_type: 'youtube', evidence_url: '', note: '' }]); }

  async function submit() {
    setError(null); setBusy(true);
    try {
      const r = await fetch(`/api/claims/${channel.slug}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_method: method,
          claimant_note: note.trim(),
          evidence_urls: evidence.map((e) => ({
            evidence_type: e.evidence_type,
            evidence_url: e.evidence_url.trim(),
            note: e.note.trim() || null,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not submit your claim. Please retry.'); return; }
      setSuccess(true);
      setTimeout(() => router.push('/dashboard/claims'), 800);
    } catch { setError('Network error. Please retry.'); }
    finally { setBusy(false); }
  }

  if (success) return (
    <div className="mt-8 wh-card p-6 text-center">
      <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
      <div className="mt-2 font-semibold">Claim submitted — pending review</div>
      <p className="text-sm text-muted-foreground mt-1">A moderator will review your evidence. You can track its status in <Link href="/dashboard/claims" className="underline">My claims</Link>.</p>
    </div>
  );

  return (
    <div className="mt-8 grid gap-6">
      {/* Method choice */}
      <div className="wh-card p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Choose verification method</div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {([
            { key: 'domain', title: 'Website / Domain', desc: domainMatch ? `Your email matches ${websiteDomain}. Strong signal.` : 'Your email domain does not match the channel website.' },
            { key: 'social', title: 'Official Social', desc: 'Link an official YouTube, IG, TikTok, X or Facebook that references this channel.' },
            { key: 'manual', title: 'Manual proof', desc: 'Explain how you control the channel. Screenshots via URL are supported.' },
          ] as { key: Method; title: string; desc: string }[]).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMethod(m.key)}
              disabled={m.key === 'domain' && !domainMatch}
              className={`text-left rounded-lg border p-3 transition ${method === m.key ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'border-border hover:border-primary/40'} ${m.key === 'domain' && !domainMatch ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="text-sm font-semibold">{m.title}</div>
              <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Domain match summary */}
      {method === 'domain' && (
        <div className="wh-card p-5">
          <div className="text-sm"><span className="font-semibold">Detected match:</span> your account email <code className="text-xs">{claimantEmail}</code> shares the domain <code className="text-xs">{emailDomain}</code> with the channel website <code className="text-xs">{websiteDomain}</code>. This is recorded as a strong signal, but a moderator still reviews every claim before granting ownership.</div>
        </div>
      )}

      {method === 'social' && (
        <div className="wh-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Evidence URLs</div>
            <Button variant="outline" size="sm" onClick={addEvidence}><Plus className="h-4 w-4 mr-1" /> Add evidence</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Add one or more public URLs from your official social channels that reference this WhatsApp Channel (e.g. a pinned post linking to it).</p>
          <div className="mt-4 grid gap-3">
            {evidence.length === 0 && (
              <div className="border border-dashed border-border rounded-md p-4 text-sm text-muted-foreground">No evidence yet — click <span className="font-semibold">Add evidence</span>.</div>
            )}
            {evidence.map((e, i) => (
              <div key={i} className="border border-border rounded-md p-3 grid gap-2">
                <div className="flex gap-2 flex-col sm:flex-row">
                  <select value={e.evidence_type} onChange={(ev) => updateEvidence(i, { evidence_type: ev.target.value as EvidenceItem['evidence_type'] })} className="rounded-md border border-input bg-transparent px-3 py-2 text-sm sm:w-40">
                    <option value="website">Website</option>
                    <option value="youtube">YouTube</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                    <option value="x">X</option>
                    <option value="facebook">Facebook</option>
                    <option value="other">Other</option>
                  </select>
                  <Input placeholder="https://…" value={e.evidence_url} onChange={(ev) => updateEvidence(i, { evidence_url: ev.target.value })} />
                  <Button variant="ghost" size="icon" onClick={() => removeEvidence(i)} title="Remove"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <Textarea placeholder="Optional note about this evidence…" rows={2} value={e.note} onChange={(ev) => updateEvidence(i, { note: ev.target.value })} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wh-card p-5">
        <Label htmlFor="note">Message to reviewers {method === 'manual' && <span className="text-destructive">*</span>}</Label>
        <Textarea id="note" rows={5} placeholder="Explain how you control this WhatsApp Channel: role/title, links to org proof, screenshots hosted online, etc." value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{note.length}/2000 · Only WaveLead moderators can see this message. Do not include private information about others.</p>
      </div>

      {error && (
        <div className="wh-card border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="text-xs text-muted-foreground">Evidence and notes are private. WaveLead moderators review every claim.</div>
        <div className="flex gap-2">
          <Link href={`/channel/${channel.slug}`}><Button variant="ghost">Cancel</Button></Link>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Submitting…</> : 'Submit claim'}
          </Button>
        </div>
      </div>
    </div>
  );
}
