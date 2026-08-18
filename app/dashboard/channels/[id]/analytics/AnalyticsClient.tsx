'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpRight, ArrowDownRight, Minus, Download, Search, Sparkles,
  TrendingUp, MousePointerClick, Eye, Users2, Info, ChevronDown, ChevronRight, Loader2, ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts';

type WindowKey = '7d' | '30d' | '90d' | 'custom';
type Tab = 'overview' | 'acquisition' | 'discovery' | 'audience' | 'growth';

interface ChannelSummary { id: string; name: string; slug: string; }

interface Props {
  channelId: string;
  channelSlug: string;
  myChannels: ChannelSummary[];
  isAdminViewingOtherChannel?: boolean;
}

interface KpiCurrent {
  discovery_impressions: number;
  search_impressions: number;
  profile_views: number;
  unique_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  discovery_profile_ctr: number | null;
  profile_follow_ctr: number | null;
}
interface OverviewData {
  window: { fromKey: string; toKey: string; days: number };
  kpis: KpiCurrent;
  funnel: { discovery_impressions: number; profile_views: number; follow_clicks: number; unique_follow_intents: number };
  previous?: {
    window: { fromKey: string; toKey: string; days: number };
    kpis: KpiCurrent;
    has_data: boolean;
    deltas: {
      discovery_impressions: number | null; search_impressions: number | null;
      profile_views: number | null; unique_profile_views: number | null;
      follow_clicks: number | null; unique_follow_intents: number | null;
      discovery_profile_ctr: number | null; profile_follow_ctr: number | null;
    };
  };
  is_empty: boolean;
  last_aggregated_at: string | null;
}
interface TimeseriesData {
  window: { fromKey: string; toKey: string };
  series: Array<{ date: string; discovery_impressions: number; search_impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number; discovery_profile_ctr: number | null; profile_follow_ctr: number | null }>;
}
interface SourcesData {
  window: { fromKey: string; toKey: string };
  items: Array<{ source: string; label: string; impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number; profile_follow_ctr: number | null }>;
  is_empty: boolean;
}
interface DiscoveryData {
  window: { fromKey: string; toKey: string };
  items: Array<{ search_query: string; impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number; profile_follow_ctr: number | null }>;
  suppressed_count: number;
  threshold: number;
  is_empty: boolean;
}
interface GeoDeviceData {
  window: { fromKey: string; toKey: string };
  countries: Array<{ country_code: string; clicks: number; profile_views: number }>;
  devices: Array<{ device_type: string; clicks: number; profile_views: number }>;
  is_empty: boolean;
}
interface CompletenessData {
  score: number;
  total: number;
  checks: Array<{ key: string; label: string; weight: number; done: boolean }>;
}
interface RecommendationsData {
  window: { fromKey: string; toKey: string };
  recommendations: Array<{ id: string; severity: 'info' | 'warn' | 'success'; title: string; body: string }>;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include', cache: 'no-store' });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Request failed');
  return j.data as T;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number(n).toLocaleString();
}
function fmtCtr(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(2)}%`;
}
function windowLabel(w: WindowKey): string {
  return { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', custom: 'Custom' }[w];
}

function useDebouncedEffect(effect: () => void | Promise<void>, deps: React.DependencyList, delay = 100) {
  useEffect(() => {
    const t = setTimeout(() => { void effect(); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ---------------- Component ----------------
export default function AnalyticsClient({ channelId, channelSlug, myChannels, isAdminViewingOtherChannel }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [windowKey, setWindowKey] = useState<WindowKey>('30d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [compare, setCompare] = useState<boolean>(true);
  const [loading, setLoading] = useState<{ [k in Tab]?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [sources, setSources] = useState<SourcesData | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryData | null>(null);
  const [geoDevice, setGeoDevice] = useState<GeoDeviceData | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessData | null>(null);
  const [recs, setRecs] = useState<RecommendationsData | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (windowKey === 'custom') {
      if (!customFrom || !customTo) return null;
      p.set('window', 'custom'); p.set('from', customFrom); p.set('to', customTo);
    } else p.set('window', windowKey);
    return p;
  }, [windowKey, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!qs) return;
    setError(null);
    const base = `/api/owner/channels/${channelId}/analytics`;
    const qStr = qs.toString();
    const compareStr = compare ? `${qStr}&compare=previous` : qStr;
    try {
      setLoading((l) => ({ ...l, overview: true, growth: true }));
      const [ov, ts, cp, rc] = await Promise.all([
        apiGet<OverviewData>(`${base}/overview?${compareStr}`),
        apiGet<TimeseriesData>(`${base}/timeseries?${qStr}`),
        apiGet<CompletenessData>(`${base}/completeness`),
        apiGet<RecommendationsData>(`${base}/recommendations?${qStr}`),
      ]);
      setOverview(ov); setTimeseries(ts); setCompleteness(cp); setRecs(rc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading((l) => ({ ...l, overview: false, growth: false }));
    }
    try {
      setLoading((l) => ({ ...l, acquisition: true }));
      const s = await apiGet<SourcesData>(`${base}/sources?${qStr}`);
      setSources(s);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading((l) => ({ ...l, acquisition: false })); }
    try {
      setLoading((l) => ({ ...l, discovery: true }));
      const d = await apiGet<DiscoveryData>(`${base}/discovery?${qStr}&limit=100`);
      setDiscovery(d);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading((l) => ({ ...l, discovery: false })); }
    try {
      setLoading((l) => ({ ...l, audience: true }));
      const g = await apiGet<GeoDeviceData>(`${base}/geo-device?${qStr}`);
      setGeoDevice(g);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading((l) => ({ ...l, audience: false })); }
  }, [qs, channelId, compare]);

  useDebouncedEffect(() => { void load(); }, [load], 60);

  const exportUrl = (kind: 'overview' | 'acquisition' | 'search-terms') => {
    if (!qs) return '#';
    return `/api/owner/channels/${channelId}/analytics/export?kind=${kind}&${qs.toString()}`;
  };

  const goToChannel = (id: string) => {
    router.push(`/dashboard/channels/${id}/analytics`);
  };

  return (
    <div className="mt-6 space-y-6">
      {isAdminViewingOtherChannel && (
        <div className="wh-card bg-amber-50 border-amber-300/60 p-3 text-sm text-amber-900 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> You are viewing another owner&apos;s analytics as an administrator.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 flex-wrap">
        {myChannels.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Channel</span>
            <select
              value={channelId}
              onChange={(e) => goToChannel(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Switch channel"
            >
              {myChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
          {(['7d','30d','90d','custom'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setWindowKey(k)}
              className={`px-3 py-1.5 rounded-md text-sm ${windowKey === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-pressed={windowKey === k}
            >{k === 'custom' ? 'Custom' : k.toUpperCase()}</button>
          ))}
        </div>
        {windowKey === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" aria-label="From date" />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" aria-label="To date" />
          </div>
        )}
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="h-4 w-4" />
          Compare to previous period
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a href={exportUrl('overview')} className={qs ? '' : 'pointer-events-none opacity-50'}>
            <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4" /> Overview CSV</Button>
          </a>
          <a href={exportUrl('acquisition')} className={qs ? '' : 'pointer-events-none opacity-50'}>
            <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4" /> Acquisition CSV</Button>
          </a>
          <a href={exportUrl('search-terms')} className={qs ? '' : 'pointer-events-none opacity-50'}>
            <Button variant="outline" size="sm" className="gap-1"><Download className="h-4 w-4" /> Search Terms CSV</Button>
          </a>
        </div>
      </div>

      {windowKey === 'custom' && (!customFrom || !customTo) && (
        <div className="wh-card p-3 text-sm text-muted-foreground">Pick a start and end date to load analytics.</div>
      )}

      {error && (
        <div className="wh-card p-3 text-sm text-destructive">{error}</div>
      )}

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {(['overview','acquisition','discovery','audience','growth'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px capitalize ${tab === t ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            aria-selected={tab === t}
          >{t}</button>
        ))}
      </div>

      {/* Tabs content */}
      {tab === 'overview' && (
        <OverviewTab data={overview} timeseries={timeseries} loading={!!loading.overview} channelSlug={channelSlug} windowKey={windowKey} />
      )}
      {tab === 'acquisition' && (
        <AcquisitionTab data={sources} loading={!!loading.acquisition} />
      )}
      {tab === 'discovery' && (
        <DiscoveryTab data={discovery} loading={!!loading.discovery} />
      )}
      {tab === 'audience' && (
        <AudienceTab data={geoDevice} loading={!!loading.audience} />
      )}
      {tab === 'growth' && (
        <GrowthTab completeness={completeness} recs={recs} loading={!!loading.growth} windowLabel={windowLabel(windowKey)} />
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function DeltaChip({ delta, small }: { delta: number | null | undefined; small?: boolean }) {
  if (delta === null || delta === undefined) {
    return <span className={`inline-flex items-center gap-0.5 text-muted-foreground ${small ? 'text-xs' : 'text-sm'}`}><Minus className="h-3 w-3" /> —</span>;
  }
  const up = delta > 0; const flat = delta === 0;
  const cls = flat ? 'text-muted-foreground' : up ? 'text-emerald-600' : 'text-rose-600';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const sign = flat ? '' : up ? '+' : '';
  return <span className={`inline-flex items-center gap-0.5 font-medium ${cls} ${small ? 'text-xs' : 'text-sm'}`}><Icon className="h-3.5 w-3.5" /> {sign}{delta}%</span>;
}

function CtrDeltaChip({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" /> —</span>;
  const up = delta > 0; const flat = delta === 0;
  const cls = flat ? 'text-muted-foreground' : up ? 'text-emerald-600' : 'text-rose-600';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const sign = flat ? '' : up ? '+' : '';
  return <span className={`inline-flex items-center gap-0.5 font-medium ${cls} text-xs`}><Icon className="h-3 w-3" /> {sign}{delta.toFixed(2)} pp</span>;
}

function KpiCard({ label, value, delta, ctrDelta, icon }: { label: string; value: string; delta?: number | null; ctrDelta?: number | null; icon?: React.ReactNode }) {
  return (
    <div className="wh-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1">{ctrDelta !== undefined ? <CtrDeltaChip delta={ctrDelta} /> : <DeltaChip delta={delta} small />}</div>
    </div>
  );
}

function OverviewTab({ data, timeseries, loading, channelSlug, windowKey }: { data: OverviewData | null; timeseries: TimeseriesData | null; loading: boolean; channelSlug: string; windowKey: WindowKey }) {
  if (loading && !data) return <SkeletonBlock />;
  if (!data) return <EmptyPlaceholder message="Pick a date range to load analytics." />;

  const hasPrev = !!data.previous;
  const d = data.previous?.deltas;

  return (
    <div className="space-y-6">
      {data.is_empty && (
        <div className="wh-card p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">No analytics yet for this window</div>
          <p className="mt-1">Discovery events will start populating this dashboard as visitors reach your channel through Search, Homepage and Category pages.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Discovery Impressions" value={fmt(data.kpis.discovery_impressions)} delta={d?.discovery_impressions} icon={<Eye className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Search Impressions" value={fmt(data.kpis.search_impressions)} delta={d?.search_impressions} icon={<Search className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Profile Views" value={fmt(data.kpis.profile_views)} delta={d?.profile_views} icon={<Users2 className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Unique Profile Views" value={fmt(data.kpis.unique_profile_views)} delta={d?.unique_profile_views} icon={<Users2 className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Follow Clicks" value={fmt(data.kpis.follow_clicks)} delta={d?.follow_clicks} icon={<MousePointerClick className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Unique Follow Intent" value={fmt(data.kpis.unique_follow_intents)} delta={d?.unique_follow_intents} icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Discovery → Profile CTR" value={fmtCtr(data.kpis.discovery_profile_ctr)} ctrDelta={d?.discovery_profile_ctr} icon={<Info className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Profile → Follow CTR" value={fmtCtr(data.kpis.profile_follow_ctr)} ctrDelta={d?.profile_follow_ctr} icon={<Info className="h-4 w-4 text-muted-foreground" />} />
      </div>

      {hasPrev && !data.previous!.has_data && (
        <div className="text-xs text-muted-foreground">Not enough previous data to compare — deltas may show as —.</div>
      )}

      {/* Chart */}
      <div className="wh-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">Performance over time</div>
            <div className="text-xs text-muted-foreground">{windowLabel(windowKey)}</div>
          </div>
        </div>
        {timeseries && timeseries.series.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeseries.series} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(v: number) => fmt(v)} labelStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="profile_views" name="Profile Views" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="follow_clicks" name="Follow Clicks" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="unique_follow_intents" name="Unique Follow Intent" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyPlaceholder small message="No timeseries data in this window yet." />}
      </div>

      {/* Funnel */}
      <div className="wh-card p-4">
        <div className="text-sm font-semibold">Discovery → Profile → Follow Intent</div>
        <p className="text-xs text-muted-foreground mt-1">Unique Follow Intent is not the same as WhatsApp followers — it counts distinct visitors who tapped Follow within 24h.</p>
        <FunnelViz funnel={data.funnel} kpis={data.kpis} />
      </div>

      {data.last_aggregated_at && (
        <div className="text-xs text-muted-foreground">Last aggregated: {new Date(data.last_aggregated_at).toLocaleString()} · <span>Public profile: <a className="underline" href={`/channel/${channelSlug}`} target="_blank" rel="noreferrer">/channel/{channelSlug}</a></span></div>
      )}
    </div>
  );
}

function FunnelViz({ funnel, kpis }: { funnel: OverviewData['funnel']; kpis: KpiCurrent }) {
  const steps = [
    { label: 'Discovery Impressions', v: funnel.discovery_impressions },
    { label: 'Unique Profile Views', v: kpis.unique_profile_views || funnel.profile_views },
    { label: 'Unique Follow Intent', v: funnel.unique_follow_intents },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  return (
    <div className="mt-3 space-y-2">
      {steps.map((s, i) => {
        const pct = Math.round((s.v / max) * 100);
        const prev = i > 0 ? steps[i - 1].v : null;
        const rate = i > 0 && prev && prev > 0 ? Math.round((s.v / prev) * 10000) / 100 : null;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums">{s.v.toLocaleString()} {rate !== null && <span className="text-muted-foreground text-xs">· {rate}% of previous step</span>}</span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
      <div className="grid grid-cols-2 gap-3 mt-2 text-sm">
        <div className="wh-card p-3"><div className="text-xs text-muted-foreground">Discovery → Profile</div><div className="font-semibold">{fmtCtr(kpis.discovery_profile_ctr)}</div></div>
        <div className="wh-card p-3"><div className="text-xs text-muted-foreground">Profile → Follow</div><div className="font-semibold">{fmtCtr(kpis.profile_follow_ctr)}</div></div>
      </div>
    </div>
  );
}

function AcquisitionTab({ data, loading }: { data: SourcesData | null; loading: boolean }) {
  if (loading && !data) return <SkeletonBlock />;
  if (!data) return <EmptyPlaceholder />;
  if (data.is_empty) return <EmptyPlaceholder message="No acquisition data in this window yet." />;
  const maxUfi = Math.max(1, ...data.items.map((it) => it.unique_follow_intents));
  return (
    <div className="space-y-4">
      <div className="wh-card p-4">
        <div className="text-sm font-semibold">Acquisition by source</div>
        <p className="text-xs text-muted-foreground mt-1">Where your Follow Intent is coming from across WaveLead. Sources with no activity in this window are hidden.</p>
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.items} margin={{ left: 4, right: 8, top: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" interval={0} height={60} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="unique_follow_intents" name="Unique Follow Intent" fill="#10b981" />
              <Bar dataKey="follow_clicks" name="Follow Clicks" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="wh-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="py-2 px-3 font-medium">Source</th>
              <th className="py-2 px-3 font-medium text-right">Impressions</th>
              <th className="py-2 px-3 font-medium text-right">Profile Views</th>
              <th className="py-2 px-3 font-medium text-right">Unique PVs</th>
              <th className="py-2 px-3 font-medium text-right">Follow Clicks</th>
              <th className="py-2 px-3 font-medium text-right">Unique FI</th>
              <th className="py-2 px-3 font-medium text-right">Profile → Follow</th>
              <th className="py-2 px-3 font-medium">Share of UFI</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.source} className="border-t border-border">
                <td className="py-2 px-3">{it.label}</td>
                <td className="py-2 px-3 text-right tabular-nums">{it.impressions.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{it.profile_views.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{it.unique_profile_views.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{it.follow_clicks.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums font-semibold">{it.unique_follow_intents.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtCtr(it.profile_follow_ctr)}</td>
                <td className="py-2 px-3 w-32">
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round((it.unique_follow_intents / maxUfi) * 100)}%` }} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiscoveryTab({ data, loading }: { data: DiscoveryData | null; loading: boolean }) {
  if (loading && !data) return <SkeletonBlock />;
  if (!data) return <EmptyPlaceholder />;
  if (data.is_empty) {
    return (
      <div className="wh-card p-4">
        <div className="text-sm font-semibold">Search terms</div>
        <p className="text-xs text-muted-foreground mt-1">No search terms met the privacy threshold of {data.threshold}+ impressions in this window.</p>
        {data.suppressed_count > 0 && <p className="text-xs text-muted-foreground mt-1">{data.suppressed_count} lower-volume terms are hidden until they meet the threshold.</p>}
      </div>
    );
  }
  return (
    <div className="wh-card overflow-x-auto">
      <div className="p-4 border-b border-border">
        <div className="text-sm font-semibold">Search terms driving discovery</div>
        <p className="text-xs text-muted-foreground mt-1">
          Only queries with ≥ {data.threshold} impressions are shown for privacy. {data.suppressed_count > 0 && `${data.suppressed_count} lower-volume terms are hidden.`}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left">
            <th className="py-2 px-3 font-medium">Search term</th>
            <th className="py-2 px-3 font-medium text-right">Impressions</th>
            <th className="py-2 px-3 font-medium text-right">Profile Views</th>
            <th className="py-2 px-3 font-medium text-right">Unique PVs</th>
            <th className="py-2 px-3 font-medium text-right">Follow Clicks</th>
            <th className="py-2 px-3 font-medium text-right">Unique FI</th>
            <th className="py-2 px-3 font-medium text-right">Profile → Follow</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.search_query} className="border-t border-border">
              <td className="py-2 px-3 max-w-[260px] truncate">{it.search_query}</td>
              <td className="py-2 px-3 text-right tabular-nums">{it.impressions.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{it.profile_views.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{it.unique_profile_views.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{it.follow_clicks.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums font-semibold">{it.unique_follow_intents.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtCtr(it.profile_follow_ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AudienceTab({ data, loading }: { data: GeoDeviceData | null; loading: boolean }) {
  if (loading && !data) return <SkeletonBlock />;
  if (!data) return <EmptyPlaceholder />;
  if (data.is_empty) return <EmptyPlaceholder message="No audience data in this window yet." />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="wh-card overflow-x-auto">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-semibold">By country</div>
          <p className="text-xs text-muted-foreground mt-1">
            Aggregated WaveLead visitor context — not WhatsApp follower demographics. Countries with fewer than 5 clicks are grouped as &ldquo;Other&rdquo;.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr className="text-left"><th className="py-2 px-3 font-medium">Country</th><th className="py-2 px-3 font-medium text-right">Profile Views</th><th className="py-2 px-3 font-medium text-right">Clicks</th></tr></thead>
          <tbody>
            {data.countries.map((c) => (
              <tr key={c.country_code} className="border-t border-border">
                <td className="py-2 px-3">{c.country_code === 'other' ? <em className="text-muted-foreground">Other (small buckets)</em> : c.country_code === 'unknown' ? <em className="text-muted-foreground">Unknown</em> : c.country_code}</td>
                <td className="py-2 px-3 text-right tabular-nums">{c.profile_views.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{c.clicks.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wh-card overflow-x-auto">
        <div className="p-4 border-b border-border">
          <div className="text-sm font-semibold">By device</div>
          <p className="text-xs text-muted-foreground mt-1">Broad category only — WaveLead never exposes device fingerprints.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr className="text-left"><th className="py-2 px-3 font-medium">Device</th><th className="py-2 px-3 font-medium text-right">Profile Views</th><th className="py-2 px-3 font-medium text-right">Clicks</th></tr></thead>
          <tbody>
            {data.devices.map((d) => (
              <tr key={d.device_type} className="border-t border-border">
                <td className="py-2 px-3 capitalize">{d.device_type === 'unknown' ? <em className="text-muted-foreground">Unknown</em> : d.device_type}</td>
                <td className="py-2 px-3 text-right tabular-nums">{d.profile_views.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{d.clicks.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrowthTab({ completeness, recs, loading, windowLabel: winLbl }: { completeness: CompletenessData | null; recs: RecommendationsData | null; loading: boolean; windowLabel: string }) {
  if (loading && !completeness && !recs) return <SkeletonBlock />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {completeness && (
        <div className="wh-card p-4 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Profile completeness</div>
            <Badge variant={completeness.score >= 80 ? 'default' : 'secondary'}>{completeness.score}%</Badge>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${completeness.score}%` }} /></div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {completeness.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.done ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} aria-hidden />
                <span className={c.done ? '' : 'text-muted-foreground'}>{c.label}</span>
                {!c.done && <span className="ml-auto text-xs text-muted-foreground">+{c.weight}%</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lg:col-span-2 space-y-3">
        <div>
          <div className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Growth recommendations</div>
          <div className="text-xs text-muted-foreground mt-1">Rule-based — {winLbl}. Recommendations change automatically as your data changes.</div>
        </div>
        {(recs?.recommendations || []).length === 0 ? (
          <div className="wh-card p-4 text-sm text-muted-foreground">No recommendations right now. Keep growing!</div>
        ) : (
          <ul className="space-y-2">
            {recs!.recommendations.map((r) => (
              <li key={r.id} className="wh-card p-4">
                <div className="flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 rounded-full ${r.severity === 'warn' ? 'bg-amber-500' : r.severity === 'success' ? 'bg-emerald-500' : 'bg-sky-500'}`} aria-hidden />
                  <div>
                    <div className="font-semibold text-sm">{r.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{r.body}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyPlaceholder({ message, small }: { message?: string; small?: boolean }) {
  return <div className={`wh-card ${small ? 'p-3' : 'p-6'} text-sm text-muted-foreground text-center`}>{message || 'No data in this window yet.'}</div>;
}

function SkeletonBlock() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0,1,2,3,4,5,6,7].map((i) => (
        <div key={i} className="wh-card p-4 animate-pulse">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="mt-3 h-6 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// unused imports quieten
void ChevronDown; void ChevronRight; void Loader2;
