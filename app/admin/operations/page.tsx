// P0B — /admin/operations
//
// A deliberately small, READ-ONLY operational view answering one question:
// of the channels the public can actually see, how many are claimable, how
// many are linked-but-unverified, how many have genuinely verified ownership,
// and how many need admin attention?
//
// Scope guards:
//   • READ ONLY. No release, approval or ownership mutation happens here;
//     those live behind the dedicated admin action endpoints.
//   • Moderator+ may read the counts. Sensitive PIC and ownership detail
//     (linked owner ids, sourcing agent e-mails) renders for ADMIN+ only.
//   • Counts come from the canonical services — nothing is recomputed, and
//     verified ownership is never inferred from owner_id alone.
//   • Public inventory is NOT creator acquisition; the copy says so.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { claimPathMetricsService } from '@/lib/services/claimPathMetricsService';
import { ownershipReleaseService, type ReleaseAssessment } from '@/lib/services/ownershipReleaseService';
import { sourcingAgentService, type DailySourcingCount } from '@/lib/services/sourcingAgentService';
import { inventorySnapshotService, type InventorySnapshot } from '@/lib/services/inventorySnapshotService';
import { getBuildInfo } from '@/lib/buildInfo';
import { Activity, ShieldCheck, Users, AlertTriangle } from 'lucide-react';

