// M04 Owner Analytics & Growth Intelligence.
//
// Design invariants:
//   1. Raw `events` remain the source of truth. Rollups are recomputed
//      from raw events and upserted — running the same rollup N times
//      produces identical results (idempotent).
//   2. Ownership isolation: dashboard endpoints must be called through
//      requireChannelOwnerOrAdmin() which enforces
//      channel.owner_id === actor.user.id OR actor has role >= admin.
//      Cross-owner access returns 403.
//   3. Privacy: NEVER expose session IDs, IPs, precise geo, WhatsApp
//      identities, or raw event IDs. Search terms require ≥ 3 impressions
//      before being surfaced.
//   4. Empty-state honesty: never fabricate historical data. Missing days
//      return zero-valued rows.
//
// Rollups persisted:
//   channel_daily_metrics          — {channel_id, date}
//   channel_daily_source_metrics   — {channel_id, date, source}
//   channel_search_query_metrics   — {channel_id, date, normalized_query}
//   analytics_rollup_state         — {channel_id, date} freshness + lock

import { v4 as uuidv4 } from 'uuid';
import { Actor, AcquisitionSource, Channel, DailyMetric, DailySourceMetric,
         EventRecord, RollupState, SearchQueryMetric, SOURCE_LABELS } from '@/lib/types';
import { ACQUISITION_SOURCES } from '@/lib/types';
import { channelRepo } from '../repositories/channelRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError } from '../auth/rbac';
import { canonicalizeStoredSource, normalizeQuery } from './trackingService';

// ---- Constants -----------------------------------------------------------

const TODAY_STALE_MS = 60_000; // Today's rollup is considered stale after 60s.
const YESTERDAY_STALE_MS = 5 * 60_000; // Reconciliation window for late events.
const LOCK_TTL_MS = 30_000;
const MAX_BACKFILL_DAYS = 400;
const SEARCH_QUERY_MIN_IMPRESSIONS = 3;

// ---- Date helpers (UTC, deterministic) -----------------------------------

/** YYYY-MM-DD (UTC) for a Date. */
export function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseUtcDate(key: string): Date {
  // key = YYYY-MM-DD → 00:00:00Z of that day
  return new Date(`${key}T00:00:00.000Z`);
}

export function utcDayStart(d: Date): Date {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

export function utcDayEnd(d: Date): Date {
  const dt = new Date(d);
  dt.setUTCHours(23, 59, 59, 999);
  return dt;
}

/** Enumerate YYYY-MM-DD keys inclusive from `fromKey` to `toKey`. */
export function enumerateDateKeys(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  const from = parseUtcDate(fromKey);
  const to = parseUtcDate(toKey);
  for (let cur = from; cur.getTime() <= to.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
    out.push(toUtcDateKey(cur));
  }
  return out;
}

// ---- Ownership authorization --------------------------------------------

async function requireChannelOwnerOrAdmin(actor: Actor | null, channelId: string): Promise<Channel> {
  if (!actor) throw new HttpError(401, 'You must be signed in');
  const channel = await channelRepo.findById(channelId);
  if (!channel) throw new HttpError(404, 'Channel not found');
  const role = actor.user.role;
  const isOwner = channel.owner_id && channel.owner_id === actor.user.id;
  const isAdmin = role === 'admin' || role === 'super_admin';
  if (!isOwner && !isAdmin) throw new HttpError(403, 'You do not have access to this channel');
  return channel;
}

// ---- Time-window helpers -------------------------------------------------

export type WindowKey = '7d' | '30d' | '90d' | 'custom';

export interface DateRange { fromKey: string; toKey: string; days: number; }

export function resolveRange(input: { window?: string; from?: string; to?: string }): DateRange {
  const win = (input.window || '').toLowerCase();
  const todayKey = toUtcDateKey(new Date());
  if (win === 'custom' || (input.from && input.to)) {
    if (!input.from || !input.to) throw new HttpError(400, 'Custom range requires from and to');
    const fromKey = String(input.from).slice(0, 10);
    const toKey = String(input.to).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
      throw new HttpError(400, 'Invalid date format (expected YYYY-MM-DD)');
    }
    if (parseUtcDate(fromKey).getTime() > parseUtcDate(toKey).getTime()) {
      throw new HttpError(400, 'from must be <= to');
    }
    const days = enumerateDateKeys(fromKey, toKey).length;
    if (days > MAX_BACKFILL_DAYS) throw new HttpError(400, `Range too large (max ${MAX_BACKFILL_DAYS} days)`);
    return { fromKey, toKey, days };
  }
  const n = win === '7d' ? 7 : win === '90d' ? 90 : 30; // default 30d
  const to = new Date();
  const fromDate = new Date(to.getTime() - (n - 1) * 24 * 3600_000);
  return { fromKey: toUtcDateKey(fromDate), toKey: todayKey, days: n };
}

