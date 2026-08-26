'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import type { CommercialLead, CommercialLeadStatus } from '@/lib/types';

interface Counts {
  by_type: Record<string, Record<string, number>>;
  kpi: { new: number; qualified: number; won: number };
}

const STATUS_OPTIONS: CommercialLeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost'];
const STATUS_STYLE: Record<CommercialLeadStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-indigo-100 text-indigo-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-slate-100 text-slate-700',
};

export default function CommercialLeadsClient({ initialItems, initialCounts }: { initialItems: CommercialLead[]; initialCounts: Counts }) {
  const [items, setItems] = useState<CommercialLead[]>(initialItems);
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [filterType, setFilterType] = useState<'all' | 'pro_waitlist' | 'enterprise_sales'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | CommercialLeadStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => items.filter((i) =>
    (filterType === 'all' || i.type === filterType) &&
    (filterStatus === 'all' || i.status === filterStatus),
  ), [items, filterType, filterStatus]);

  async function refetch() {
    const params = new URLSearchParams();
    if (filterType !== 'all') params.set('type', filterType);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    const r = await fetch(`/api/admin/commercial-leads?${params.toString()}`, { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) { setItems(j.data.items); setCounts(j.data.counts); }
  }

  async function updateStatus(id: string, status: CommercialLeadStatus) {
    setBusyId(id); setError(null);
    try {
      const r = await fetch(`/api/admin/commercial-leads/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Update failed');
      await refetch();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(null); }
  }

  return (
    <div className="mt-6 space-y-6" data-testid="commercial-leads-admin">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="New" value={counts.kpi.new} accent="sky" />
        <Kpi label="Qualified" value={counts.kpi.qualified} accent="indigo" />
        <Kpi label="Won" value={counts.kpi.won} accent="emerald" />
        <Kpi label="Pro Waitlist" value={sumStatuses(counts.by_type.pro_waitlist)} accent="primary" />
        <Kpi label="Enterprise" value={sumStatuses(counts.by_type.enterprise_sales)} accent="rose" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs uppercase text-muted-foreground mb-1">Type</label>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)} className={selectCls}>
            <option value="all">All</option>
            <option value="pro_waitlist">Pro Waitlist</option>
            <option value="enterprise_sales">Enterprise</option>
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-muted-foreground mb-1">Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className={selectCls}>
            <option value="all">All</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="ml-auto"><Button variant="outline" size="sm" onClick={refetch}>Refresh</Button></div>
      </div>

      {error && <div className="text-sm text-rose-600">{error}</div>}

      {/* Table */}
      <div className="wh-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Company / Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2">Interest</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No leads.</td></tr>
            )}
            {filtered.map((l) => (
              <tr key={l.id} className="border-b border-border/60 last:border-0" data-testid={`lead-row-${l.id}`}>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <Badge className={l.type === 'enterprise_sales' ? 'bg-rose-100 text-rose-800' : 'bg-primary/10 text-primary'}>
                    {l.type === 'enterprise_sales' ? 'Enterprise' : 'Pro Waitlist'}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{l.company_name || l.name || '—'}</div>
                  {l.company_name && l.name && <div className="text-xs text-muted-foreground">{l.name}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{l.email}</td>
                <td className="px-3 py-2 text-xs">{l.country || '—'}</td>
                <td className="px-3 py-2 text-xs">{l.interest.length ? l.interest.join(', ') : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <select
                      className={selectCls + ' text-xs'}
                      value={l.status}
                      onChange={(e) => updateStatus(l.id, e.target.value as CommercialLeadStatus)}
                      disabled={busyId === l.id}
                      data-testid={`status-select-${l.id}`}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {busyId === l.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Badge className={STATUS_STYLE[l.status]}>{l.status}</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sumStatuses(m: Record<string, number> | undefined): number {
  if (!m) return 0;
  return Object.values(m).reduce((a, b) => a + b, 0);
}

function Kpi({ label, value, accent }: { label: string; value: number; accent: 'sky' | 'indigo' | 'emerald' | 'primary' | 'rose' }) {
  const map: Record<string, string> = { sky: 'text-sky-700', indigo: 'text-indigo-700', emerald: 'text-emerald-700', primary: 'text-primary', rose: 'text-rose-700' };
  return (
    <div className="wh-card p-4">
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}

const selectCls = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/40';
