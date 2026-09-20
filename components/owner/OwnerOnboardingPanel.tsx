'use client';
// M18.1 Phase G/H — Owner onboarding checklist + Sample Work section.
//
// • Checklist is derived server-side from existing domains; nothing here is a
//   new gate on the listing staying public.
// • Rate Card is the primary CTA after approval.
// • Sample Work stores public https links only — no file hosting, and the
//   example cards are clearly labelled templates that are never saved as the
//   creator's real work.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, ExternalLink, Plus, Trash2, Sparkles } from 'lucide-react';

interface SampleWork {
  id: string; title: string; work_type: string; description: string | null;
  content_url: string; brand_name: string | null; published_on: string | null;
}
interface ChecklistItem { key: string; label: string; done: boolean; href: string | null }

const TYPE_LABELS: Record<string, string> = {
  sponsored_post: 'Sponsored Post',
  product_feature: 'Product / Deal Feature',
  affiliate_promotion: 'Affiliate Promotion',
  campaign_announcement: 'Campaign Announcement',
  other: 'Other',
};

const TEMPLATES = [
  { work_type: 'sponsored_post', title: 'Sponsored Post', hint: 'One post introducing a brand to your audience, with a clear disclosure.' },
  { work_type: 'product_feature', title: 'Product / Deal Feature', hint: 'A short feature of a product or a limited-time deal.' },
  { work_type: 'affiliate_promotion', title: 'Affiliate Promotion', hint: 'A recurring affiliate recommendation with your tracked link.' },
  { work_type: 'campaign_announcement', title: 'Campaign Announcement', hint: 'An announcement kicking off a multi-post brand campaign.' },
];

export default function OwnerOnboardingPanel({ channelId }: { channelId: string }) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [works, setWorks] = useState<SampleWork[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', work_type: 'sponsored_post', description: '', content_url: '', brand_name: '', published_on: '' });

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/owner/channels/${channelId}/onboarding`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/owner/channels/${channelId}/sample-work`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      setItems(a?.data?.items || []);
      setWorks(b?.data?.items || []);
    } catch { /* read-only panel */ }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/owner/channels/${channelId}/sample-work`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, work_type: form.work_type,
          description: form.description || null, content_url: form.content_url,
          brand_name: form.brand_name || null, published_on: form.published_on || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(typeof j?.error === 'string' ? j.error : 'Could not save this entry'); return; }
      setForm({ title: '', work_type: 'sponsored_post', description: '', content_url: '', brand_name: '', published_on: '' });
      setOpen(false);
      await load();
    } catch { setErr('Could not save this entry'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/owner/sample-work/${id}`, { method: 'DELETE', credentials: 'include' });
      await load();
    } finally { setBusy(false); }
  }

  const rateCard = items.find((i) => i.key === 'rate_card');

  return (
    <div className="mt-6 space-y-4" id="sample-work" data-testid="owner-onboarding-panel">
      <div className="wh-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Get sponsorship-ready</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your listing stays public either way — these steps just make brands far more likely to book you.
            </p>
          </div>
          {rateCard && !rateCard.done && (
            <Button size="sm" asChild data-testid="onboarding-rate-card-cta">
              <a href={`/dashboard/channels/${channelId}/monetization`}>Set Your Rate Card</a>
            </Button>
          )}
        </div>
        <ul className="mt-4 space-y-2 text-sm" data-testid="onboarding-checklist">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2">
              {i.done
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className={i.done ? 'text-muted-foreground line-through' : ''}>{i.label}</span>
              {!i.done && i.href && (
                <a href={i.href} className="text-xs font-semibold text-primary hover:underline">Open →</a>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="text-muted-foreground">Checklist unavailable right now.</li>}
        </ul>
      </div>

      <div className="wh-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold">Sample work</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Public links to content you have already published. Brands use this to evaluate you before sending or
              approving a sponsorship. A previous paid WaveLead campaign is not required.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} data-testid="sample-work-add-toggle">
            <Plus className="h-4 w-4 mr-1" />Add sample work
          </Button>
        </div>

        {open && (
          <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="sample-work-form">
            <label className="text-sm">Title
              <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="sample-work-title" />
            </label>
            <label className="text-sm">Work type
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value })} data-testid="sample-work-type">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-sm md:col-span-2">Public content URL (https://…)
              <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://…" value={form.content_url}
                onChange={(e) => setForm({ ...form, content_url: e.target.value })} data-testid="sample-work-url" />
            </label>
            <label className="text-sm md:col-span-2">Short description (optional)
              <textarea rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="sample-work-description" />
            </label>
            <label className="text-sm">Brand / client (optional)
              <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} data-testid="sample-work-brand" />
            </label>
            <label className="text-sm">Date (optional)
              <input type="date" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.published_on} onChange={(e) => setForm({ ...form, published_on: e.target.value })} data-testid="sample-work-date" />
            </label>
            {err && <p className="md:col-span-2 text-sm text-red-700" data-testid="sample-work-error">{err}</p>}
            <div className="md:col-span-2">
              <Button size="sm" onClick={add} disabled={busy} data-testid="sample-work-save">Save sample work</Button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2" data-testid="sample-work-list">
          {works.length === 0 && (
            <p className="text-sm text-muted-foreground">No sample work yet.</p>
          )}
          {works.map((w) => (
            <div key={w.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{w.title}</div>
                <div className="text-xs text-muted-foreground">
                  {TYPE_LABELS[w.work_type] || w.work_type}
                  {w.brand_name ? ` · ${w.brand_name}` : ''}{w.published_on ? ` · ${w.published_on}` : ''}
                </div>
                {w.description && <p className="mt-1 text-xs text-muted-foreground">{w.description}</p>}
                <a href={w.content_url} target="_blank" rel="noopener noreferrer nofollow"
                   className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  View content <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(w.id)} disabled={busy} aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-md border border-dashed border-border p-3" data-testid="sample-work-templates">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> EXAMPLES ONLY — these are ideas, not your work, and nothing is saved until you add your own link
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <div key={t.work_type} className="rounded-md bg-muted/50 p-2.5">
                <div className="text-xs font-semibold">{t.title} <span className="text-muted-foreground">(example)</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{t.hint}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