// ---- Rollup computation --------------------------------------------------

interface RollupTotals {
  discovery_impressions: number;
  search_impressions: number;
  profile_views: number;
  unique_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  bookmarks: number;
  shares: number;
}

function emptyTotals(): RollupTotals {
  return {
    discovery_impressions: 0, search_impressions: 0,
    profile_views: 0, unique_profile_views: 0,
    follow_clicks: 0, unique_follow_intents: 0,
    bookmarks: 0, shares: 0,
  };
}

interface PerSourceAgg {
  impressions: number;
  profile_views: number;
  unique_profile_view_sessions: Set<string>;
  follow_clicks: number;
  unique_follow_intent_sessions: Set<string>;
}

function emptySourceAgg(): PerSourceAgg {
  return {
    impressions: 0, profile_views: 0,
    unique_profile_view_sessions: new Set(),
    follow_clicks: 0,
    unique_follow_intent_sessions: new Set(),
  };
}

/**
 * Compute deterministic totals for a (channel_id, YYYY-MM-DD) bucket
 * directly from the raw `events` collection. Idempotent by construction.
 */
async function computeDailyRollup(channelId: string, dateKey: string): Promise<{
  totals: RollupTotals;
  perSource: Map<AcquisitionSource, PerSourceAgg>;
  perQuery: Map<string, PerSourceAgg>;
}> {
  const events = await getCollection<EventRecord>(COLLECTIONS.EVENTS);
  const start = parseUtcDate(dateKey);
  const end = new Date(start.getTime() + 24 * 3600_000);

  const totals = emptyTotals();
  const perSource = new Map<AcquisitionSource, PerSourceAgg>();
  const perQuery = new Map<string, PerSourceAgg>();
  const unique = {
    profile_view: new Set<string>(),
    follow_intent: new Set<string>(),
  };

  function bucketSource(src: AcquisitionSource): PerSourceAgg {
    let b = perSource.get(src);
    if (!b) { b = emptySourceAgg(); perSource.set(src, b); }
    return b;
  }
  function bucketQuery(q: string): PerSourceAgg {
    let b = perQuery.get(q);
    if (!b) { b = emptySourceAgg(); perQuery.set(q, b); }
    return b;
  }

  const cursor = events.find(
    { channel_id: channelId, created_at: { $gte: start, $lt: end } },
    { projection: { event_type: 1, anonymous_session_id: 1, source: 1, search_query: 1 } },
  );
  const docs = await cursor.toArray();
  for (const raw of docs) {
    const type = raw.event_type;
    const src = canonicalizeStoredSource((raw as unknown as { source?: unknown }).source);
    const sess = (raw as unknown as { anonymous_session_id?: string | null }).anonymous_session_id || '';
    const query = normalizeQuery((raw as unknown as { search_query?: string | null }).search_query);
    const bucketS = bucketSource(src);
    if (type === 'channel_impression') {
      totals.discovery_impressions++;
      bucketS.impressions++;
      if (query && src === 'search') bucketQuery(query).impressions++;
    } else if (type === 'search_impression') {
      totals.search_impressions++;
      bucketS.impressions++;
      if (query) bucketQuery(query).impressions++;
    } else if (type === 'channel_profile_view') {
      totals.profile_views++;
      bucketS.profile_views++;
      if (sess) {
        unique.profile_view.add(sess);
        bucketS.unique_profile_view_sessions.add(sess);
      }
      if (query) {
        const bq = bucketQuery(query);
        bq.profile_views++;
        if (sess) bq.unique_profile_view_sessions.add(sess);
      }
    } else if (type === 'follow_click') {
      totals.follow_clicks++;
      bucketS.follow_clicks++;
      if (sess) {
        unique.follow_intent.add(sess);
        bucketS.unique_follow_intent_sessions.add(sess);
      }
      if (query) {
        const bq = bucketQuery(query);
        bq.follow_clicks++;
        if (sess) bq.unique_follow_intent_sessions.add(sess);
      }
    } else if (type === 'bookmark') {
      totals.bookmarks++;
    } else if (type === 'share') {
      totals.shares++;
    }
  }
  totals.unique_profile_views = unique.profile_view.size;
  totals.unique_follow_intents = unique.follow_intent.size;
  return { totals, perSource, perQuery };
}

