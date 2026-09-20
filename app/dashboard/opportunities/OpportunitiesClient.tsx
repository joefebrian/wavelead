'use client';
// M18 — Creator-facing CAMPAIGN OPPORTUNITIES.
//
// Deliberately separate from "Incoming Requests" (direct sponsorship requests)
// so the two never collide in the owner's mental model. Applying is free and
// involves no payment whatsoever.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionCard, EmptyState, StatusBadge, InfoBanner, fieldClass } from '@/components/appkit';
import { Compass, Loader2 } from 'lucide-react';

interface Campaign {
  id: string; name: string; brand_name: string; objective: string; brief: string;
  target_country_codes: string[]; target_category_slugs: string[];
  budget_total_usd_minor: number; start_date: string | null; end_date: string | null;
  application_deadline: string | null; creator_requirements: string | null;
  deliverables: string | null; materials_url: string | null;
}
interface MyChannel { id: string; name: string; status: string; verification_status: string }

const usd = (m: number) => `$${(m / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default function OpportunitiesClient() {
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [channels, setChannels] = useState<MyChannel[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ channel_id: '', rate: '', pitch: '', audience_note: '', message_to_brand: '', materials_url: '' });

  const load = useCallback(async () => {
    const [c, ch] = await Promise.all([
      fetch('/api/campaign-opportunities', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/me/channels', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
    ]);
    setRows(c?.data?.campaigns || []);
    setChannels((ch?.data?.channels || []).filter((x: MyChannel) => x.status === 'approved'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function apply(campaignId: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/campaign-opportunities/${campaignId}/apply`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: form.channel_id,
          proposed_rate_usd_minor: form.rate ? Math.round(Number(form.rate) * 100) : null,
          pitch: form.pitch.trim(),
          audience_note: form.audience_note.trim() || null,
          message_to_brand: form.message_to_brand.trim() || null,
          materials_url: form.materials_url.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not submit your application');
      setDone(campaignId); setOpenId(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Campaign Opportunities"
        description="See which brands currently have open campaigns and apply. Applying is free — payment only ever happens later through a normal booking."
      />
      {err && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="opportunity-error">{err}</div>}
      {channels.length === 0 && (
        <div className="mb-4"><InfoBanner tone="warning">You need an approved channel listing before you can apply to a campaign.</InfoBanner></div>
      )}

      {rows === null ? (
        <div className="text-sm text-muted-foreground">Loading opportunities…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Compass className="h-6 w-6" />}
          title="No campaigns are open for your channels right now."
          description="New brand campaigns appear here the moment a brand funds and opens one. Meanwhile, a complete profile and rate card make you far easier to pick."
          action={<div className="flex flex-wrap gap-2 justify-center">
            <a href="/channels" className="text-sm font-semibold text-primary hover:underline" data-testid="opportunities-browse-channels">Browse Channels</a>
            <a href="/dashboard/channels" className="text-sm font-semibold text-primary hover:underline" data-testid="opportunities-complete-profile">Complete Profile</a>
          </div>}
        />
      ) : (
        <div className="space-y-4" data-testid="opportunity-list">
          {rows.map((c) => (
            <SectionCard
              key={c.id}
              title={c.name}
              description={`${c.brand_name} · ${c.objective}`}
              testId={`opportunity-${c.id}`}
              actions={<StatusBadge tone="success">Open</StatusBadge>}
            >
              <p className="whitespace-pre-line text-sm text-muted-foreground">{c.brief}</p>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-muted-foreground">Budget (brand plan)</dt><dd className="font-medium">{usd(c.budget_total_usd_minor)}</dd></div>
                <div><dt className="text-muted-foreground">Timeline</dt><dd className="font-medium">{c.start_date ? new Date(c.start_date).toLocaleDateString() : '—'} → {c.end_date ? new Date(c.end_date).toLocaleDateString() : '—'}</dd></div>
                <div><dt className="text-muted-foreground">Apply before</dt><dd className="font-medium">{c.application_deadline ? new Date(c.application_deadline).toLocaleDateString() : 'No deadline'}</dd></div>
                <div><dt className="text-muted-foreground">Target</dt><dd className="font-medium">{(c.target_country_codes || []).join(', ') || 'Any country'}</dd></div>
              </dl>
              {(c.creator_requirements || c.deliverables) && (
                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  {c.creator_requirements && <div><div className="font-semibold">Creator requirements</div><p className="text-muted-foreground">{c.creator_requirements}</p></div>}
                  {c.deliverables && <div><div className="font-semibold">Deliverables</div><p className="text-muted-foreground">{c.deliverables}</p></div>}
                </div>
              )}
              {c.materials_url && (
                <a href={c.materials_url} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block text-xs text-primary hover:underline">Brand materials ↗</a>
              )}

              {done === c.id ? (
                <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="application-submitted">
                  Application sent. The brand reviews applicants directly — track it under Campaign Applications.
                </div>
              ) : openId === c.id ? (
                <div className="mt-4 rounded-md border border-border p-4" data-testid="apply-form">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm">Channel
                      <select className={fieldClass} value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })} data-testid="apply-channel">
                        <option value="">Select one of your channels</option>
                        {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">Proposed rate (USD, optional)
                      <input className={fieldClass} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} data-testid="apply-rate" />
                    </label>
                    <label className="text-sm md:col-span-2">Short pitch — why this channel is a fit
                      <textarea className={`${fieldClass} min-h-[90px]`} value={form.pitch} onChange={(e) => setForm({ ...form, pitch: e.target.value })} data-testid="apply-pitch" />
                    </label>
                    <label className="text-sm">Audience / category note
                      <input className={fieldClass} value={form.audience_note} onChange={(e) => setForm({ ...form, audience_note: e.target.value })} />
                    </label>
                    <label className="text-sm">Message to brand
                      <input className={fieldClass} value={form.message_to_brand} onChange={(e) => setForm({ ...form, message_to_brand: e.target.value })} />
                    </label>
                    <label className="text-sm md:col-span-2">Public materials URL (https, optional — no file upload)
                      <input className={fieldClass} value={form.materials_url} onChange={(e) => setForm({ ...form, materials_url: e.target.value })} />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => apply(c.id)} disabled={busy} data-testid="submit-application">
                      {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Submit application'}
                    </Button>
                    <Button variant="ghost" onClick={() => setOpenId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button className="mt-4" onClick={() => setOpenId(c.id)} disabled={channels.length === 0} data-testid={`apply-to-campaign-${c.id}`}>
                  Apply to Campaign
                </Button>
              )}
            </SectionCard>
          ))}
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Applying never creates a payment. If a brand approves you, they continue into the normal WaveLead booking where
          Payment Protection applies and you receive 90% of the applicable net.
        </p>
      )}
    </>
  );
}
