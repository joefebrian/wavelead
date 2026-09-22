// M19.2 — Admin Support Inbox (list view). Server component.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { supportService } from '@/lib/services/supportService';

export const dynamic = 'force-dynamic';

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/support');
  if (rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/dashboard');
  const sp = await searchParams;
  const raw = (sp?.status || 'all') as string;
  const allowed = new Set(['all', 'open', 'awaiting_admin', 'awaiting_user', 'closed']);
  const status = (allowed.has(raw) ? raw : 'all') as 'all' | 'open' | 'awaiting_admin' | 'awaiting_user' | 'closed';
  const [tickets, stats] = await Promise.all([
    supportService.adminListTickets({ status }),
    supportService.adminStats(),
  ]);

  const tabs: Array<{ key: 'all' | 'awaiting_admin' | 'awaiting_user' | 'closed'; label: string; count?: number }> = [
    { key: 'awaiting_admin', label: 'Awaiting reply', count: stats.awaiting_admin },
    { key: 'awaiting_user', label: 'Awaiting user', count: stats.awaiting_user },
    { key: 'closed', label: 'Closed', count: stats.closed },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support inbox</h1>
          <p className="text-sm text-muted-foreground">Threaded chat with public visitors and users.</p>
        </div>
        <div className="text-xs text-muted-foreground" data-testid="support-admin-unread">Unread awaiting reply: <strong className="text-foreground">{stats.total_unread_admin}</strong></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = status === t.key;
          return (
            <Link key={t.key} href={`/admin/support?status=${t.key}`}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              data-testid={`support-tab-${t.key}`}>
              {t.label}{typeof t.count === 'number' ? <span className="ml-1 rounded bg-black/10 px-1.5">{t.count}</span> : null}
            </Link>
          );
        })}
      </div>
      <div className="mt-4 overflow-hidden rounded-md border border-border">
        {tickets.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No tickets in this view.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Requester</th><th className="px-3 py-2">Last message</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Unread</th><th className="px-3 py-2">Updated</th></tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/30" data-testid={`support-row-${t.id}`}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/support/${t.id}`} className="font-medium hover:underline">{t.requester_name || t.requester_email}</Link>
                    <div className="text-[11px] text-muted-foreground">{t.requester_email}</div>
                  </td>
                  <td className="px-3 py-2"><Link href={`/admin/support/${t.id}`} className="text-muted-foreground hover:text-foreground">{t.last_message_preview}</Link></td>
                  <td className="px-3 py-2"><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">{t.status.replace(/_/g, ' ')}</span></td>
                  <td className="px-3 py-2">{t.unread_by_admin > 0 ? <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{t.unread_by_admin}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(t.last_message_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
