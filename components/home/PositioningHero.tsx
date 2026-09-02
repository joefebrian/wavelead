'use client';

// Public Beta positioning hero. Replaces the discovery-only HeroSearch on
// the homepage. Keeps a compact search so discovery intent isn't lost.
//
// Positioning is LOCKED:
//   H1     : "The Growth & Monetization Platform for WhatsApp Channels"
//   Sub    : Discover + grow + sponsor + measure
//   CTA #1 : Explore Channels → /channels
//   CTA #2 : List Your Channel → /submit
//   Tert.  : For Brands & Agencies → /channels
// Never claims WhatsApp / Meta affiliation.
import React, { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PositioningHero({ totalApproved }: { totalApproved?: number }) {
  const [q, setQ] = useState('');
  const router = useRouter();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/channels');
  }

  return (
    <section className="wh-gradient-hero border-b border-border/60" data-testid="home-hero">
      <div className="container py-12 md:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold uppercase tracking-widest px-3 py-1">
            <Sparkles className="h-3 w-3" /> Public Beta
          </div>
          <h1
            className="mt-4 text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground"
            data-testid="hero-h1"
          >
            The Growth &amp; Monetization Platform for WhatsApp Channels
          </h1>
          <p className="mt-4 text-base md:text-lg text-muted-foreground" data-testid="hero-subhead">
            Discover channels, grow audiences, manage sponsorships and measure what drives results — all in one place.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/channels" data-testid="hero-cta-primary">
              <Button size="lg" className="gap-1.5">Explore Channels <ArrowRight className="h-4 w-4" /></Button>
            </Link>
            <Link href="/submit" data-testid="hero-cta-secondary">
              <Button size="lg" variant="outline">List Your Channel</Button>
            </Link>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            <Link href="/channels" className="hover:text-primary underline underline-offset-2" data-testid="hero-cta-tertiary">
              For Brands &amp; Agencies →
            </Link>
          </div>
          <form onSubmit={submit} className="mt-8 max-w-xl mx-auto" role="search" aria-label="Search WaveLead">
            <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 shadow-sm">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search channels by name, category, country…"
                className="w-full py-3 bg-transparent text-sm outline-none"
                aria-label="Search channels"
              />
              <Button type="submit" size="sm" className="rounded-full">Search</Button>
            </div>
          </form>
          {typeof totalApproved === 'number' && totalApproved > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              {totalApproved.toLocaleString()} channels indexed and growing.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