// ---- Freshness & lock ----------------------------------------------------

function isStale(state: RollupState | null, dateKey: string, todayKey: string, yesterdayKey: string, now: Date): boolean {
  if (!state) return true;
  const age = now.getTime() - new Date(state.last_aggregated_at).getTime();
  if (dateKey === todayKey) return age > TODAY_STALE_MS;
  if (dateKey === yesterdayKey) return age > YESTERDAY_STALE_MS;
  return false; // historical completed day; if state exists, don't recompute
}

async function acquireLock(channelId: string, dateKey: string, now: Date): Promise<boolean> {
  const coll = await getCollection<RollupState>(COLLECTIONS.ROLLUP_STATE);
  const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);
  const res = await coll.updateOne(
    {
      channel_id: channelId,
      date: dateKey,
      $or: [{ locked_until: null }, { locked_until: { $lte: now } }],
    },
    {
      $set: { locked_until: lockUntil, updated_at: now },
      $setOnInsert: {
        id: uuidv4(),
        channel_id: channelId,
        date: dateKey,
        last_aggregated_at: new Date(0),
      },
    },
    { upsert: true },
  );
  return res.modifiedCount > 0 || res.upsertedCount > 0;
}

async function releaseLock(channelId: string, dateKey: string, lastAggregatedAt: Date): Promise<void> {
  const coll = await getCollection<RollupState>(COLLECTIONS.ROLLUP_STATE);
  await coll.updateOne(
    { channel_id: channelId, date: dateKey },
    { $set: { locked_until: null, last_aggregated_at: lastAggregatedAt, updated_at: new Date() } },
  );
}

async function getRollupState(channelId: string, dateKey: string): Promise<RollupState | null> {
  const coll = await getCollection<RollupState>(COLLECTIONS.ROLLUP_STATE);
  const doc = await coll.findOne({ channel_id: channelId, date: dateKey });
  return doc as unknown as RollupState | null;
}

// ---- Upsert rollups ------------------------------------------------------

