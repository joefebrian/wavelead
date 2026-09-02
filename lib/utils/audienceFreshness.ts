// M11-Batch2A — Freshness derivation for follower evidence.
// Public copy convention (per product):
//   fresh (0-30d):    "Updated Sep 3, 2026"
//   aging (31-90d):   "Updated Sep 3, 2026 · 34 days ago"
//   stale (91-180d):  "Updated Sep 3, 2026 · Stale"
//   outdated (>180d): "Updated Sep 3, 2026 · Outdated"
// Prefer "Updated" over "Last verified" so it does not imply broader channel
// verification beyond the follower-count evidence.
import type { ChannelAudienceSnapshot } from '@/lib/types';

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'outdated';

export interface AudienceFreshness {
  level: FreshnessLevel;
  sourceDate: Date;         // evidence_date ?? reported_at
  ageDays: number;          // whole days from sourceDate to now
  label: string;            // full public label (e.g. "Updated Sep 3, 2026 · 34 days ago")
  shortLabel: string;       // just the absolute ("Updated Sep 3, 2026")
  qualifier: string | null; // relative or bucket qualifier appended after " · " (null when fresh)
}

export function classifyLevel(ageDays: number): FreshnessLevel {
  if (ageDays <= 30) return 'fresh';
  if (ageDays <= 90) return 'aging';
  if (ageDays <= 180) return 'stale';
  return 'outdated';
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function fmtAbsolute(d: Date): string {
  // e.g. "Sep 3, 2026" — locale-neutral English short.
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function deriveAudienceFreshness(snap: Pick<ChannelAudienceSnapshot, 'evidence_date' | 'reported_at'>, now: Date = new Date()): AudienceFreshness {
  const sourceDate = snap.evidence_date ? new Date(snap.evidence_date as unknown as string) : new Date(snap.reported_at as unknown as string);
  const ageDays = daysBetween(sourceDate, now);
  const level = classifyLevel(ageDays);
  const shortLabel = `Updated ${fmtAbsolute(sourceDate)}`;
  let qualifier: string | null = null;
  if (level === 'aging') qualifier = `${ageDays} days ago`;
  else if (level === 'stale') qualifier = 'Stale';
  else if (level === 'outdated') qualifier = 'Outdated';
  const label = qualifier ? `${shortLabel} · ${qualifier}` : shortLabel;
  return { level, sourceDate, ageDays, label, shortLabel, qualifier };
}
