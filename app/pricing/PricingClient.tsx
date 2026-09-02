'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PublicUser } from '@/lib/types';

interface Plan { name: string; price: string; blurb: string; features: string[]; cta: string; highlight?: boolean; kind: 'free' | 'pro' | 'enterprise'; status?: string; }

const PLANS: Plan[] = [
  {
    kind: 'free',
    name: 'Free',
    price: '$0',
    status: 'Active',
    blurb: 'Start and monetize your channel — the full sponsorship money loop, no plan required.',
    cta: 'Get Started',
    features: [
      '1 owned / managed channel',
      'Claim & verify your channel',
      'Basic sponsorship marketplace (receive brand requests, deliver work)',
      'Basic earnings dashboard & external payout request',
      'Promote (pay per campaign, USD via PayPal)',
      'Basic rate card & delivery / payment protection',
      'Basic channel analytics',
    ],
  },
  {
    kind: 'pro',
    name: 'Pro',
    price: 'Coming Soon',
    status: 'Coming Soon',
    highlight: true,
    blurb: 'Grow with advanced revenue and performance intelligence.',
    cta: 'Join Pro Waitlist',
    features: [
      'Everything in Free',
      'Multiple managed channels',
      'Advanced analytics & longer history',
      'Revenue dashboard & sponsorship pipeline intelligence',
      'Rate-card benchmarks & pricing intelligence',
      'Promote performance intelligence',
      'Advanced exports & reports',
    ],
  },
  {
    kind: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    status: 'Contact Sales',
    blurb: 'Operate channel portfolios and teams at scale.',
    cta: 'Contact Sales',
    features: [
      'Everything in Pro',
      'Multi-channel workspace with team seats & RBAC',
      'Higher / unlimited channel limits',
      'Portfolio analytics & bulk operations',
      'Campaign / revenue operations tooling',
      'Advanced reports & exports',
      'Account management & future API access',
    ],
  },
];

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

