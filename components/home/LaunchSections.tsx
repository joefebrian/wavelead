// Public Beta launch sections — persona entry, product loop, owner value,
// brand value, trust, pricing teaser, final CTA. Static server component so
// it stays crawlable and cheap to render. Copy is LOCKED per launch spec.
//
// Rules baked in:
//   • Never claim affiliation with WhatsApp / Meta.
//   • Free users can earn — Pro features are LABELED.
//   • "Payment Protection" (never "Escrow") on public surfaces.
//   • Agency copy is honest: portfolio tools are "expanding", not shipped.
//   • Every href points at an existing route.
import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Megaphone, Handshake, Users, Compass, TrendingUp, Wallet, BarChart3, ShieldCheck,
  CheckCircle2, FileText, PackageCheck, RefreshCw, Sparkles, ArrowRight, Kanban,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Persona entry — three paths
// ---------------------------------------------------------------------------
export function PersonaEntry() {
  return (
    <section className="container py-14" data-testid="home-persona-entry">
      <div className="text-center max-w-2xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-bold">What do you want to do with WaveLead?</h2>
        <p className="mt-2 text-muted-foreground">Pick the path that fits — you can switch anytime.</p>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <PathCard
          testid="path-owner"
          icon={<Megaphone className="h-5 w-5" />}
          title="For Channel Owners"
          desc="Grow your channel and turn audience attention into revenue."
          bullets={[
            'List or claim your channel',
            'Understand channel performance',
            'Promote your channel',
            'Create sponsorship packages',
            'Manage sponsorships',
            'Track earnings',
          ]}
          cta="Grow & Monetize"
          href="/submit"
        />
        <PathCard
          testid="path-brand"
          highlight
          icon={<Handshake className="h-5 w-5" />}
          title="For Brands"
          desc="Find WhatsApp Channels that fit your audience and sponsor them directly."
          bullets={[
            'Discover channels',
            'Review channel profiles',
            'Review sponsorship packages',
            'Book sponsorships',
            'Track delivery',
          ]}
          cta="Find Channels"
          href="/channels"
        />
        <PathCard
          testid="path-agency"
          icon={<Users className="h-5 w-5" />}
          title="For Agencies"
          desc="Discover and manage opportunities across multiple channels."
          bullets={[
            'Discover across categories & regions',
            'Track sponsorship activity',
            'Portfolio tools for agencies and operators are expanding',
          ]}
          cta="Explore WaveLead"
          href="/channels"
        />
      </div>
    </section>
  );
}

