'use client';

import Link from 'next/link';
import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Radio, Menu, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicUser } from '@/lib/types';

export default function Header() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((r) => setMe((r?.data?.user as PublicUser) || null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setMe(null);
    window.location.href = '/';
  }

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = q.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/channels');
    setOpen(false);
  }

  const nav = [
    { href: '/channels', label: 'Discover' },
    { href: '/trending', label: 'Trending' },
    { href: '/top', label: 'Top Channels' },
    { href: '/categories', label: 'Categories' },
    { href: '/for-brands', label: 'For Brands' },
    { href: '/pricing', label: 'Pricing' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="container flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Radio className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">WaveLead</span>
        </Link>

        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground transition-colors whitespace-nowrap">{n.label}</Link>
          ))}
        </nav>

        <form onSubmit={onSearchSubmit} className="hidden xl:flex flex-1 min-w-0 max-w-sm items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search channels…"
            aria-label="Search channels"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </form>

        <div className="flex-1 xl:hidden" />

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Link href="/submit" className="hidden lg:inline-flex"><Button variant="outline" size="sm">Submit Channel</Button></Link>
          {loading ? (
            <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
          ) : me ? (
            <>
              {(me.role === 'super_admin' || me.role === 'admin' || me.role === 'moderator') && (
                <Link
                  href={me.role === 'moderator' ? '/admin/moderation' : '/admin'}
                  aria-label="Admin Console"
                >
                  <Button variant="outline" size="sm">Admin Console</Button>
                </Link>
              )}
              <Link href="/dashboard"><Button variant="ghost" size="sm">Dashboard</Button></Link>
              <Button size="sm" onClick={logout}>Log out</Button>
            </>
          ) : (
            <>
              <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
              <Link href="/signup"><Button size="sm">Get Started</Button></Link>
            </>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/60 bg-background">
          <div className="container py-3 flex flex-col gap-2">
            <form onSubmit={onSearchSubmit} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" className="flex-1 bg-transparent text-sm outline-none" />
            </form>
            {nav.map((n) => (<Link key={n.href} href={n.href} className="py-2 text-sm font-medium" onClick={() => setOpen(false)}>{n.label}</Link>))}
            <Link href="/submit" className="py-2 text-sm font-medium" onClick={() => setOpen(false)}>Submit Channel</Link>
            <div className="flex gap-2 pt-2 border-t border-border/60">
              {me ? (
                <>
                  {(me.role === 'super_admin' || me.role === 'admin' || me.role === 'moderator') && (
                    <Link
                      href={me.role === 'moderator' ? '/admin/moderation' : '/admin'}
                      className="flex-1"
                      onClick={() => setOpen(false)}
                    >
                      <Button variant="outline" className="w-full">Admin Console</Button>
                    </Link>
                  )}
                  <Link href="/dashboard" className="flex-1"><Button variant="outline" className="w-full">Dashboard</Button></Link>
                  <Button className="flex-1" onClick={logout}>Log out</Button>
                </>
              ) : (
                <>
                  <Link href="/login" className="flex-1"><Button variant="outline" className="w-full">Log in</Button></Link>
                  <Link href="/signup" className="flex-1"><Button className="w-full">Get Started</Button></Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
