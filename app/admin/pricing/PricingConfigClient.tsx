'use client';
// M11-Batch5 — Admin pricing editor.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import type { CommercialPricingConfig } from '@/lib/services/pricingConfigTypes';

interface Props { initial: CommercialPricingConfig }

function MinorInput({ label, value, onChange, testId, disabled }: { label: string; value: number; onChange: (v: number) => void; testId: string; disabled?: boolean }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number" min={0} step={1} value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
          className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid={testId} disabled={disabled}
        />
        <span className="text-xs text-muted-foreground">minor USD (100 = $1.00) · preview: <strong>${(value / 100).toFixed(2)}</strong></span>
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label} — <strong>{checked ? 'Enabled' : 'Disabled'}</strong></span>
    </label>
  );
}

export default function PricingConfigClient({ initial }: Props) {
  const [cfg, setCfg] = useState<CommercialPricingConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setOk(null); setErr(null);
    try {
      const payload = {
        brand_free: cfg.brand_free,
        brand_pro: cfg.brand_pro,
        brand_lifetime: cfg.brand_lifetime,
        enterprise: cfg.enterprise,
        // Note: owner_activation.display_price_minor is display-only in this
        // patch. It is INTENTIONALLY excluded from the update payload to keep
        // the live $1 activation charge server-authoritative.
      };
      const r = await fetch('/api/admin/pricing-config', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { data?: CommercialPricingConfig; error?: { message?: string } };
      if (!r.ok || !j.data) throw new Error(j.error?.message || 'Save failed');
      setCfg(j.data);
      setOk('Pricing saved. Public pages will reflect the update on next render.');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 grid gap-4">
      <section className="wh-card p-5" data-testid="section-brand-free">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Brand Free</h2><Toggle label="Brand Free" checked={cfg.brand_free.enabled} onChange={(v) => setCfg({ ...cfg, brand_free: { ...cfg.brand_free, enabled: v } })} testId="toggle-brand-free" /></div>
        <div className="mt-3"><MinorInput label="Price" value={cfg.brand_free.price_minor} onChange={(v) => setCfg({ ...cfg, brand_free: { ...cfg.brand_free, price_minor: v } })} testId="brand-free-price" /></div>
      </section>

      <section className="wh-card p-5" data-testid="section-brand-pro">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Brand Pro</h2><Toggle label="Brand Pro" checked={cfg.brand_pro.enabled} onChange={(v) => setCfg({ ...cfg, brand_pro: { ...cfg.brand_pro, enabled: v } })} testId="toggle-brand-pro" /></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MinorInput label="Beta Price" value={cfg.brand_pro.beta_price_minor} onChange={(v) => setCfg({ ...cfg, brand_pro: { ...cfg.brand_pro, beta_price_minor: v } })} testId="brand-pro-beta-price" />
          <MinorInput label="Regular Price" value={cfg.brand_pro.regular_price_minor} onChange={(v) => setCfg({ ...cfg, brand_pro: { ...cfg.brand_pro, regular_price_minor: v } })} testId="brand-pro-regular-price" />
          <label className="block">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Beta Duration (months)</div>
            <input type="number" min={0} max={36} step={1} value={cfg.brand_pro.beta_duration_months} onChange={(e) => setCfg({ ...cfg, brand_pro: { ...cfg.brand_pro, beta_duration_months: Math.max(0, Math.min(36, Math.trunc(Number(e.target.value) || 0))) } })} className="mt-1 w-40 rounded-md border border-border bg-background px-3 py-2 text-sm" data-testid="brand-pro-beta-duration" />
          </label>
        </div>
      </section>

      <section className="wh-card p-5" data-testid="section-brand-lifetime">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Founding Lifetime</h2><Toggle label="Founding Lifetime" checked={cfg.brand_lifetime.enabled} onChange={(v) => setCfg({ ...cfg, brand_lifetime: { ...cfg.brand_lifetime, enabled: v } })} testId="toggle-brand-lifetime" /></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MinorInput label="Price" value={cfg.brand_lifetime.price_minor} onChange={(v) => setCfg({ ...cfg, brand_lifetime: { ...cfg.brand_lifetime, price_minor: v } })} testId="brand-lifetime-price" />
          <label className="block">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Availability</div>
            <select value={cfg.brand_lifetime.availability} onChange={(e) => setCfg({ ...cfg, brand_lifetime: { ...cfg.brand_lifetime, availability: e.target.value as 'public_beta' | 'always' } })} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" data-testid="brand-lifetime-availability">
              <option value="public_beta">Public Beta only</option>
              <option value="always">Always available</option>
            </select>
          </label>
        </div>
      </section>

      <section className="wh-card p-5" data-testid="section-enterprise">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Enterprise</h2><Toggle label="Enterprise" checked={cfg.enterprise.enabled} onChange={(v) => setCfg({ ...cfg, enterprise: { ...cfg.enterprise, enabled: v } })} testId="toggle-enterprise" /></div>
        <p className="mt-2 text-sm text-muted-foreground">Pricing type is fixed to <strong>Custom</strong>.</p>
      </section>

      <section className="wh-card p-5 border-amber-300 bg-amber-50/40" data-testid="section-owner-activation">
        <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-amber-700" /><h2 className="font-semibold">Verified Owner Activation</h2><span className="ml-1 rounded bg-amber-200 text-amber-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold">Display only</span></div>
        <p className="mt-1 text-sm text-amber-900">Display only — live activation billing not enabled. The actual $1.00 activation charge is server-authoritative in <code className="text-xs">channelActivationService</code> and cannot be edited from here until LIVE activation is explicitly released.</p>
        <div className="mt-3 text-sm">Currently displayed as: <strong>${(cfg.owner_activation.display_price_minor / 100).toFixed(2)} per channel</strong></div>
      </section>

      {ok && <div className="inline-flex items-center gap-1 text-sm text-emerald-700" data-testid="admin-pricing-ok"><CheckCircle2 className="h-4 w-4" />{ok}</div>}
      {err && <div className="inline-flex items-center gap-1 text-sm text-rose-600" data-testid="admin-pricing-err"><AlertTriangle className="h-4 w-4" />{err}</div>}

      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="gap-1.5" data-testid="admin-pricing-save">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>Save Pricing</>}
        </Button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Note: This surface configures commercial <strong>display / plan positioning</strong>. Brand Pro recurring billing
        and Founding Lifetime checkout are NOT wired to these values. Owner Activation live billing remains disabled.
      </p>
    </div>
  );
}
