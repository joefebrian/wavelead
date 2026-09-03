'use client';
// M11-Batch5 — Admin-configurable pricing. All dollar amounts come from
// the server-side pricingConfigService. No hardcoded prices in this file.
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check, Loader2, CheckCircle2, AlertTriangle, Sparkles, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PublicUser } from '@/lib/types';
import type { PublicPricing } from '@/lib/services/pricingConfigTypes';
import { formatMinorUSD } from '@/lib/services/pricingConfigTypes';

interface Tier {
  kind: 'brand_free' | 'brand_pro' | 'brand_founding_lifetime' | 'enterprise';
  name: string;
  price: string;
  priceNote?: string;
  status?: string;
  blurb: string;
  features: Array<{ label: string; badge?: 'Beta' | 'Coming Soon' }>;
  cta: string;
  highlight?: boolean;
  enabled: boolean;
}

function buildTiers(p: PublicPricing): Tier[] {
  const bpBeta = formatMinorUSD(p.brand_pro.beta_price_minor);
  const bpReg = formatMinorUSD(p.brand_pro.regular_price_minor);
  const bpDur = p.brand_pro.beta_duration_months;
  return [
    {
      kind: 'brand_free',
      name: 'Brand Free',
      price: formatMinorUSD(p.brand_free.price_minor),
      status: 'Active',
      blurb: 'Explore and sponsor WhatsApp Channels.',
      cta: 'Start Free',
      enabled: p.brand_free.enabled,
      features: [
        { label: 'Discover channels' },
        { label: 'View channel profiles' },
        { label: 'View sponsorship packages' },
        { label: 'Book sponsorships' },
        { label: 'Track campaign delivery' },
        { label: 'Payment Protection on every booking' },
      ],
    },
    {
      kind: 'brand_pro',
      name: 'Brand Pro',
      price: `${bpBeta} / month`,
      priceNote: `Founding Beta price for the first ${bpDur} month${bpDur === 1 ? '' : 's'}, then ${bpReg} / month.`,
      status: 'Founding Beta',
      highlight: true,
      enabled: p.brand_pro.enabled,
      blurb: 'Campaign Intelligence & Sponsorship Operating System for brands and agencies.',
      cta: 'Join Founding Beta',
      features: [
        { label: 'Everything in Brand Free' },
        { label: 'Advanced Channel Discovery & Filtering' },
        { label: 'Advanced Rate Card Analysis & Benchmarking' },
        { label: 'Sponsorship Portfolio Reporting' },
        { label: 'Campaign Reporting' },
        { label: 'Revenue / Campaign Intelligence' },
        { label: 'AI Campaign Brief', badge: 'Coming Soon' },
        { label: 'Recommended Channels for This Campaign', badge: 'Coming Soon' },
      ],
    },
    {
      kind: 'brand_founding_lifetime',
      name: 'Founding Lifetime',
      price: formatMinorUSD(p.brand_lifetime.price_minor),
      priceNote: p.brand_lifetime.availability === 'public_beta'
        ? 'One-time. Public Beta offer only — not a permanent price.'
        : 'One-time.',
      status: p.brand_lifetime.availability === 'public_beta' ? 'Public Beta Offer' : 'Available',
      blurb: 'Lifetime access to the Brand Pro features included in your Founding plan. Priority product support.',
      cta: 'Reserve Founding Lifetime',
      enabled: p.brand_lifetime.enabled,
      features: [
        { label: 'Lifetime access to the Brand Pro features included in your Founding plan' },
        { label: 'Priority product support' },
        { label: 'Founding Member badge in your workspace' },
        { label: 'Founding Lifetime does NOT include future Enterprise capabilities' },
        { label: 'Founding Lifetime does NOT include unlimited API / high-volume AI usage' },
      ],
    },
    {
      kind: 'enterprise',
      name: 'Enterprise',
      price: 'Custom',
      status: 'Contact Sales',
      blurb: 'For agencies, publishers and portfolio operators.',
      cta: 'Contact Sales',
      enabled: p.enterprise.enabled,
      features: [
        { label: 'Everything in Brand Pro' },
        { label: 'Portfolio operations across multiple accounts' },
        { label: 'Custom onboarding & account management' },
        { label: 'Priority support' },
      ],
    },
  ];
}

