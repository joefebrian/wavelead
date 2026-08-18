'use client';

import { useRouter } from 'next/navigation';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { POPULAR_SEARCHES } from '@/lib/constants/discovery';

interface Props { initialQuery?: string; totalApproved?: number; }

export default function HeroSearch({ initialQuery = '', totalApproved }: Props) {
  const [q, setQ] = useState(initialQuery);
  const router = useRouter();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) { router.push('/channels'); return; }
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <section className="wh-gradient-hero border-b border-border/60">
      <div className="container py-12 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">Discover WhatsApp Channels</div>
          <h1 className="mt-3 text-3xl md:text-5xl font-extrabold tracking-tight text-foreground">
            Find channels worth following.
          </h1>
          <p className="mt-3 text-base md:text-lg text-muted-foreground">
            Explore creators, news, sports, entertainment, finance, deals, communities and more from around the world.
          </p>

          <form onSubmit={submit} className="mt-7 flex items-stretch gap-2 rounded-2xl bg-card border border-border shadow-sm p-2 focus-within:ring-2 focus-within:ring-primary/40">
            <div className="flex items-center pl-3 text-muted-foreground">
              <Search className="h-5 w-5" aria-hidden />
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search channels, topics, creators or interests…"
              aria-label="Search channels"
              className="flex-1 bg-transparent px-2 py-3 text-base outline-none placeholder:text-muted-foreground/70"
              autoComplete="off"
            />
            <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:brightness-110 transition">
              <Search className="h-4 w-4" /> <span className="hidden sm:inline">Search</span>
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">Popular:</span>
            {POPULAR_SEARCHES.map((p) => (
              <Link key={p} href={`/search?q=${encodeURIComponent(p.toLowerCase())}`}
                className="rounded-full border border-border bg-card px-3 py-1 text-foreground hover:border-primary/40 hover:text-primary transition">
                {p}
              </Link>
            ))}
          </div>
          {typeof totalApproved === 'number' && (
            <p className="mt-6 text-xs text-muted-foreground">Currently exploring <span className="font-semibold text-foreground">{totalApproved.toLocaleString()}</span> approved channels.</p>
          )}
        </div>
      </div>
    </section>
  );
}