async function persistRollup(channelId: string, dateKey: string, computed: Awaited<ReturnType<typeof computeDailyRollup>>): Promise<void> {
  const now = new Date();
  const daily = await getCollection<DailyMetric>(COLLECTIONS.CHANNEL_DAILY_METRICS);
  const source = await getCollection<DailySourceMetric>(COLLECTIONS.CHANNEL_DAILY_SOURCE_METRICS);
  const query = await getCollection<SearchQueryMetric>(COLLECTIONS.CHANNEL_SEARCH_QUERY_METRICS);

  // 1. Daily totals — hard overwrite so rerun == identical.
  await daily.updateOne(
    { channel_id: channelId, date: dateKey },
    {
      $set: {
        ...computed.totals,
        last_aggregated_at: now,
      },
      $setOnInsert: { id: uuidv4(), channel_id: channelId, date: dateKey },
    },
    { upsert: true },
  );

  // 2. Per-source — must reset counts for sources that had activity yesterday
  //    but not today. We overwrite ALL canonical sources deterministically.
  const sourceOps = ACQUISITION_SOURCES.map((src) => {
    const agg = computed.perSource.get(src) || emptySourceAgg();
    return {
      updateOne: {
        filter: { channel_id: channelId, date: dateKey, source: src },
        update: {
          $set: {
            impressions: agg.impressions,
            profile_views: agg.profile_views,
            unique_profile_views: agg.unique_profile_view_sessions.size,
            follow_clicks: agg.follow_clicks,
            unique_follow_intents: agg.unique_follow_intent_sessions.size,
            last_aggregated_at: now,
          },
          $setOnInsert: { id: uuidv4(), channel_id: channelId, date: dateKey, source: src },
        },
        upsert: true,
      },
    };
  });
  if (sourceOps.length > 0) await source.bulkWrite(sourceOps);

  // 3. Search query rollups. First wipe today's rows for this channel to
  //    stay idempotent (queries can disappear on rerun if all events were
  //    voided/deleted). Then insert the current computation.
  await query.deleteMany({ channel_id: channelId, date: dateKey });
  const rows: SearchQueryMetric[] = [];
  for (const [q, agg] of computed.perQuery.entries()) {
    if (!q) continue;
    rows.push({
      id: uuidv4(),
      channel_id: channelId,
      date: dateKey,
      normalized_query: q,
      impressions: agg.impressions,
      profile_views: agg.profile_views,
      unique_profile_views: agg.unique_profile_view_sessions.size,
      follow_clicks: agg.follow_clicks,
      unique_follow_intents: agg.unique_follow_intent_sessions.size,
      last_aggregated_at: now,
    });
  }
  if (rows.length > 0) await query.insertMany(rows);
}

// ---- Public API ---------------------------------------------------------

/**
 * Ensure rollups for the given range are fresh. Skips historical days that
 * already have a rollup; refreshes today (>60s stale) and yesterday (>5min
 * stale). Concurrency-safe via a lightweight advisory lock.
 */
export async function ensureRollups(channelId: string, range: DateRange): Promise<{ refreshed: string[]; skipped: string[] }> {
  const now = new Date();
  const todayKey = toUtcDateKey(now);
  const yesterdayKey = toUtcDateKey(new Date(now.getTime() - 24 * 3600_000));
  const keys = enumerateDateKeys(range.fromKey, range.toKey);
  const refreshed: string[] = [];
  const skipped: string[] = [];

  for (const key of keys) {
    // Only future days? Nothing to aggregate. (defensive)
    if (parseUtcDate(key).getTime() > utcDayStart(now).getTime()) { skipped.push(key); continue; }

    const state = await getRollupState(channelId, key);
    if (!isStale(state, key, todayKey, yesterdayKey, now) && state && new Date(state.last_aggregated_at).getTime() > 0) {
      skipped.push(key);
      continue;
    }
    const gotLock = await acquireLock(channelId, key, now);
    if (!gotLock) {
      // Someone else is refreshing; skip. Their write is fine — rollup is idempotent.
      skipped.push(key);
      continue;
    }
    try {
      const computed = await computeDailyRollup(channelId, key);
      await persistRollup(channelId, key, computed);
      await releaseLock(channelId, key, new Date());
      refreshed.push(key);
    } catch (err) {
      // Best effort — release and log; existing valid rollups are preserved.
      await releaseLock(channelId, key, state?.last_aggregated_at || new Date(0));
      console.error(`[wavelead] rollup failed channel=${channelId} date=${key}:`, err);
    }
  }
  return { refreshed, skipped };
}

/**
 * Force rebuild of rollups (admin backfill / QA). Skips the freshness check.
 */
export async function forceRebuildRange(channelId: string, range: DateRange): Promise<{ refreshed: string[] }> {
  const now = new Date();
  const keys = enumerateDateKeys(range.fromKey, range.toKey);
  const refreshed: string[] = [];
  for (const key of keys) {
    if (parseUtcDate(key).getTime() > utcDayStart(now).getTime()) continue;
    const gotLock = await acquireLock(channelId, key, new Date());
    if (!gotLock) continue;
    try {
      const computed = await computeDailyRollup(channelId, key);
      await persistRollup(channelId, key, computed);
      await releaseLock(channelId, key, new Date());
      refreshed.push(key);
    } catch (err) {
      await releaseLock(channelId, key, new Date(0));
      console.error(`[wavelead] force rebuild failed channel=${channelId} date=${key}:`, err);
    }
  }
  return { refreshed };
}

