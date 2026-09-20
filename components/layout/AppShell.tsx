'use client';
// M18 — One authenticated shell for User, Channel Owner, Brand and Admin.
//
// Desktop : left sidebar + top utility bar + main content area
// Mobile  : compact header + drawer navigation
//
// Admin is the SAME product with a privileged accent, not a different visual
// application. Nav items are pre-filtered by role on the server (see the
// dashboard/admin layouts) — this component only renders what it is given.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import BrandLogo from '@/components/brand/BrandLogo';
import { isNavItemActive, type NavGroup } from '@/lib/constants/navigation';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] || Icons.Circle;
  return <Cmp className={className} aria-hidden="true" />;
}

export interface AppShellUser {
  email: string;
  display_name: string | null;
  role: string;
}

export default function AppShell({
  groups, user, context, children,
}: {
  groups: NavGroup[];
  user: AppShellUser;
  /** 'product' = user/owner/brand workspace, 'admin' = privileged console. */
  context: 'product' | 'admin';
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const isAdmin = context === 'admin';

  useEffect(() => { setOpen(false); }, [pathname]);   // close drawer on navigate

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={isAdmin ? 'Admin navigation' : 'Workspace navigation'}>
      {groups.map((g) => (
        <div key={g.label} className="mb-5" data-testid={`nav-group-${g.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    data-active={active ? 'true' : 'false'}
                    data-testid={`nav-item-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.badge && <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{item.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const sidebarHeader = (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <Link href="/" className="flex items-center gap-2" aria-label="WaveLead home">
        <BrandLogo size="sm" />
      </Link>
      {isAdmin && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Admin</span>}
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/20" data-testid={isAdmin ? 'app-shell-admin' : 'app-shell'}>
      {/* ---------------------------------------------------- desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-background lg:flex" data-testid="app-sidebar">
        {sidebarHeader}
        {nav}
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <div className="truncate font-medium text-foreground">{user.display_name || user.email}</div>
          <div className="truncate">{user.role.replace(/_/g, ' ')}</div>
        </div>
      </aside>

      {/* ------------------------------------------------------- mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" data-testid="app-drawer">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-background shadow-xl">
            {sidebarHeader}
            {nav}
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* ------------------------------------------------- top utility bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6" data-testid="app-topbar">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border lg:hidden"
            aria-label="Open navigation"
            data-testid="app-nav-toggle"
          >
            <Icons.Menu className="h-4 w-4" />
          </button>
          <Link href="/" className="lg:hidden" aria-label="WaveLead home"><BrandLogo size="sm" /></Link>

          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/channels" className="hidden rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex">
              Browse channels
            </Link>
            {isAdmin ? (
              <Link href="/dashboard" className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="topbar-to-dashboard">
                My workspace
              </Link>
            ) : (
              <Link href="/dashboard/settings/security" className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                Settings
              </Link>
            )}
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
                window.location.href = '/';
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              data-testid="app-signout"
            >
              <Icons.LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </header>

        {/* ------------------------------------------------------ content area */}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8" data-testid="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
