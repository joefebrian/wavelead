'use client';
// M18 — Brand campaign list + creation.
//
// A campaign is an OPPORTUNITY, not a payment: creating or opening one never
// touches a payment provider. Total Campaign Budget is planning/display data
// — it holds no money and creates no funding obligation.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionCard, EmptyState, StatusBadge, DataTable, InfoBanner, FormSection, fieldClass, type Tone } from '@/components/appkit';
import { Megaphone, Loader2, Plus } from 'lucide-react';

interface Campaign {
  id: string; name: string; brand_name: string; objective: string; status: string;
  budget_total_usd_minor: number; application_deadline: string | null; created_at: string;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral', open: 'success', in_selection: 'info', active: 'info', completed: 'neutral', cancelled: 'danger',
};
const usd = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default function CampaignsClient() {
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', brand_name: '', objective: '', brief: '', budget: '',
    application_deadline: '', start_date: '', end_date: '',
    creator_requirements: '', deliverables: '', materials_url: '', expected_creator_count: '',
  });

  const load = useCallback(async () => {
    const r = await fetch('/api/brand/campaigns', { credentials: 'include' });
    const j = await r.json();
    setRows(j?.data?.campaigns || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(null); setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(), brand_name: form.brand_name.trim(), objective: form.objective.trim(),
        brief: form.brief.trim(),
        budget_total_usd_minor: Math.round(Number(form.budget || '0') * 100),
        target_country_codes: [], target_category_slugs: [],
        creator_requirements: form.creator_requirements.trim() || null,
        deliverables: form.deliverables.trim() || null,
        materials_url: form.materials_url.trim() || null,
        expected_creator_count: form.expected_creator_count ? Number(form.expected_creator_count) : null,
      };
      for (const [k, v] of [['start_date', form.start_date], ['end_date', form.end_date], ['application_deadline', form.application_deadline]] as const) {
        if (v) body[k] = new Date(v).toISOString();
      }
      const r = await fetch('/api/brand/campaigns', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not create the campaign');
      setCreating(false);
      setForm({ ...form, name: '', objective: '', brief: '', budget: '' });
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Launch a campaign, review creator applications, then continue approved creators into the normal WaveLead booking flow."
        actions={<Button onClick={() => setCreating((v) => !v)} data-testid="new-campaign"><Plus className="mr-1.5 h-4 w-4" />New campaign</Button>}
      />

      <div className="mb-5">
        <InfoBanner testId="campaign-budget-notice">
          Total Campaign Budget is planning information only. WaveLead never holds campaign funds and no deposit is required —
          payment happens per booking through the existing marketplace flow with Payment Protection.
        </InfoBanner>
      </div>

      {creating && (
        <SectionCard title="New campaign" description="Saved as a draft. Nothing is published until you open it." className="mb-5" testId="campaign-create-form">
          {err && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">{err}</div>}
          <FormSection title="Basics">
            <label className="text-sm">Campaign name<input className={fieldClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="campaign-name" /></label>
            <label className="text-sm">Brand / Organization<input className={fieldClass} value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} data-testid="campaign-brand" /></label>
            <label className="text-sm">Objective<input className={fieldClass} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} data-testid="campaign-objective" /></label>
            <label className="text-sm">Total campaign budget (USD)<input className={fieldClass} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="5000" data-testid="campaign-budget" /></label>
            <label className="text-sm md:col-span-2">Campaign brief<textarea className={`${fieldClass} min-h-[110px]`} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} data-testid="campaign-brief" /></label>
          </FormSection>
          <FormSection title="Timeline">
            <label className="text-sm">Start date<input type="date" className={fieldClass} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            <label className="text-sm">End date<input type="date" className={fieldClass} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            <label className="text-sm">Application deadline<input type="date" className={fieldClass} value={form.application_deadline} onChange={(e) => setForm({ ...form, application_deadline: e.target.value })} data-testid="campaign-deadline" /></label>
            <label className="text-sm">Expected creators (optional)<input className={fieldClass} value={form.expected_creator_count} onChange={(e) => setForm({ ...form, expected_creator_count: e.target.value })} /></label>
          </FormSection>
          <FormSection title="Requirements & materials" description="Link materials from your own storage (Google Drive, website). WaveLead hosts no files.">
            <label className="text-sm">Creator requirements<textarea className={`${fieldClass} min-h-[80px]`} value={form.creator_requirements} onChange={(e) => setForm({ ...form, creator_requirements: e.target.value })} /></label>
            <label className="text-sm">Deliverables<textarea className={`${fieldClass} min-h-[80px]`} value={form.deliverables} onChange={(e) => setForm({ ...form, deliverables: e.target.value })} /></label>
            <label className="text-sm md:col-span-2">Materials URL (https)<input className={fieldClass} value={form.materials_url} onChange={(e) => setForm({ ...form, materials_url: e.target.value })} placeholder="https://drive.google.com/…" /></label>
          </FormSection>
          <Button onClick={create} disabled={busy} data-testid="create-campaign-submit">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save draft'}
          </Button>
        </SectionCard>
      )}

      {rows === null ? (
        <div className="text-sm text-muted-foreground">Loading campaigns…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-6 w-6" />}
          title="No campaigns yet"
          description="Launch a campaign to let verified channel owners apply to work with your brand."
          action={<Button onClick={() => setCreating(true)}>Create your first campaign</Button>}
        />
      ) : (
        <DataTable head={['Campaign', 'Status', 'Budget (planning)', 'Deadline', '']} testId="campaign-table">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <td className="px-3 py-2.5">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.brand_name} · {c.objective}</div>
              </td>
              <td className="px-3 py-2.5"><StatusBadge tone={STATUS_TONE[c.status] || 'neutral'}>{c.status.replace(/_/g, ' ')}</StatusBadge></td>
              <td className="px-3 py-2.5 tabular-nums">{usd(c.budget_total_usd_minor)}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{c.application_deadline ? new Date(c.application_deadline).toLocaleDateString() : '—'}</td>
              <td className="px-3 py-2.5 text-right">
                <Link href={`/dashboard/campaigns/${c.id}`}><Button size="sm" variant="outline">Manage</Button></Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
