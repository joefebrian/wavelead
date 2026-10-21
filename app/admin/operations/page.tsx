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
import { operationsReportService, type RecentSubmissionRow } from '@/lib/services/operationsReportService';
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
  // P0C — provenance split, sourcing scoreboard and (admin) recent submitters.
  const split = await operationsReportService.inventorySplit(actor).catch(() => null);
  const board = await operationsReportService.sourcingScoreboard(actor, 7).catch(() => null);
  let recent: RecentSubmissionRow[] = [];
  let recentTotal = 0;
  if (isAdmin) {
    const r = await operationsReportService.recentSubmissions(actor, { days: 7, limit: 100 }).catch(() => null);
    recent = r?.items ?? [];
    recentTotal = r?.total ?? 0;
  }
  const who = (u: RecentSubmissionRow['submitter']) => (u ? `${u.email}${u.is_sourcing_agent ? ' · agent' : ''} (${u.role})` : '—');

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

        {/* -------------------- P0C: PROVENANCE SPLIT -------------------- */}
        {split && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-6 mb-6" data-testid="ops-provenance">
            {[
              { label: 'Staff-Sourced', value: split.staff_sourced_public, hint: 'Public listings added by sourcing agents' },
              { label: 'Owner-Submitted', value: split.owner_submitted_public, hint: 'Public listings submitted as owner_self' },
              { label: 'Legacy (no source)', value: split.legacy_no_source_public, hint: 'Pre-P0B listings, provenance not recorded' },
              { label: 'Claimed + Verified', value: split.staff_sourced_claimed_verified, hint: 'Staff-sourced listings now owner-verified' },
              { label: 'Verified Owners', value: split.verified_owners, hint: 'Verified/official with an owner link' },
              { label: 'Sponsorship-Ready', value: split.sponsorship_ready, hint: 'Verified + activation + active package + verified payout' },
            ].map((c) => (
              <div key={c.label} className="wh-card p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{c.value.toLocaleString()}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{c.hint}</div>
              </div>
            ))}
          </div>
        )}

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

        {/* -------------------- P0C: SOURCING SCOREBOARD -------------------- */}
        <div className="mb-8" data-testid="ops-scoreboard">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Sourcing Scoreboard</h2>
            <span className="text-xs text-muted-foreground">
              last 7 days · Asia/Jakarta days · target {board?.target_per_day ?? 100} unique listings/day (a target, not achieved traction)
            </span>
          </div>
          {!board || board.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No staff-sourced submissions recorded in this window. Attribution starts when an administrator designates a
              sourcing agent; existing listings are never reclassified retroactively.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-2 text-xs">
                {board.day_totals.map((t) => (
                  <span key={t.day} className="rounded border px-2 py-1 tabular-nums">
                    {t.day}: <strong>{t.accepted_unique}</strong>/{board.target_per_day} ({t.progress_pct}%)
                  </span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                      <th className="py-2 pr-3">Day</th>
                      {isAdmin && <th className="py-2 pr-3">Sourcing account</th>}
                      <th className="py-2 pr-3">Submitted</th>
                      <th className="py-2 pr-3">Unique accepted</th>
                      <th className="py-2 pr-3">Approved public</th>
                      <th className="py-2 pr-3">Pending</th>
                      <th className="py-2 pr-3">Rejected</th>
                      <th className="py-2 pr-3">Duplicates</th>
                      <th className="py-2 pr-3">Claims</th>
                      <th className="py-2 pr-3">Claimed</th>
                      <th className="py-2 pr-3">Verified</th>
                      <th className="py-2 pr-3">vs target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.items.map((d) => (
                      <tr key={`${d.day}-${d.user_id}`} className="border-b last:border-0 tabular-nums">
                        <td className="py-2 pr-3">{d.day}</td>
                        {isAdmin && <td className="py-2 pr-3">{d.display_name}</td>}
                        <td className="py-2 pr-3">{d.submitted}</td>
                        <td className="py-2 pr-3 font-medium">{d.accepted_unique}</td>
                        <td className="py-2 pr-3">{d.approved_public}</td>
                        <td className="py-2 pr-3">{d.pending_moderation}</td>
                        <td className="py-2 pr-3">{d.rejected}</td>
                        <td className="py-2 pr-3 text-[11px] text-muted-foreground">Not tracked</td>
                        <td className="py-2 pr-3">{d.ownership_claims}</td>
                        <td className="py-2 pr-3">{d.claimed_by_owner}</td>
                        <td className="py-2 pr-3">{d.verified_conversions}</td>
                        <td className="py-2 pr-3">{d.progress_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Claimed / Verified reflect the CURRENT state of listings sourced that day (no historical event log).
                Duplicate attempts are rejected at submission and not stored, so they are shown as Not tracked.
              </p>
            </>
          )}
        </div>

        {/* -------------------- P0C: RECENT SUBMITTERS (ADMIN) -------------------- */}
        {isAdmin && (
          <div className="mb-8" data-testid="ops-recent-submissions">
            <h2 className="text-lg font-semibold mb-1">Recent Submissions — Submitter Lookup</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Admin-only, read-only. {recentTotal.toLocaleString()} listings created in the last 7 days (showing up to 100).
              Submitter identity is never shown publicly, and a linked owner is not assumed to be staff.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-3">Channel</th>
                    <th className="py-2 pr-3">Created / Approved (UTC)</th>
                    <th className="py-2 pr-3">Submitted by</th>
                    <th className="py-2 pr-3">Linked owner</th>
                    <th className="py-2 pr-3">Source / sourced by</th>
                    <th className="py-2 pr-3">Verification</th>
                    <th className="py-2 pr-3">Claim state</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0 ? (
                    <tr><td colSpan={7} className="py-4 text-muted-foreground">No listings created in this window.</td></tr>
                  ) : recent.map((r) => (
                    <tr key={r.channel_id} className="border-b last:border-0 align-top text-[11px]">
                      <td className="py-2 pr-3">
                        <Link href={`/admin/channels/${r.channel_id}`} className="font-medium text-sm text-primary hover:underline">{r.name}</Link>
                        <div className="text-muted-foreground font-mono">{r.whatsapp_channel_id || '—'}</div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        <div>{new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}</div>
                        <div className="text-muted-foreground">{r.published_at ? new Date(r.published_at).toISOString().slice(0, 16).replace('T', ' ') : r.status}</div>
                      </td>
                      <td className="py-2 pr-3">{who(r.submitter)}</td>
                      <td className="py-2 pr-3">{who(r.linked_owner)}{r.submitter_is_linked_owner && <div className="text-amber-700">= submitter</div>}</td>
                      <td className="py-2 pr-3">
                        <div>{r.source ?? 'not recorded'}</div>
                        {r.sourced_by && <div className="text-muted-foreground">{r.sourced_by.email}</div>}
                      </td>
                      <td className="py-2 pr-3">{r.verification_status}</td>
                      <td className="py-2 pr-3">
                        <div>{r.claim_eligibility.replace(/_/g, ' ')}</div>
                        {r.active_claims > 0 && <div className="text-violet-700">{r.active_claims} active claim(s)</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
