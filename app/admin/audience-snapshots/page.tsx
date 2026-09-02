import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { audienceSnapshotService } from '@/lib/services/audienceSnapshotService';

export const metadata: Metadata = { title: 'Audience Evidence — Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminAudienceSnapshotsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/audience-snapshots');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Moderator access required</h1>
        </main>
        <Footer />
      </>
    );
  }

  const { items } = await audienceSnapshotService.adminListPending(actor);

  return (
    <>
      <Header />
      <main className="container py-8">
        <AdminNav active="/admin/audience-snapshots" />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Follower Evidence Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">Review owner-submitted screenshots of WhatsApp follower counts.</p>
          </div>
          <div className="text-sm text-muted-foreground" data-testid="pending-count">{items.length} pending</div>
        </div>

        {items.length === 0 ? (
          <div className="mt-6 wh-card p-6 text-sm text-muted-foreground" data-testid="queue-empty">No pending follower evidence right now.</div>
        ) : (
          <ul className="mt-6 grid gap-3" data-testid="queue-list">
            {items.map((it) => (
              <li key={it.id} className="wh-card p-4 flex flex-col md:flex-row md:items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.evidence_attachment.url} alt="evidence" className="h-16 w-16 object-cover rounded border border-border shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {it.channel?.name ? <Link className="hover:underline" href={`/channel/${it.channel.slug}`}>{it.channel.name}</Link> : 'Unknown channel'}
                  </div>
                  <div className="text-sm">Owner reports <span className="font-semibold">{Number(it.followers).toLocaleString()}</span> followers</div>
                  <div className="text-xs text-muted-foreground">Submitted {new Date(it.reported_at).toLocaleString()}{it.evidence_date ? ` · evidence dated ${new Date(it.evidence_date).toLocaleDateString()}` : ''}</div>
                  {it.submission_note && <div className="mt-1 text-xs text-muted-foreground italic">“{it.submission_note}”</div>}
                </div>
                <div>
                  <Link href={`/admin/audience-snapshots/${it.id}`}>
                    <Button size="sm" data-testid={`review-${it.id}`}>Review</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}