export default function PricingClient() {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [entOpen, setEntOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((r) => setMe((r?.data?.user as PublicUser) || null))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  function handleFree() {
    // Server owns login-redirect logic. For CTA we route directly to the right
    // page based on authenticated state (already fetched above).
    if (me) router.push('/dashboard');
    else router.push('/signup?next=/dashboard');
  }

  return (
    <>
      <div className="mt-12 grid gap-4 md:grid-cols-3" data-testid="pricing-grid">
        {PLANS.map((plan) => (
          <div
            key={plan.kind}
            data-testid={`pricing-card-${plan.kind}`}
            className={`wh-card p-6 flex flex-col ${plan.highlight ? 'ring-2 ring-primary/60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{plan.name}</div>
              {plan.status && (
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${
                    plan.status === 'Active'
                      ? 'text-emerald-700 bg-emerald-100'
                      : plan.status === 'Coming Soon'
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground bg-muted'
                  }`}
                  data-testid={`pricing-status-${plan.kind}`}
                >
                  {plan.status}
                </span>
              )}
            </div>
            <div className="mt-3 text-3xl font-bold">{plan.price}</div>
            <p className="text-sm text-muted-foreground mt-1">{plan.blurb}</p>
            <ul className="mt-5 space-y-2 text-sm flex-1">
              {plan.features.map((f) => (<li key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary mt-0.5" /><span>{f}</span></li>))}
            </ul>
            <div className="mt-6">
              {plan.kind === 'free' && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleFree}
                  disabled={!meLoaded}
                  data-testid="cta-free"
                >
                  {plan.cta}
                </Button>
              )}
              {plan.kind === 'pro' && (
                <Button
                  className="w-full"
                  onClick={() => setProOpen(true)}
                  data-testid="cta-pro"
                >
                  {plan.cta}
                </Button>
              )}
              {plan.kind === 'enterprise' && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setEntOpen(true)}
                  data-testid="cta-enterprise"
                >
                  {plan.cta}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-xs text-muted-foreground">Free covers the full sponsorship money loop today. Pro subscription bundling is coming soon; Promote capacity is billed per campaign in USD via PayPal.</p>

      <ProWaitlistDialog open={proOpen} onOpenChange={setProOpen} me={me} />
      <EnterpriseDialog open={entOpen} onOpenChange={setEntOpen} me={me} />
    </>
  );
}

// ============================================================================
// Pro waitlist modal
// ============================================================================
function ProWaitlistDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: PublicUser | null }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(me?.email || '');
      setName(me?.display_name || '');
      setDone(false);
      setError(null);
    }
  }, [open, me]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // duplicate-click guard
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/commercial-leads/pro-waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ email, ...(name ? { name } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pro-waitlist-dialog">
        <DialogHeader>
          <DialogTitle>Join the WaveLead Pro Waitlist</DialogTitle>
          <DialogDescription>We&apos;ll email you when Pro launches. No obligation.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div className="mt-3 font-semibold">You&apos;re on the list.</div>
            <p className="mt-1 text-sm text-muted-foreground">We&apos;ll let you know when WaveLead Pro becomes available.</p>
            <Button className="mt-4" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                data-testid="pro-email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name <span className="text-xs text-muted-foreground">(optional)</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                data-testid="pro-name"
                maxLength={120}
              />
            </div>
            {error && <div className="text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="pro-submit">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Join Pro Waitlist'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Enterprise modal
// ============================================================================
function EnterpriseDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: PublicUser | null }) {
  const [form, setForm] = useState({
    company_name: '', contact_name: '', email: '',
    company_type: 'brand' as string,
    channel_count: '' as string,
    country: '' as string,
    message: '',
  });
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        company_name: '', contact_name: me?.display_name || '', email: me?.email || '',
        company_type: 'brand', channel_count: '', country: me?.country_code || '',
        message: '',
      });
      setInterests(new Set());
      setDone(false);
      setError(null);
    }
  }, [open, me]);

  function toggleInterest(v: string) {
    setInterests((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (interests.size === 0) throw new Error('Please select at least one area of interest.');
      const payload = {
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        company_type: form.company_type,
        interest: Array.from(interests),
        message: form.message.trim(),
        ...(form.channel_count ? { channel_count: Number(form.channel_count) } : {}),
        ...(form.country ? { country: form.country.toUpperCase() } : {}),
      };
      const r = await fetch('/api/commercial-leads/enterprise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="enterprise-dialog">
        <DialogHeader>
          <DialogTitle>Contact WaveLead — Enterprise</DialogTitle>
          <DialogDescription>Tell us about your needs. A WaveLead team member will get back to you within one business day.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div className="mt-3 font-semibold">Thanks — we&apos;ve got your request.</div>
            <p className="mt-1 text-sm text-muted-foreground">A member of the WaveLead team will be in touch shortly.</p>
            <Button className="mt-4" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Company Name</label>
                <input required maxLength={200} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className={inputCls} data-testid="ent-company" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contact Name</label>
                <input required maxLength={120} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className={inputCls} data-testid="ent-contact" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Work Email</label>
                <input required type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} data-testid="ent-email" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Company Type</label>
                <select value={form.company_type} onChange={(e) => setForm({ ...form, company_type: e.target.value })} className={inputCls} data-testid="ent-type">
                  {ENTERPRISE_COMPANY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Approx. # of Channels <span className="text-xs text-muted-foreground">(optional)</span></label>
                <input type="number" min={0} max={1000000} value={form.channel_count} onChange={(e) => setForm({ ...form, channel_count: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Country <span className="text-xs text-muted-foreground">(ISO-2, optional)</span></label>
                <input type="text" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} className={inputCls} placeholder="US" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">What do you need? <span className="text-xs text-muted-foreground">(select all that apply)</span></label>
              <div className="grid grid-cols-2 gap-1.5" data-testid="ent-interests">
                {ENTERPRISE_INTERESTS.map((i) => (
                  <label key={i.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={interests.has(i.value)}
                      onChange={() => toggleInterest(i.value)}
                      className="h-4 w-4"
                      data-testid={`ent-interest-${i.value}`}
                    />
                    <span>{i.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Message / Requirements</label>
              <textarea required rows={4} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={inputCls} data-testid="ent-message" />
            </div>
            {error && <div className="text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="ent-submit">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Contact WaveLead'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