// ---- Reporting queries (read from rollups) ------------------------------

function pctPoint(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 10000) / 100; // e.g. 25.35 (%-points)
}

function zeroDaily(dateKey: string): Omit<DailyMetric, 'id'> {
  return {
    channel_id: '', date: dateKey,
    discovery_impressions: 0, search_impressions: 0,
    profile_views: 0, unique_profile_views: 0,
    follow_clicks: 0, unique_follow_intents: 0,
    bookmarks: 0, shares: 0,
    last_aggregated_at: new Date(0),
  };
}

async function loadDaily(channelId: string, range: DateRange): Promise<DailyMetric[]> {
  const coll = await getCollection<DailyMetric>(COLLECTIONS.CHANNEL_DAILY_METRICS);
  const rows = await coll.find({ channel_id: channelId, date: { $gte: range.fromKey, $lte: range.toKey } }, { projection: { _id: 0 } }).toArray();
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return enumerateDateKeys(range.fromKey, range.toKey).map((k) => byDate.get(k) || ({ ...zeroDaily(k), channel_id: channelId, id: '' } as DailyMetric));
}

export interface OverviewResult {
  window: DateRange;
  kpis: {
    discovery_impressions: number;
    search_impressions: number;
    profile_views: number;
    unique_profile_views: number;
    follow_clicks: number;
    unique_follow_intents: number;
    discovery_profile_ctr: number | null;
    profile_follow_ctr: number | null;
  };
  funnel: {
    discovery_impressions: number;
    profile_views: number;
    follow_clicks: number;
    unique_follow_intents: number;
  };
  is_empty: boolean;
  last_aggregated_at: string | null;
}

