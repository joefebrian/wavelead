import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { changeRequestModerationService } from '@/lib/services/changeRequestModerationService';
import ChannelChangeActionClient from './ChannelChangeActionClient';

export const metadata: Metadata = { title: 'Sensitive channel changes — Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function AdminChangeRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/channel-changes');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403</h1>
          <p className="text-muted-foreground mt-2">Moderator access required.</p>
        </main>
        <Footer />
      </>
    );
  }
  const sp = await searchParams;
  const status = STATUSES.find((s) => s.value === sp.status)?.value ?? 'pending';
  const items = await changeRequestModerationService.listQueue(actor, { status });

  return (
    <>
      <Header />
      <main className="container py-8 max-w-5xl">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Sensitive channel changes</h1>
            <p className="text-sm text-muted-foreground mt-1">Owners submit these when they want to change a channel&apos;s identity fields. Public listings do NOT change until you approve.</p>
          </div>
          <Link href="/admin"><Button variant="outline" size="sm">Admin home</Button></Link>
        </div>

        <div className="mt-6 flex gap-2 flex-wrap border-b border-border">
          {STATUSES.map((s) => (
            <Link key={s.value} href={`/admin/channel-changes?status=${s.value}`} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${status === s.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{s.label}</Link>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="mt-10 wh-card p-10 text-center"><div className="font-semibold">No requests in this state</div></div>
        ) : (
          <div className="mt-6 grid gap-4">
            {items.map((r) => (
              <div key={r.id} className="wh-card p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{r.channel?.name || r.channel_id}</span>
                      <Badge variant="secondary">{r.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Submitted {new Date(r.submitted_at).toLocaleString()} by {r.owner?.email || r.owner_id}</div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  {Object.entries(r.changes as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="grid md:grid-cols-[140px_1fr_1fr] gap-1 md:gap-3 border-t border-border/40 pt-2">
                      <div className="font-mono text-xs text-muted-foreground">{k}</div>
                      <div className="text-xs"><span className="text-muted-foreground">Current:</span> <code className="break-all">{String((r.channel as unknown as Record<string, unknown>)?.[k] ?? '—')}</code></div>
                      <div className="text-xs"><span className="text-muted-foreground">Requested:</span> <code className="break-all">{String(v ?? '—')}</code></div>
                    </div>
                  ))}
                </div>
                {status === 'pending' && (
                  <div className="mt-4"><ChannelChangeActionClient requestId={r.id} /></div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
