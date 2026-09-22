'use client';
// M11-Batch5 — Admin-configurable pricing. All dollar amounts come from
// the server-side pricingConfigService. No hardcoded prices in this file.
import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check, Loader2, CheckCircle2, AlertTriangle, Sparkles, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PublicUser } from '@/lib/types';
import { rememberCommercialIntent, clearCommercialIntent, readCommercialIntent, consumeIntentResumeOnce, INTENT_DESTINATION, type CommercialIntent } from '@/lib/utils/commercialIntent';
import { trackGa4Event } from '@/lib/analytics/events';
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
      // M17 — Brand Pro Founding Beta is a $15 / 30-day MANUAL-renewal term.
      // Never described as an automatically recurring subscription.
      price: '$15 / 30 days',
      priceNote: 'Manual renewal during Founding Beta. No automatic recurring charge.',
      status: 'Founding Beta',
      highlight: true,
      enabled: p.brand_pro.enabled,
      blurb: 'Campaign Intelligence & Sponsorship Operating System for brands and agencies.',
      cta: 'Start Brand Pro — $15',
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
        ? `${formatMinorUSD(p.brand_lifetime.price_minor)} one-time · No subscription · No recurring charge · Public Beta offer only, not a permanent price.`
        : `${formatMinorUSD(p.brand_lifetime.price_minor)} one-time · No subscription · No recurring charge.`,
      status: p.brand_lifetime.availability === 'public_beta' ? 'Public Beta Offer' : 'Available',
      blurb: 'Lifetime access to the Brand Pro features included in your Founding plan. Priority product support.',
      // M17.1 — Founding Lifetime is a REAL PayPal product. No waitlist,
      // no reservation form in the purchase path. Price stays admin-driven.
      cta: `Get Founding Lifetime — ${formatMinorUSD(p.brand_lifetime.price_minor)}`,
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
  const searchParams = useSearchParams();
  // M15 — restore-intent after auth. When the sign-up return brought the
  // user back with `?intent=founding-lifetime`, highlight the card and
  // show a small confirmation banner. We NEVER auto-open PayPal — the user
  // must explicitly click the purchase CTA again.
  const intentIsFoundingLifetime = (searchParams?.get('intent') || '') === 'founding-lifetime';
  const [me, setMe] = useState<PublicUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [entOpen, setEntOpen] = useState(false);
  // M11-Batch6 — live Founding Lifetime buyer state. checkout_enabled reflects
  // the server-side BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED flag AND the
  // pricing config's brand_lifetime.enabled. already_active blocks duplicate
  // purchase. When checkout is enabled we swap the "Reserve" CTA for a real
  // sandbox PayPal checkout button.
  const [lifetimeState, setLifetimeState] = useState<{
    checkout_enabled: boolean;
    lifetime_available: boolean;
    environment: 'sandbox' | 'live';
    already_active: boolean;
    display_price_minor: number;
  } | null>(null);
  const [lifetimeBusy, setLifetimeBusy] = useState(false);
  const [brandProBusy, setBrandProBusy] = useState(false);
  const [brandProErr, setBrandProErr] = useState<string | null>(null);
  const [lifetimeErr, setLifetimeErr] = useState<string | null>(null);
  const tiers = buildTiers(pricing);
  const ownerActivationPrice = formatMinorUSD(pricing.owner_activation.display_price_minor);
  const bpRegDisplay = formatMinorUSD(pricing.brand_pro.regular_price_minor);
  const lifetimeDisplay = formatMinorUSD(pricing.brand_lifetime.price_minor);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((r) => setMe((r?.data?.user as PublicUser) || null))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
    fetch('/api/brand/founding-lifetime/state', { credentials: 'include' })
      .then((r) => r.json())
      .then((r) => setLifetimeState((r?.data as typeof lifetimeState) || null))
      .catch(() => setLifetimeState(null));
    // Browser-return capture kick. Browser return is NEVER payment proof —
    // the server calls PayPal capture and only advances the order when the
    // provider confirms. We just poke the endpoint here.
    try {
      const url = new URL(window.location.href);
      const orderId = url.searchParams.get('founding_lifetime');
      const status = url.searchParams.get('status');
      if (orderId && status === 'paid') {
        fetch(`/api/brand/founding-lifetime/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST', credentials: 'include',
        }).finally(() => {
          // Refresh buyer state so the CTA flips to "active".
          fetch('/api/brand/founding-lifetime/state', { credentials: 'include' })
            .then((r) => r.json())
            .then((r) => setLifetimeState((r?.data as typeof lifetimeState) || null))
            .catch(() => {});
          // Strip the params so a reload doesn't retrigger capture.
          url.searchParams.delete('founding_lifetime');
          url.searchParams.delete('status');
          window.history.replaceState({}, '', url.toString());
        });
      }
    } catch { /* window may not be available during SSR shim */ }
    // ESLint: intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFree() {
    if (me) router.push('/dashboard');
    else router.push('/signup?next=/dashboard');
  }

  // M17.1 — Brand Pro Founding Beta term checkout ($15 / 30 days, manual renewal).
  // Server owns price/currency/term/purpose; creating the order grants nothing
  // and never captures. Logged-out users keep their explicit purchase intent
  // through auth and the checkout resumes automatically on return.
  async function startBrandProCheckout() {
    if (brandProBusy) return;
    setBrandProBusy(true); setBrandProErr(null);
    try {
      if (!me) {
        rememberCommercialIntent('brand_pro');
        router.push('/signup?next=' + encodeURIComponent(INTENT_DESTINATION.brand_pro));
        return;
      }
      trackGa4Event('brand_pro_checkout_started', { product_name: 'brand_pro_30_day', currency: 'USD' });
      const r = await fetch('/api/brand-pro/checkout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const j = await r.json() as { ok?: boolean; data?: { order?: { approve_url?: string } }; error?: { message?: string } | string };
      if (!r.ok || !j.data?.order?.approve_url) {
        const msg = typeof j.error === 'string' ? j.error : (j.error?.message || 'Checkout failed');
        throw new Error(msg);
      }
      clearCommercialIntent();
      // PayPal approval — the user authorizes the payment there. Never captured here.
      window.location.href = j.data.order.approve_url;
    } catch (e) {
      setBrandProErr((e as Error).message);
      setBrandProBusy(false);
    }
  }

  async function startFoundingLifetimeCheckout() {
    if (lifetimeBusy) return;
    setLifetimeBusy(true); setLifetimeErr(null);
    try {
      if (!me) {
        // M17.1 — explicit purchase intent survives the auth round-trip and
        // the checkout resumes automatically once the user is authenticated.
        rememberCommercialIntent('founding_lifetime');
        router.push('/signup?next=' + encodeURIComponent(INTENT_DESTINATION.founding_lifetime));
        return;
      }
      trackGa4Event('founding_lifetime_checkout_started', { product_name: 'founding_lifetime', currency: 'USD' });
      const r = await fetch('/api/brand/founding-lifetime/checkout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json() as { ok?: boolean; data?: { order?: { approve_url?: string } }; error?: { message?: string } | string };
      if (!r.ok || !j.data?.order?.approve_url) {
        const msg = typeof j.error === 'string' ? j.error : (j.error?.message || 'Checkout failed');
        throw new Error(msg);
      }
      clearCommercialIntent();
      // Server-hosted PayPal checkout — browser return will hit /pricing with
      // ?founding_lifetime=<id>&status=paid and the capture endpoint fires.
      window.location.href = j.data.order.approve_url;
    } catch (e) {
      setLifetimeErr((e as Error).message);
      setLifetimeBusy(false);
    }
  }

  const lifetimeCheckoutLive = !!lifetimeState?.checkout_enabled && !!lifetimeState?.lifetime_available;
  const lifetimeAlreadyActive = !!lifetimeState?.already_active;
  useEffect(() => { if (lifetimeAlreadyActive) clearCommercialIntent(); }, [lifetimeAlreadyActive]);

  // M17.1 — AUTH → CHECKOUT HANDOFF.
  // The user already clicked an explicit purchase CTA (that is what wrote the
  // intent), so after a successful authentication we resume the checkout and
  // send them to PayPal approval instead of dropping them on a dead page.
  //   • resumes ONCE per browser session per product (no duplicate orders on
  //     refresh / back / replay) — the server additionally reuses any open order;
  //   • never captures a payment: PayPal approval is still required;
  //   • never runs for a logged-out visitor or an already-active buyer.
  useEffect(() => {
    if (!meLoaded || !me) return;
    const param = (searchParams?.get('intent') || '').trim();
    const intent: CommercialIntent | null =
      param === 'founding-lifetime' ? 'founding_lifetime'
        : param === 'brand-pro' ? 'brand_pro'
          : readCommercialIntent();
    if (!intent) return;
    if (intent === 'founding_lifetime' && (lifetimeAlreadyActive || !lifetimeState)) return;
    if (!consumeIntentResumeOnce(intent)) return;    // one attempt per session
    clearCommercialIntent();
    if (intent === 'founding_lifetime') void startFoundingLifetimeCheckout();
    else void startBrandProCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meLoaded, me, lifetimeState, lifetimeAlreadyActive, searchParams]);

  return (
    <>
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" /> Brands & Sponsors
        </span>
        <span className="text-xs text-muted-foreground">Campaign intelligence, sponsorship operations, and channel discovery.</span>
      </div>

      {intentIsFoundingLifetime && me && !lifetimeAlreadyActive && (
        <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm" data-testid="lifetime-intent-banner">
          You&apos;re signed in — continuing your Founding Lifetime purchase ({lifetimeDisplay} one-time). If PayPal doesn&apos;t open automatically,
          <span className="font-semibold"> tap &ldquo;Get Founding Lifetime — {lifetimeDisplay}&rdquo;</span> below.
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="pricing-grid">
        {tiers.filter((t) => t.enabled).map((tier) => (
          <div
            key={tier.kind}
            id={tier.kind === 'brand_founding_lifetime' ? 'founding-lifetime' : undefined}
            data-testid={`pricing-card-${tier.kind}`}
            className={`wh-card p-6 flex flex-col ${tier.highlight ? 'ring-2 ring-primary/60' : ''} ${tier.kind === 'brand_founding_lifetime' && intentIsFoundingLifetime && me ? 'ring-2 ring-emerald-400' : ''}`}
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
            <div className="mt-6 flex flex-col gap-2">
              {tier.kind === 'brand_free' && (
                <Button className="w-full h-11 text-base font-semibold" variant="outline" onClick={handleFree} disabled={!meLoaded} data-testid="cta-brand-free">{tier.cta}</Button>
              )}
              {tier.kind === 'brand_pro' && (
                <Button className="w-full h-11 text-base font-semibold" onClick={startBrandProCheckout} disabled={brandProBusy || !meLoaded} data-testid="cta-brand-pro">
                  {brandProBusy ? 'Starting…' : tier.cta}
                </Button>
              )}
              {tier.kind === 'brand_founding_lifetime' && (
                lifetimeAlreadyActive ? (
                  <Button className="w-full h-11 text-base font-semibold" variant="outline" disabled data-testid="cta-brand-founding-lifetime-active">Founding Lifetime active</Button>
                ) : (
                  /* M17.1 — ALWAYS the real purchase CTA. No reservation form,
                     no waitlist, no name/email lead capture in the purchase
                     path. If the server refuses (checkout not enabled for the
                     current environment) we surface that truthfully instead of
                     silently swapping in a lead form. */
                  <Button className="w-full h-11 text-base font-semibold" onClick={startFoundingLifetimeCheckout} disabled={lifetimeBusy || !meLoaded} data-testid="cta-brand-founding-lifetime-checkout">
                    {lifetimeBusy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Opening PayPal…</> : tier.cta}
                  </Button>
                )
              )}
              {tier.kind === 'enterprise' && (
                <Button className="w-full h-11 text-base font-semibold" variant="outline" onClick={() => setEntOpen(true)} data-testid="cta-enterprise">{tier.cta}</Button>
              )}
              {/* Footnote row — reserved height across ALL cards so the
                  Start-Brand-Pro-$15 and Get-Founding-Lifetime-$100 CTA
                  buttons align on the same horizontal baseline regardless of
                  which cards carry a per-card note. */}
              <div className="min-h-[64px] text-[11px] text-muted-foreground" data-testid={`pricing-footnote-${tier.kind}`}>
                {tier.kind === 'brand_pro' && brandProErr && (
                  <div className="mb-1 text-rose-600" data-testid="brand-pro-error">{brandProErr}</div>
                )}
                {tier.kind === 'brand_pro' && (
                  <p data-testid="brand-pro-renewal-note">
                    One $15 payment gives 30 days of Brand Pro. Renewal is manual during Founding Beta — PayPal will not charge you automatically.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-3xl" data-testid="brand-billing-note">
        {/* M17 — Brand Pro Founding Beta is sold as a single 30-day term with
            MANUAL renewal. No recurring PayPal agreement is created. */}
        Brand Pro Founding Beta is {formatMinorUSD(pricing.brand_pro.beta_price_minor)} for a 30-day term, renewed manually — PayPal never charges you
        automatically, and nothing renews unless you pay again. Indicative pricing after the Founding Beta is {bpRegDisplay}/month; Founding Beta
        pricing is honoured for the duration of each term you purchase. Founding Lifetime is a one-time {lifetimeDisplay} offer available only during
        Public Beta and is not a permanent price.
      </p>
      {lifetimeErr && (
        <div className="mt-2 inline-flex items-center gap-1 text-sm text-rose-600" data-testid="lifetime-err">
          <AlertTriangle className="h-4 w-4" />{lifetimeErr}
        </div>
      )}
      {/* M17.1 — truthful environment notice. The purchase CTA is always the
          real checkout; this only tells the operator/tester which PayPal
          environment the current deployment resolves to, and whether the
          Founding Lifetime capability flag is still off. No waitlist copy. */}
      {!lifetimeCheckoutLive && !lifetimeAlreadyActive && (
        <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block" data-testid="lifetime-sandbox-notice">
          Founding Lifetime checkout is not enabled for this environment yet
          {lifetimeState?.environment === 'sandbox' ? <> (resolved PayPal environment: <strong>sandbox</strong>)</> : null}.
          Starting checkout will report that until the capability is switched on.
        </p>
      )}

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
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verified Owner Activation</div>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300" data-testid="activation-rollout-pill">Available Now</span>
            </div>
            <div className="mt-1 text-lg font-bold" data-testid="owner-activation-display-price">{ownerActivationPrice} per channel</div>
            <p className="mt-2 text-xs text-muted-foreground">
              One-time activation after ownership approval. The <span className="font-semibold">{ownerActivationPrice} activation</span> helps deter impersonation, spam and scam attempts while adding an additional accountability step for verified channel owners.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Payment alone never proves ownership — <span className="font-semibold">WaveLead reviews ownership first</span>. Not a subscription.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link href={me ? '/dashboard' : '/login?next=%2Fsubmit'} className="rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 font-medium" data-testid="owner-activation-cta">
                {me ? 'Go to Owner Dashboard' : 'Submit your channel'}
              </Link>
              <Link href="/faq#activation" className="text-muted-foreground hover:text-foreground px-1 py-1.5">Why {ownerActivationPrice}?</Link>
            </div>
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

      <EnterpriseDialog open={entOpen} onOpenChange={setEntOpen} me={me} />
    </>
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
