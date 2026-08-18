'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Radio, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Header() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(r => setMe(r?.data?.user || null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setMe(null);
    window.location.href = '/';
  }

  const nav = [
    { href: '/channels', label: 'Discover' },
    { href: '/trending', label: 'Trending' },
    { href: '/submit', label: 'Submit Channel' },
    { href: '/pricing', label: 'Pricing' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Radio className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">WaveHub</span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
          {nav.map(n => (
            <Link key={n.href} href={n.href} className="hover:text-foreground transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {loading ? (
            <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
          ) : me ? (
            <>
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">Dashboard</Button>
              </Link>
              <Button size="sm" onClick={logout}>Log out</Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">Log in</Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/60 bg-background">
          <div className="container py-3 flex flex-col gap-2">
            {nav.map(n => (
              <Link key={n.href} href={n.href} className="py-2 text-sm font-medium">
                {n.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2 border-t border-border/60">
              {me ? (
                <>
                  <Link href="/dashboard" className="flex-1"><Button variant="outline" className="w-full">Dashboard</Button></Link>
                  <Button className="flex-1" onClick={logout}>Log out</Button>
                </>
              ) : (
                <>
                  <Link href="/login" className="flex-1"><Button variant="outline" className="w-full">Log in</Button></Link>
                  <Link href="/signup" className="flex-1"><Button className="w-full">Get started</Button></Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