const ENTERPRISE_COMPANY_TYPES = [
  { value: 'brand', label: 'Brand' },
  { value: 'agency', label: 'Agency' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'network_mcn', label: 'Network / MCN' },
  { value: 'other', label: 'Other' },
] as const;

const ENTERPRISE_INTERESTS = [
  { value: 'channel_discovery', label: 'Channel Discovery' },
  { value: 'bulk_channel_management', label: 'Bulk Channel Management' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'api_integration', label: 'API / Integration' },
  { value: 'other', label: 'Other' },
] as const;

export default function PricingClient({ pricing }: { pricing: PublicPricing }) {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistFocus, setWaitlistFocus] = useState<'brand_pro' | 'brand_founding_lifetime'>('brand_pro');
  const [entOpen, setEntOpen] = useState(false);
  const tiers = buildTiers(pricing);
  const ownerActivationPrice = formatMinorUSD(pricing.owner_activation.display_price_minor);
  const bpDur = pricing.brand_pro.beta_duration_months;
  const bpRegDisplay = formatMinorUSD(pricing.brand_pro.regular_price_minor);
  const lifetimeDisplay = formatMinorUSD(pricing.brand_lifetime.price_minor);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((r) => setMe((r?.data?.user as PublicUser) || null))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  function handleFree() {
    if (me) router.push('/dashboard');
    else router.push('/signup?next=/dashboard');
  }
  function openWaitlist(focus: 'brand_pro' | 'brand_founding_lifetime') { setWaitlistFocus(focus); setWaitlistOpen(true); }

  return (
    <>
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" /> Brands & Sponsors
        </span>
        <span className="text-xs text-muted-foreground">Campaign intelligence, sponsorship operations, and channel discovery.</span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="pricing-grid">
        {tiers.filter((t) => t.enabled).map((tier) => (
          <div
            key={tier.kind}
            data-testid={`pricing-card-${tier.kind}`}
            className={`wh-card p-6 flex flex-col ${tier.highlight ? 'ring-2 ring-primary/60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{tier.name}</div>
              {tier.status && (
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${
                    tier.status === 'Active'
                      ? 'text-emerald-700 bg-emerald-100'
                      : tier.status === 'Founding Beta' || tier.status === 'Public Beta Offer'
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground bg-muted'
                  }`}
                  data-testid={`pricing-status-${tier.kind}`}
                >
                  {tier.status}
                </span>
              )}
            </div>
            <div className="mt-3 text-3xl font-bold" data-testid={`pricing-price-${tier.kind}`}>{tier.price}</div>
            {tier.priceNote && <div className="mt-1 text-xs text-muted-foreground" data-testid={`price-note-${tier.kind}`}>{tier.priceNote}</div>}
            <p className="text-sm text-muted-foreground mt-2">{tier.blurb}</p>
            <ul className="mt-5 space-y-2 text-sm flex-1">
              {tier.features.map((f) => (
                <li key={f.label} className="flex gap-2 items-start">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>
                    {f.label}
                    {f.badge && (
                      <span className="ml-1.5 inline-block rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" data-testid={`feature-badge-${f.badge.toLowerCase().replace(/\s+/g, '-')}`}>
                        {f.badge}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {tier.kind === 'brand_free' && (
                <Button className="w-full" variant="outline" onClick={handleFree} disabled={!meLoaded} data-testid="cta-brand-free">{tier.cta}</Button>
              )}
              {tier.kind === 'brand_pro' && (
                <Button className="w-full" onClick={() => openWaitlist('brand_pro')} data-testid="cta-brand-pro">{tier.cta}</Button>
              )}
              {tier.kind === 'brand_founding_lifetime' && (
                <Button className="w-full" variant="outline" onClick={() => openWaitlist('brand_founding_lifetime')} data-testid="cta-brand-founding-lifetime">{tier.cta}</Button>
              )}
              {tier.kind === 'enterprise' && (
                <Button className="w-full" variant="outline" onClick={() => setEntOpen(true)} data-testid="cta-enterprise">{tier.cta}</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-3xl" data-testid="brand-billing-note">
        Brand Pro Founding Beta is {formatMinorUSD(pricing.brand_pro.beta_price_minor)}/month for the first {bpDur} month{bpDur === 1 ? '' : 's'}, then {bpRegDisplay}/month afterward. Founding
        Lifetime is a one-time {lifetimeDisplay} offer available only during Public Beta. Automated recurring billing is being finalized —
        Founding Beta and Founding Lifetime spots are secured today through the WaveLead commercial team.
      </p>

      <section className="mt-14 wh-card p-6 md:p-8" data-testid="channel-owner-pricing">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground px-3 py-1 text-xs font-semibold">For Channel Owners</div>
            <h2 className="mt-3 text-2xl font-bold">Grow &amp; monetize your WhatsApp Channel</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              Get discovered by brands, publish sponsorship packages, and monetize your WhatsApp Channel.
            </p>
          </div>
          <Link href="/submit"><Button variant="outline" data-testid="cta-owner-submit">Submit your channel</Button></Link>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-4" data-testid="owner-tile-list">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">List your channel</div>
            <div className="mt-1 text-lg font-bold">Free</div>
            <p className="mt-1 text-xs text-muted-foreground">List, claim, and publish sponsorship packages at no cost.</p>
          </div>
          <div className="rounded-md border border-border p-4" data-testid="owner-tile-marketplace">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marketplace earning</div>
            <div className="mt-1 text-lg font-bold">Free participation</div>
            <p className="mt-1 text-xs text-muted-foreground">Receive sponsorships, deliver campaigns, request external payout. 90% owner / 10% WaveLead on every sponsorship.</p>
          </div>
          <div className="rounded-md border border-border p-4" data-testid="owner-tile-activation">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verified Owner Activation</div>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground" data-testid="activation-rollout-pill">Rollout Coming Soon</span>
            </div>
            <div className="mt-1 text-lg font-bold" data-testid="owner-activation-display-price">{ownerActivationPrice} per channel</div>
            <p className="mt-1 text-xs text-muted-foreground">One-time activation transaction — not a subscription. Ownership must be approved first; payment alone never proves ownership.</p>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-border p-4" data-testid="owner-tile-promote">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Promote your channel</div>
          <div className="mt-1 text-lg font-bold">Pay as you go</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Promote is optional paid placement. Sponsored placements are always clearly labeled and never silently
            influence organic recommendations — they run beside organic results, never as an undisclosed replacement.
          </p>
        </div>
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Existing Channel Owner Pro accounts remain fully active. If you&apos;re on Channel Owner Pro, nothing changes for
        you — Revenue Intelligence, Sponsorship Pipeline, and other Pro features continue to work.
      </p>

      <WaitlistDialog open={waitlistOpen} onOpenChange={setWaitlistOpen} me={me} focus={waitlistFocus} />
      <EnterpriseDialog open={entOpen} onOpenChange={setEntOpen} me={me} />
    </>
  );
}

function WaitlistDialog({ open, onOpenChange, me, focus }: { open: boolean; onOpenChange: (o: boolean) => void; me: PublicUser | null; focus: 'brand_pro' | 'brand_founding_lifetime' }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setEmail(me?.email || ''); setName(me?.display_name || ''); setDone(false); setError(null); } }, [open, me]);
  const isLifetime = focus === 'brand_founding_lifetime';
  const title = isLifetime ? 'Reserve Founding Lifetime access' : 'Join the Brand Pro Founding Beta';
  const description = isLifetime
    ? "A member of the WaveLead team will reach out to secure your Founding Lifetime spot. Public Beta offer — not a permanent price."
    : 'Founding Beta pricing is time-limited. No obligation to submit interest.';
  const submitLabel = isLifetime ? 'Reserve My Spot' : 'Join Founding Beta';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/commercial-leads/pro-waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ email, ...(name ? { name } : {}), plan_focus: focus }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="waitlist-dialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div className="mt-3 font-semibold">You&apos;re on the list.</div>
            <p className="mt-1 text-sm text-muted-foreground">A WaveLead team member will follow up shortly.</p>
            <Button className="mt-4" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} data-testid="pro-email" /></div>
            <div><label className="block text-sm font-medium mb-1">Name <span className="text-xs text-muted-foreground">(optional)</span></label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} data-testid="pro-name" maxLength={120} /></div>
            {isLifetime && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 inline-flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Founding Lifetime includes the Brand Pro features listed in the Founding plan and priority product support. It does <strong>not</strong> promise unlimited future Enterprise, API, or high-volume AI capabilities.</span>
              </div>
            )}
            {error && <div className="text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="pro-submit">{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : submitLabel}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnterpriseDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: PublicUser | null }) {
  const [form, setForm] = useState({ company_name: '', contact_name: '', email: '', company_type: 'brand' as string, channel_count: '' as string, country: '' as string, message: '' });
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm({ company_name: '', contact_name: me?.display_name || '', email: me?.email || '', company_type: 'brand', channel_count: '', country: me?.country_code || '', message: '' });
      setInterests(new Set()); setDone(false); setError(null);
    }
  }, [open, me]);
  function toggleInterest(v: string) { setInterests((prev) => { const next = new Set(prev); if (next.has(v)) next.delete(v); else next.add(v); return next; }); }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (interests.size === 0) throw new Error('Please select at least one area of interest.');
      const payload = { company_name: form.company_name.trim(), contact_name: form.contact_name.trim(), email: form.email.trim(), company_type: form.company_type, interest: Array.from(interests), message: form.message.trim(), ...(form.channel_count ? { channel_count: Number(form.channel_count) } : {}), ...(form.country ? { country: form.country.toUpperCase() } : {}) };
      const r = await fetch('/api/commercial-leads/enterprise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="enterprise-dialog">
        <DialogHeader><DialogTitle>Contact WaveLead — Enterprise</DialogTitle><DialogDescription>Tell us about your needs. A WaveLead team member will get back to you within one business day.</DialogDescription></DialogHeader>
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div className="mt-3 font-semibold">Thanks — we&apos;ve got your request.</div>
            <Button className="mt-4" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Company Name</label><input required maxLength={200} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className={inputCls} data-testid="ent-company" /></div>
              <div><label className="block text-sm font-medium mb-1">Contact Name</label><input required maxLength={120} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputCls} data-testid="ent-contact" /></div>
              <div><label className="block text-sm font-medium mb-1">Work Email</label><input required type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} data-testid="ent-email" /></div>
              <div><label className="block text-sm font-medium mb-1">Company Type</label><select value={form.company_type} onChange={(e) => setForm({ ...form, company_type: e.target.value })} className={inputCls} data-testid="ent-type">{ENTERPRISE_COMPANY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">Approx. # of Channels <span className="text-xs text-muted-foreground">(optional)</span></label><input type="number" min={0} max={1000000} value={form.channel_count} onChange={(e) => setForm({ ...form, channel_count: e.target.value })} className={inputCls} /></div>
              <div><label className="block text-sm font-medium mb-1">Country <span className="text-xs text-muted-foreground">(ISO-2, optional)</span></label><input type="text" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} className={inputCls} placeholder="US" /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">What do you need? <span className="text-xs text-muted-foreground">(select all that apply)</span></label><div className="grid grid-cols-2 gap-1.5" data-testid="ent-interests">{ENTERPRISE_INTERESTS.map((i) => (<label key={i.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={interests.has(i.value)} onChange={() => toggleInterest(i.value)} className="h-4 w-4" data-testid={`ent-interest-${i.value}`} /><span>{i.label}</span></label>))}</div></div>
            <div><label className="block text-sm font-medium mb-1">Message / Requirements</label><textarea required rows={4} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputCls} data-testid="ent-message" /></div>
            {error && <div className="text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
            <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy} data-testid="ent-submit">{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Contact WaveLead'}</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