export const metadata: Metadata = { title: 'Admin · Operations', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const LABEL_STYLES: Record<string, string> = {
  likely_staff_sourced: 'bg-amber-100 text-amber-800',
  linked_unverified: 'bg-sky-100 text-sky-800',
  needs_review: 'bg-violet-100 text-violet-800',
  not_eligible_for_release: 'bg-rose-100 text-rose-800',
};

const LABEL_TEXT: Record<string, string> = {
  likely_staff_sourced: 'Likely Staff-Sourced',
  linked_unverified: 'Linked-Unverified',
  needs_review: 'Needs Review',
  not_eligible_for_release: 'Not Eligible for Release',
};

function LabelBadge({ label }: { label: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${LABEL_STYLES[label] || 'bg-muted text-muted-foreground'}`}>
      {LABEL_TEXT[label] || label}
    </span>
  );
}

export default async function AdminOperationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.MODERATOR)) redirect('/');
  const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);

  const sp = searchParams ? await searchParams : {};
  const labelFilter = typeof sp.label === 'string' ? sp.label : undefined;

  const metrics = await claimPathMetricsService.compute();
  const build = isAdmin ? getBuildInfo() : null;

  // Sensitive detail: ADMIN+ only.
  let candidates: ReleaseAssessment[] = [];
  let candidateTotal = 0;
  let snapshots: InventorySnapshot[] = [];
  if (isAdmin) {
    const res = await ownershipReleaseService.listCandidates(actor, {
      limit: 25,
      label: (labelFilter as never) || undefined,
    });
    candidates = res.items;
    candidateTotal = res.total;
    snapshots = await inventorySnapshotService.list(actor, 6).catch(() => []);
  }
  let sourcingDaily: DailySourcingCount[] = [];
  try {
    sourcingDaily = await sourcingAgentService.dailySourcingCounts(actor, 7);
  } catch { /* reporting is non-critical to the page */ }

  const cards = [
    { label: 'Public Channels', value: metrics.public_approved_total, hint: 'Approved + publicly visible' },
    { label: 'Claimable', value: metrics.claimable, hint: 'No owner link — a rightful owner can claim today' },
    { label: 'Linked-Unverified', value: metrics.linked_unverified, hint: 'Linked to an account, ownership not verified' },
    { label: 'Verified Ownership', value: metrics.verified_ownership, hint: 'Verified/official WITH an owner link' },
    { label: 'Needs Review', value: metrics.needs_review, hint: 'Inconsistent or under-review ownership data' },
    { label: 'Pending Claims', value: metrics.pending_claims, hint: 'Open ownership claims (not a channel bucket)' },
    { label: 'Activation Active', value: metrics.activation_active, hint: 'Verified owners with the public badge satisfied' },
    { label: 'Ownership Conflicts', value: metrics.activation_ownership_conflicts, hint: 'Captured payments flagged for refund review' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <section className="w-full">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Operations</h1>
          <span className="ml-1 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold">
            Read-only
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Directory and ownership state for channels the public can actually see (canonical visibility filter).
          These are <strong>inventory</strong> counts, not creator acquisition or commercial traction. Verified ownership
          is never inferred from an owner link alone.
        </p>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-2">
          {cards.map((c) => (
            <div key={c.label} className="wh-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{c.value.toLocaleString()}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{c.hint}</div>
            </div>
          ))}
        </div>

        <div className="mb-6 text-[11px] text-muted-foreground">
          {metrics.sum_matches_total ? (
            <span>
              Integrity check passed — Claimable + Linked-Unverified + Verified + Needs Review ={' '}
              {metrics.public_approved_total.toLocaleString()} public channels.
            </span>
          ) : (
            <span className="text-rose-700 font-medium inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Buckets do not sum to the public total — investigate before trusting these counts.
            </span>
          )}
        </div>

        {/* -------------------- OWNERSHIP REVIEW QUEUE -------------------- */}
        {isAdmin ? (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Ownership Review Queue</h2>
              <span className="text-xs text-muted-foreground">
                {candidateTotal.toLocaleString()} linked-unverified listings
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Read-only. Labels are a heuristic, never a conclusion: a linked-unverified listing is{' '}
              <strong>not</strong> assumed to be staff-sourced. Releasing a link is a separate, evidence-backed,
              one-channel admin action.
            </p>
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              <Link href="/admin/operations" className={`rounded border px-2 py-1 ${!labelFilter ? 'bg-muted font-medium' : ''}`}>All</Link>
              {Object.keys(LABEL_TEXT).map((l) => (
                <Link
                  key={l}
                  href={`/admin/operations?label=${l}`}
                  className={`rounded border px-2 py-1 ${labelFilter === l ? 'bg-muted font-medium' : ''}`}
                >
                  {LABEL_TEXT[l]}
                </Link>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-3">Channel</th>
                    <th className="py-2 pr-3">Label</th>
                    <th className="py-2 pr-3">Sourcing evidence</th>
                    <th className="py-2 pr-3">Findings</th>
                    <th className="py-2 pr-3">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-muted-foreground">No listings match this filter.</td></tr>
                  ) : candidates.map((c) => (
                    <tr key={c.channel_id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{c.name}</div>
                        <code className="text-[11px] text-muted-foreground">{c.slug}</code>
                      </td>
                      <td className="py-2 pr-3"><LabelBadge label={c.label} /></td>
                      <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                        <div>source: {c.evidence.source ?? '—'}</div>
                        <div>
                          linked owner is designated agent:{' '}
                          <strong>{c.evidence.linked_owner_is_designated_sourcing_agent ? 'yes' : 'no'}</strong>
                        </div>
                        <div>submitter is linked owner: {c.evidence.submitter_is_linked_owner ? 'yes' : 'no'}</div>
                      </td>
                      <td className="py-2 pr-3 text-[11px] text-muted-foreground">
                        {c.blockers.length > 0 && <div className="text-rose-700">blockers: {c.blockers.join(', ')}</div>}
                        {c.warnings.length > 0 && <div className="text-amber-700">warnings: {c.warnings.join(', ')}</div>}
                        {c.blockers.length === 0 && c.warnings.length === 0 && <div>none</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <Link href={`/admin/channels/${c.channel_id}`} className="text-primary hover:underline text-xs">
                          Open channel
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mb-8 text-xs text-muted-foreground">
            Ownership and sourcing detail is restricted to administrators.
          </div>
        )}

        {/* -------------------- SOURCING ACTIVITY -------------------- */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Sourcing Activity</h2>
            <span className="text-xs text-muted-foreground">unique channels per day · Asia/Jakarta</span>
          </div>
          {sourcingDaily.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No staff-sourced submissions recorded yet. Attribution starts when an administrator designates a sourcing
              agent; existing listings are never reclassified retroactively.
            </p>
          ) : (
            <table className="w-full text-sm max-w-xl">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="py-2 pr-3">Day</th>
                  {isAdmin && <th className="py-2 pr-3">Sourcing agent</th>}
                  <th className="py-2 pr-3">Unique channels</th>
                </tr>
              </thead>
              <tbody>
                {sourcingDaily.map((d) => (
                  <tr key={`${d.day}-${d.user_id}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{d.day}</td>
                    {isAdmin && <td className="py-2 pr-3">{d.display_name}</td>}
                    <td className="py-2 pr-3 tabular-nums font-medium">{d.unique_channels}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* -------------------- RELEASE DIAGNOSTICS -------------------- */}
        {isAdmin && build && (
          <div className="mb-10">
            <h2 className="text-lg font-semibold mb-1">Release Diagnostics</h2>
            <div className="text-xs text-muted-foreground mb-3">
              Deployed artifact identity — stamped at build time, not read from the running workspace.
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
              <div className="wh-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Commit</div>
                <div className="mt-1 text-sm font-mono">{build.commit_short}</div>
              </div>
              <div className="wh-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Build time</div>
                <div className="mt-1 text-sm">{build.build_time || '—'}</div>
              </div>
              <div className="wh-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Environment</div>
                <div className="mt-1 text-sm">{build.environment}</div>
              </div>
              <div className="wh-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Release</div>
                <div className="mt-1 text-sm font-mono">{build.release_id}</div>
              </div>
            </div>

            <h3 className="text-sm font-semibold mb-1">Inventory Snapshots</h3>
            {snapshots.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No snapshots captured yet. A pre-deploy baseline is never reconstructed after the fact, so the first
                comparison becomes available once a pre-deploy and post-deploy snapshot both exist.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-3">Captured</th>
                    <th className="py-2 pr-3">Release</th>
                    <th className="py-2 pr-3">Phase</th>
                    <th className="py-2 pr-3">Public</th>
                    <th className="py-2 pr-3">Claimable</th>
                    <th className="py-2 pr-3">Linked</th>
                    <th className="py-2 pr-3">Verified</th>
                    <th className="py-2 pr-3">By</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-[11px]">{new Date(s.captured_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2 pr-3 text-[11px] font-mono">{s.release_key}</td>
                      <td className="py-2 pr-3 text-[11px]">{s.phase}</td>
                      <td className="py-2 pr-3 tabular-nums">{s.metrics.public_approved_total}</td>
                      <td className="py-2 pr-3 tabular-nums">{s.metrics.claimable}</td>
                      <td className="py-2 pr-3 tabular-nums">{s.metrics.linked_unverified}</td>
                      <td className="py-2 pr-3 tabular-nums">{s.metrics.verified_ownership}</td>
                      <td className="py-2 pr-3 text-[11px]">{s.captured_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
