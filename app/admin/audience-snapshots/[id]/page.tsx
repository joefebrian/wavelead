import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { audienceSnapshotService } from '@/lib/services/audienceSnapshotService';
import ReviewActions from './ReviewActions';

export const metadata: Metadata = { title: 'Follower Evidence — Review', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

export default async function AdminAudienceSnapshotDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/admin/audience-snapshots/${id}`);
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center"><h1 className="text-3xl font-bold">403 — Moderator access required</h1></main>
        <Footer />
      </>
    );
  }

  let data;
  try { data = await audienceSnapshotService.adminGetById(actor, id); }
  catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404) notFound();
    throw e;
  }
  const { snapshot, channel } = data;
  const canAct = snapshot.status === 'pending';

  return (
    <>
      <Header />
      <main className="container py-8 max-w-3xl">
        <AdminNav active="/admin/audience-snapshots" />
        <Link href="/admin/audience-snapshots" className="text-sm text-muted-foreground hover:text-foreground">← Back to queue</Link>
        <h1 className="mt-3 text-2xl md:text-3xl font-bold">Follower Evidence Review</h1>
        <div className="mt-1 text-sm text-muted-foreground">Snapshot {snapshot.id.slice(0, 8)} · status: <span className="font-semibold uppercase">{snapshot.status}</span></div>

        <section className="mt-6 wh-card p-5">
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Channel</div>
          <div className="mt-1">
            {channel ? (
              <Link href={`/channel/${channel.slug}`} className="font-semibold hover:underline">{channel.name}</Link>
            ) : 'Unknown channel'}
          </div>
        </section>

        <section className="mt-4 wh-card p-5">
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Owner report</div>
          <div className="mt-1 text-lg font-semibold" data-testid="reported-followers">{Number(snapshot.followers).toLocaleString()} followers</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Submitted {new Date(snapshot.reported_at).toLocaleString()}
            {snapshot.evidence_date ? ` · evidence dated ${new Date(snapshot.evidence_date).toLocaleDateString()}` : ''}
          </div>
          {snapshot.submission_note && <p className="mt-2 text-sm italic">“{snapshot.submission_note}”</p>}
        </section>

        <section className="mt-4 wh-card p-5">
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Screenshot</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-testid="evidence-img" src={snapshot.evidence_attachment.url} alt="follower evidence" className="mt-2 max-h-[600px] w-auto rounded border border-border" />
          <div className="mt-2 text-xs text-muted-foreground">{snapshot.evidence_attachment.file_name_safe} · {(snapshot.evidence_attachment.size_bytes / 1024).toFixed(0)} KB</div>
        </section>

        {snapshot.status !== 'pending' && (
          <section className="mt-4 wh-card p-5" data-testid="already-reviewed">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Review outcome</div>
            <div className="mt-1 text-sm">
              {snapshot.status === 'verified' && <span>✅ Verified on {snapshot.verified_at ? new Date(snapshot.verified_at).toLocaleString() : ''}</span>}
              {snapshot.status === 'rejected' && <span>❌ Rejected — {snapshot.rejection_reason}</span>}
              {snapshot.status === 'superseded' && <span>Superseded by a newer submission</span>}
            </div>
            {snapshot.review_note && <p className="mt-2 text-xs text-muted-foreground italic">Admin note: {snapshot.review_note}</p>}
          </section>
        )}

        {canAct && <ReviewActions snapshotId={snapshot.id} />}
      </main>
      <Footer />
    </>
  );
}