function PathCard({ testid, icon, title, desc, bullets, cta, href, highlight }: {
  testid: string; icon: React.ReactNode; title: string; desc: string; bullets: string[]; cta: string; href: string; highlight?: boolean;
}) {
  return (
    <div
      className={`wh-card p-6 flex flex-col ${highlight ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}
      data-testid={testid}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="rounded-lg bg-primary/10 text-primary p-1.5">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-foreground/90 flex-1">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link href={href} className="mt-5">
        <Button className="w-full gap-1.5" variant={highlight ? 'default' : 'outline'}>
          {cta} <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Core product loop
// ---------------------------------------------------------------------------
export function ProductLoop() {
  const steps = [
    { icon: <Compass className="h-5 w-5" />, title: 'Discover', desc: 'Find channels by category, country and relevance.' },
    { icon: <TrendingUp className="h-5 w-5" />, title: 'Grow',     desc: 'Understand what drives channel discovery and follow intent.' },
    { icon: <Wallet className="h-5 w-5" />,    title: 'Monetize', desc: 'Create sponsorship packages and receive brand opportunities.' },
    { icon: <BarChart3 className="h-5 w-5" />, title: 'Measure',  desc: 'Track sponsorship activity, earnings and performance.' },
  ];
  return (
    <section className="border-y border-border/60 bg-muted/30" data-testid="home-product-loop">
      <div className="container py-12">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold">One loop, from discovery to results</h2>
          <p className="mt-2 text-muted-foreground">WaveLead ties audience growth to real sponsorship outcomes.</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.title} className="wh-card p-5">
              <div className="rounded-lg bg-primary/10 text-primary p-2 w-max">{s.icon}</div>
              <div className="mt-3 font-semibold">{s.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Owner value — only shipping capabilities. Pro items labeled.
// ---------------------------------------------------------------------------
export function OwnerValue() {
  const items: Array<{ icon: React.ReactNode; title: string; desc: string; badge?: 'Pro' | null }> = [
    { icon: <BarChart3 className="h-5 w-5" />, title: 'Channel analytics',   desc: 'Discovery clicks, follow-intent and basic performance.' },
    { icon: <Megaphone className="h-5 w-5" />, title: 'Promote Channel',      desc: 'Pay-per-campaign visibility boost in USD via PayPal.' },
    { icon: <PackageCheck className="h-5 w-5" />, title: 'Sponsorship packages', desc: 'Publish rate cards brands can book directly.' },
    { icon: <Kanban className="h-5 w-5" />,    title: 'Sponsorship Pipeline', desc: 'Kanban across active opportunities with attention signals.', badge: 'Pro' },
    { icon: <TrendingUp className="h-5 w-5" />,title: 'Revenue Intelligence', desc: 'Gross revenue, fees, conversion funnel and 12-month trend.', badge: 'Pro' },
    { icon: <Wallet className="h-5 w-5" />,    title: 'Earnings',              desc: 'Pending, available for payout and paid-out buckets.' },
    { icon: <ShieldCheck className="h-5 w-5" />, title: 'Payment Protection', desc: 'Buyer pays into WaveLead; funds release after delivery.' },
  ];
  return (
    <section className="container py-14" data-testid="home-owner-value">
      <div className="max-w-2xl">
        <h2 className="text-2xl md:text-3xl font-bold">Turn your WhatsApp Channel into a growth and revenue asset.</h2>
        <p className="mt-2 text-muted-foreground">
          Free plan participates fully in the marketplace — you can receive sponsorships and earn on WaveLead without upgrading.
          Pro unlocks growth intelligence when you&apos;re ready.
        </p>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="wh-card p-5">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-primary/10 text-primary p-2 w-max">{it.icon}</div>
              {it.badge && (
                <Badge className="uppercase tracking-wider text-[10px]" data-testid={`owner-value-badge-${it.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Sparkles className="h-3 w-3 mr-1" /> {it.badge}
                </Badge>
              )}
            </div>
            <div className="mt-3 font-semibold">{it.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 text-sm text-muted-foreground">
        <Link href="/pricing" className="text-primary hover:underline">See what&apos;s in each plan →</Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brand value — marketplace flow. Use Payment Protection terminology.
// ---------------------------------------------------------------------------
export function BrandValue() {
  const flow = [
    { icon: <Compass className="h-4 w-4" />,     label: 'Discover' },
    { icon: <FileText className="h-4 w-4" />,    label: 'Review package' },
    { icon: <Handshake className="h-4 w-4" />,   label: 'Book' },
    { icon: <Wallet className="h-4 w-4" />,      label: 'Pay' },
    { icon: <PackageCheck className="h-4 w-4" />,label: 'Delivery' },
    { icon: <RefreshCw className="h-4 w-4" />,   label: 'Review / Revise' },
    { icon: <CheckCircle2 className="h-4 w-4" />,label: 'Complete' },
  ];
  return (
    <section className="border-y border-border/60 bg-muted/30" data-testid="home-brand-value">
      <div className="container py-14">
        <div className="max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold">Find channels. Sponsor creators. Track delivery.</h2>
          <p className="mt-2 text-muted-foreground">
            A protected marketplace flow from booking to completion. Every step is visible; payments are held under
            Payment Protection until the work is accepted.
          </p>
        </div>
        <ol className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-3">
          {flow.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="wh-card px-3 py-2 flex items-center gap-2 text-sm">
                <span className="text-primary">{s.icon}</span>
                <span>{s.label}</span>
              </span>
              {i < flow.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <Link href="/channels">
            <Button variant="outline" className="gap-1.5">Explore Channels <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trust — real product mechanisms only. No fake claims.
// ---------------------------------------------------------------------------
export function TrustSection() {
  const items = [
    { title: 'Verified ownership',        desc: 'Channels are moderated and ownership is verified before monetization.' },
    { title: 'Clear sponsorship packages',desc: 'Owners publish rate cards; brands see exactly what they book.' },
    { title: 'Payment Protection',        desc: 'Buyer payments are held by WaveLead and released after the buyer accepts delivery.' },
    { title: 'Versioned delivery evidence', desc: 'Every submission and revision is versioned with proof attachments.' },
    { title: 'Buyer review & revision',   desc: 'Brands can request revisions before accepting a delivery.' },
    { title: 'Transparent earnings',      desc: 'Owners see pending, available and paid-out balances in real time.' },
  ];
  return (
    <section className="container py-14" data-testid="home-trust">
      <div className="max-w-2xl">
        <h2 className="text-2xl md:text-3xl font-bold">Built for creators and brands who want to sponsor with confidence.</h2>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="wh-card p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div className="font-semibold">{it.title}</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing teaser — matches Phase 3 architecture. NO subscription checkout.
// ---------------------------------------------------------------------------
export function PricingTeaser() {
  const tiers = [
    { name: 'Free',       status: 'Active',         positioning: 'Start and monetize your WhatsApp Channel',        cta: 'Get Started',       href: '/signup', price: '$0 Forever' },
    { name: 'Pro',        status: 'Founding Beta',  positioning: 'Growth & Revenue Intelligence for serious channel operators', cta: 'Join Pro Waitlist', href: '/pricing', highlight: true, price: '$19 / mo' },
    { name: 'Enterprise', status: 'Contact Sales',  positioning: 'Channel Business OS for agencies and portfolio operators', cta: 'Contact Sales', href: '/pricing', price: 'Custom' },
  ];
  return (
    <section className="border-y border-border/60 bg-muted/30" data-testid="home-pricing-teaser">
      <div className="container py-14">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold">Pricing that respects creators</h2>
          <p className="mt-2 text-muted-foreground">
            Free covers the full sponsorship money loop. Paid tiers add growth &amp; revenue intelligence and multi-channel operations.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`wh-card p-6 flex flex-col ${t.highlight ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}
              data-testid={`pricing-teaser-${t.name.toLowerCase()}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">{t.name}</div>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${
                    t.status === 'Active'
                      ? 'text-emerald-700 bg-emerald-100'
                      : t.status === 'Coming Soon'
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground bg-muted'
                  }`}
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t.positioning}</p>
              <div className="mt-1 text-sm font-semibold">{t.price}</div>
              <Link href={t.href} className="mt-auto pt-5">
                <Button className="w-full" variant={t.highlight ? 'default' : 'outline'}>{t.cta}</Button>
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link href="/pricing" className="text-sm text-primary hover:underline">View Pricing →</Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------
export function FinalCta() {
  return (
    <section className="container py-16" data-testid="home-final-cta">
      <div className="wh-card p-8 md:p-12 text-center bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <h2 className="text-2xl md:text-3xl font-bold">Ready to grow your channel — or find your next audience?</h2>
        <p className="mt-2 text-muted-foreground">WaveLead is in Public Beta. Join and shape what comes next.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/channels"><Button size="lg" className="gap-1.5">Explore Channels <ArrowRight className="h-4 w-4" /></Button></Link>
          <Link href="/submit"><Button size="lg" variant="outline">List Your Channel</Button></Link>
        </div>
      </div>
    </section>
  );
}