export const analyticsService = {
  requireChannelOwnerOrAdmin,
  resolveRange,
  toUtcDateKey,

  async overview(actor: Actor | null, channelId: string, input: { window?: string; from?: string; to?: string } = {}): Promise<OverviewResult> {
    await requireChannelOwnerOrAdmin(actor, channelId);
    const range = resolveRange(input);
    await ensureRollups(channelId, range);
    const daily = await loadDaily(channelId, range);
    const sum = (k: keyof DailyMetric) => daily.reduce((a, d) => a + (Number(d[k] as number) || 0), 0);

    const discovery_impressions = sum('discovery_impressions');
    const search_impressions = sum('search_impressions');
    const profile_views = sum('profile_views');
    const unique_profile_views = sum('unique_profile_views');
    const follow_clicks = sum('follow_clicks');
    const unique_follow_intents = sum('unique_follow_intents');
    const totalReach = discovery_impressions + search_impressions;
    const kpis = {
      discovery_impressions, search_impressions,
      profile_views, unique_profile_views,
      follow_clicks, unique_follow_intents,
      discovery_profile_ctr: pctPoint(profile_views, totalReach),
      profile_follow_ctr: pctPoint(unique_follow_intents, unique_profile_views),
    };
    const funnel = {
      discovery_impressions: totalReach,
      profile_views: unique_profile_views || profile_views,
      follow_clicks,
      unique_follow_intents,
    };
    const isEmpty = totalReach === 0 && profile_views === 0 && follow_clicks === 0;
    const latest = daily
      .map((d) => (d.last_aggregated_at && new Date(d.last_aggregated_at).getTime()) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      window: range, kpis, funnel,
      is_empty: isEmpty,
      last_aggregated_at: latest > 0 ? new Date(latest).toISOString() : null,
    };
  },

  async timeseries(actor: Actor | null, channelId: string, input: { window?: string; from?: string; to?: string } = {}) {
    await requireChannelOwnerOrAdmin(actor, channelId);
    const range = resolveRange(input);
    await ensureRollups(channelId, range);
    const daily = await loadDaily(channelId, range);
    return {
      window: range,
      series: daily.map((d) => ({
        date: d.date,
        discovery_impressions: d.discovery_impressions,
        search_impressions: d.search_impressions,
        profile_views: d.profile_views,
        unique_profile_views: d.unique_profile_views,
        follow_clicks: d.follow_clicks,
        unique_follow_intents: d.unique_follow_intents,
        discovery_profile_ctr: pctPoint(d.profile_views, d.discovery_impressions + d.search_impressions),
        profile_follow_ctr: pctPoint(d.unique_follow_intents, d.unique_profile_views),
      })),
    };
  },

  async sources(actor: Actor | null, channelId: string, input: { window?: string; from?: string; to?: string } = {}) {
    await requireChannelOwnerOrAdmin(actor, channelId);
    const range = resolveRange(input);
    await ensureRollups(channelId, range);
    const coll = await getCollection<DailySourceMetric>(COLLECTIONS.CHANNEL_DAILY_SOURCE_METRICS);
    const rows = await coll.find(
      { channel_id: channelId, date: { $gte: range.fromKey, $lte: range.toKey } },
      { projection: { _id: 0 } },
    ).toArray();
    // Roll up per source across the range.
    const bySrc = new Map<AcquisitionSource, { impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number }>();
    for (const r of rows) {
      const src = (r.source || 'other') as AcquisitionSource;
      const cur = bySrc.get(src) || { impressions: 0, profile_views: 0, unique_profile_views: 0, follow_clicks: 0, unique_follow_intents: 0 };
      cur.impressions += r.impressions || 0;
      cur.profile_views += r.profile_views || 0;
      cur.unique_profile_views += r.unique_profile_views || 0;
      cur.follow_clicks += r.follow_clicks || 0;
      cur.unique_follow_intents += r.unique_follow_intents || 0;
      bySrc.set(src, cur);
    }
    const items = ACQUISITION_SOURCES
      .map((src) => {
        const c = bySrc.get(src);
        if (!c) return null;
        const nonZero = c.impressions + c.profile_views + c.follow_clicks + c.unique_follow_intents;
        if (nonZero === 0) return null;
        return {
          source: src,
          label: SOURCE_LABELS[src],
          impressions: c.impressions,
          profile_views: c.profile_views,
          unique_profile_views: c.unique_profile_views,
          follow_clicks: c.follow_clicks,
          unique_follow_intents: c.unique_follow_intents,
          profile_follow_ctr: pctPoint(c.unique_follow_intents, c.unique_profile_views),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (b.unique_follow_intents - a.unique_follow_intents) || (b.follow_clicks - a.follow_clicks));
    const is_empty = items.length === 0;
    return { window: range, items, is_empty };
  },

  async discovery(actor: Actor | null, channelId: string, input: { window?: string; from?: string; to?: string; limit?: number } = {}) {
    await requireChannelOwnerOrAdmin(actor, channelId);
    const range = resolveRange(input);
    await ensureRollups(channelId, range);
    const coll = await getCollection<SearchQueryMetric>(COLLECTIONS.CHANNEL_SEARCH_QUERY_METRICS);
    const rows = await coll.find(
      { channel_id: channelId, date: { $gte: range.fromKey, $lte: range.toKey } },
      { projection: { _id: 0 } },
    ).toArray();
    // Aggregate per query.
    const byQuery = new Map<string, { impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number }>();
    for (const r of rows) {
      const q = r.normalized_query;
      if (!q) continue;
      const cur = byQuery.get(q) || { impressions: 0, profile_views: 0, unique_profile_views: 0, follow_clicks: 0, unique_follow_intents: 0 };
      cur.impressions += r.impressions || 0;
      cur.profile_views += r.profile_views || 0;
      cur.unique_profile_views += r.unique_profile_views || 0;
      cur.follow_clicks += r.follow_clicks || 0;
      cur.unique_follow_intents += r.unique_follow_intents || 0;
      byQuery.set(q, cur);
    }
    const limit = Math.max(1, Math.min(input.limit || 50, 200));
    const items = [...byQuery.entries()]
      .filter(([, c]) => c.impressions >= SEARCH_QUERY_MIN_IMPRESSIONS)
      .map(([search_query, c]) => ({
        search_query,
        impressions: c.impressions,
        profile_views: c.profile_views,
        unique_profile_views: c.unique_profile_views,
        follow_clicks: c.follow_clicks,
        unique_follow_intents: c.unique_follow_intents,
        profile_follow_ctr: pctPoint(c.unique_follow_intents, c.unique_profile_views),
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, limit);
    const suppressed_count = byQuery.size - items.length;
    return { window: range, items, suppressed_count, threshold: SEARCH_QUERY_MIN_IMPRESSIONS, is_empty: items.length === 0 };
  },

  async geoDevice(actor: Actor | null, channelId: string, input: { window?: string; from?: string; to?: string } = {}) {
    await requireChannelOwnerOrAdmin(actor, channelId);
    const range = resolveRange(input);
    // Aggregate directly from raw events restricted to follow_click and profile_view.
    // Only aggregate counts — never expose individual sessions/IPs.
    const events = await getCollection<EventRecord>(COLLECTIONS.EVENTS);
    const rows = await events.aggregate<{ _id: { c: string | null; d: string | null }; clicks: number; profile_views: number }>([
      { $match: { channel_id: channelId, event_type: { $in: ['follow_click','channel_profile_view'] }, created_at: { $gte: parseUtcDate(range.fromKey), $lt: new Date(parseUtcDate(range.toKey).getTime() + 24 * 3600_000) } } },
      { $group: {
          _id: { c: '$country_code', d: '$device_type' },
          clicks: { $sum: { $cond: [{ $eq: ['$event_type', 'follow_click'] }, 1, 0] } },
          profile_views: { $sum: { $cond: [{ $eq: ['$event_type', 'channel_profile_view'] }, 1, 0] } },
      } },
    ]).toArray();
    // Aggregate to countries and devices independently. Minimum bucket size for
    // country granularity is 5 clicks — smaller buckets fold into 'Other'.
    const MIN_COUNTRY_CLICKS = 5;
    const countryMap = new Map<string, { clicks: number; profile_views: number }>();
    const deviceMap = new Map<string, { clicks: number; profile_views: number }>();
    for (const r of rows) {
      const c = r._id.c || 'unknown';
      const d = r._id.d || 'unknown';
      const cur = countryMap.get(c) || { clicks: 0, profile_views: 0 };
      cur.clicks += r.clicks; cur.profile_views += r.profile_views; countryMap.set(c, cur);
      const cur2 = deviceMap.get(d) || { clicks: 0, profile_views: 0 };
      cur2.clicks += r.clicks; cur2.profile_views += r.profile_views; deviceMap.set(d, cur2);
    }
    const countries: Array<{ country_code: string; clicks: number; profile_views: number }> = [];
    let otherClicks = 0; let otherViews = 0;
    for (const [code, v] of countryMap.entries()) {
      if (v.clicks < MIN_COUNTRY_CLICKS) {
        otherClicks += v.clicks;
        otherViews += v.profile_views;
        continue;
      }
      countries.push({ country_code: code, clicks: v.clicks, profile_views: v.profile_views });
    }
    if (otherClicks > 0 || otherViews > 0) countries.push({ country_code: 'other', clicks: otherClicks, profile_views: otherViews });
    countries.sort((a, b) => b.clicks - a.clicks);
    const devices = [...deviceMap.entries()].map(([device_type, v]) => ({ device_type, clicks: v.clicks, profile_views: v.profile_views })).sort((a, b) => b.clicks - a.clicks);
    const is_empty = countries.length === 0 && devices.length === 0;
    return { window: range, countries, devices, is_empty };
  },

  async triggerRollup(actor: Actor | null, params: { channel_id?: string; date_from?: string; date_to?: string; force?: boolean; dry_run?: boolean }) {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const role = actor.user.role;
    if (role !== 'admin' && role !== 'super_admin') throw new HttpError(403, 'Admin only');
    if (!params.channel_id) throw new HttpError(400, 'channel_id is required');
    const channel = await channelRepo.findById(params.channel_id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const range = resolveRange({ window: 'custom', from: params.date_from, to: params.date_to });
    if (params.dry_run) return { would_refresh: enumerateDateKeys(range.fromKey, range.toKey) };
    if (params.force) return await forceRebuildRange(channel.id, range);
    return await ensureRollups(channel.id, range);
  },
};
