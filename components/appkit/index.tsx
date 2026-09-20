// M18 — Shared authenticated UI primitives.
//
// Small, composable and deliberately thin: these exist so page headers, cards,
// tables, badges and empty states stop drifting apart across the User, Owner,
// Brand and Admin surfaces. No new abstraction layer over shadcn — they wrap
// Tailwind tokens the rest of the app already uses.
import Link from 'next/link';
import type { ReactNode } from 'react';

/* ------------------------------------------------------------- page header */
export function PageHeader({
  title, description, actions, breadcrumb, testId = 'page-header',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { href: string; label: string };
  testId?: string;
}) {
  return (
    <div className="mb-6" data-testid={testId}>
      {breadcrumb && (
        <Link href={breadcrumb.href} className="text-xs text-muted-foreground hover:text-foreground">
          &larr; {breadcrumb.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- containers */
export function SectionCard({
  title, description, actions, children, className = '', testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card p-5 shadow-sm ${className}`} data-testid={testId}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label, value, hint, icon, testId,
}: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- data tables */
export function DataTable({ head, children, testId }: { head: ReactNode[]; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

/* ------------------------------------------------------------ status/empty */
const TONES = {
  neutral: 'bg-muted text-foreground/80 border-border',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  danger: 'bg-rose-50 text-rose-800 border-rose-200',
} as const;
export type Tone = keyof typeof TONES;

export function StatusBadge({ tone = 'neutral', children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}

export function EmptyState({
  title, description, action, icon, testId = 'empty-state',
}: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center" data-testid={testId}>
      {icon && <div className="mb-2 flex justify-center text-muted-foreground">{icon}</div>}
      <div className="font-medium">{title}</div>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- banners */
export function InfoBanner({ children, tone = 'info', testId }: { children: ReactNode; tone?: Tone; testId?: string }) {
  return <div className={`rounded-md border px-3 py-2.5 text-sm ${TONES[tone]}`} data-testid={testId}>{children}</div>;
}

export function WarningBanner({ children, testId }: { children: ReactNode; testId?: string }) {
  return <InfoBanner tone="warning" testId={testId}>{children}</InfoBanner>;
}

/* -------------------------------------------------------------------- form */
export function FormSection({
  title, description, children, testId,
}: { title: string; description?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="mb-6" data-testid={testId}>
      <div className="text-sm font-semibold">{title}</div>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}

/** Shared input class so every form field matches across the product. */
export const fieldClass = 'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

/* -------------------------------------------------------------------- tabs */
export function SectionTabs({
  tabs, active, testId = 'section-tabs',
}: { tabs: { href: string; label: string; count?: number }[]; active: string; testId?: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-border" data-testid={testId}>
      {tabs.map((t) => {
        const on = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${on ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}{typeof t.count === 'number' && <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
