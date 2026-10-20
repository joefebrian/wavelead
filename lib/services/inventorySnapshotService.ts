// P0B — INVENTORY & OWNERSHIP SNAPSHOTS.
//
// A snapshot is an append-only record of AGGREGATE COUNTS ONLY, captured so
// that an approved production deployment can be compared before and after.
//
// Hard rules:
//   • Reads channels/claims/payments; writes ONLY snapshot documents. It can
//     never modify a channel, ownership, verification, claim or payment row.
//   • Both phases use the IDENTICAL metric definitions
//     (claimPathMetricsService) so a diff is always like-for-like.
//   • Idempotent per (release_key, phase): capturing twice returns the
//     existing snapshot instead of writing a duplicate.
//   • A count difference is NOT a defect signal. Normal submissions, claims
//     and approvals happen between snapshots, so the diff is reported as
//     plain deltas with no verdict attached.
//   • Never fabricates a historical snapshot that was not captured.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import { claimPathMetricsService, type ClaimPathMetrics } from './claimPathMetricsService';
import { getBuildInfo, currentReleaseKey } from '../buildInfo';
import type { Actor } from '@/lib/types';

export type SnapshotPhase = 'pre_deploy' | 'post_deploy';
export const SNAPSHOT_PHASES: readonly SnapshotPhase[] = ['pre_deploy', 'post_deploy'] as const;

export interface InventorySnapshot {
  id: string;
  release_key: string;
  phase: SnapshotPhase;
  commit: string;
  build_time: string | null;
  environment: string;
  release_id: string;
  /** Who or what initiated the capture. */
  captured_by_user_id: string | null;
  captured_by: string;
  captured_at: Date;
  metrics: ClaimPathMetrics;
  note: string | null;
}

export interface SnapshotDiff {
  release_key: string;
  pre: InventorySnapshot | null;
  post: InventorySnapshot | null;
  /** Absolute change per metric (post − pre). Null when a phase is missing. */
  deltas: Record<string, number> | null;
  /** Explicit, honest statement when a baseline was never captured. */
  note: string;
}

const NUMERIC_KEYS: (keyof ClaimPathMetrics)[] = [
  'public_approved_total', 'claimable', 'linked_unverified', 'verified_ownership',
  'needs_review', 'pending_claims', 'activation_active', 'activation_ownership_conflicts',
];

async function col() {
  return getCollection<InventorySnapshot>(COLLECTIONS.INVENTORY_SNAPSHOTS);
}

export const inventorySnapshotService = {
  /** Compute current counts WITHOUT storing anything. Admin/moderator read. */
  async preview(actor: Actor | null): Promise<ClaimPathMetrics> {
    requireRole(actor, ROLES.MODERATOR);
    return claimPathMetricsService.compute();
  },

  /**
   * Capture and persist one labelled snapshot. Admin+ only.
   * Idempotent per (release_key, phase).
   */
  async capture(
    actor: Actor | null,
    phase: SnapshotPhase,
    opts: { release_key?: string; note?: string } = {},
  ): Promise<{ snapshot: InventorySnapshot; created: boolean }> {
    requireRole(actor, ROLES.ADMIN);
    if (!SNAPSHOT_PHASES.includes(phase)) {
      throw new HttpError(400, `phase must be one of: ${SNAPSHOT_PHASES.join(', ')}`);
    }
    const releaseKey = String(opts.release_key || currentReleaseKey()).trim().slice(0, 120);
    const c = await col();

    const existing = await c.findOne({ release_key: releaseKey, phase } as never);
    if (existing) return { snapshot: existing, created: false };

    const build = getBuildInfo();
    const snapshot: InventorySnapshot = {
      id: uuidv4(),
      release_key: releaseKey,
      phase,
      commit: build.commit,
      build_time: build.build_time,
      environment: build.environment,
      release_id: build.release_id,
      captured_by_user_id: actor?.user.id ?? null,
      captured_by: actor?.user.email ?? 'automation',
      captured_at: new Date(),
      metrics: await claimPathMetricsService.compute(),
      note: opts.note ? String(opts.note).trim().slice(0, 500) : null,
    };
    try {
      await c.insertOne(snapshot as never);
    } catch {
      // Unique-index race: another capture for the same release+phase won.
      const raced = await c.findOne({ release_key: releaseKey, phase } as never);
      if (raced) return { snapshot: raced, created: false };
      throw new HttpError(500, 'Could not store the inventory snapshot.');
    }
    return { snapshot, created: true };
  },

  /** Most recent snapshots, newest first. */
  async list(actor: Actor | null, limit = 20): Promise<InventorySnapshot[]> {
    requireRole(actor, ROLES.MODERATOR);
    const c = await col();
    return c.find({} as never).sort({ captured_at: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
  },

  /** Before/after comparison for one release key. */
  async diff(actor: Actor | null, releaseKey: string): Promise<SnapshotDiff> {
    requireRole(actor, ROLES.MODERATOR);
    const c = await col();
    const key = String(releaseKey || '').trim();
    const pre = await c.findOne({ release_key: key, phase: 'pre_deploy' } as never);
    const post = await c.findOne({ release_key: key, phase: 'post_deploy' } as never);

    if (!pre || !post) {
      return {
        release_key: key,
        pre: pre ?? null,
        post: post ?? null,
        deltas: null,
        note: !pre && !post
          ? 'No snapshot was captured for this release.'
          : !pre
            ? 'No pre-deploy baseline was captured for this release, so no comparison is possible. A baseline is never reconstructed after the fact.'
            : 'No post-deploy snapshot has been captured yet for this release.',
      };
    }

    const deltas: Record<string, number> = {};
    for (const k of NUMERIC_KEYS) {
      deltas[k] = Number(post.metrics[k] ?? 0) - Number(pre.metrics[k] ?? 0);
    }
    return {
      release_key: key,
      pre,
      post,
      deltas,
      note: 'Differences are plain deltas. Normal submissions, claims and approvals occur between snapshots, so a non-zero delta is not by itself a deployment defect.',
    };
  },
};
