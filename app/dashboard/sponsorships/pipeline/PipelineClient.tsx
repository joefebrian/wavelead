'use client';

// Pipeline kanban client. Renders only pre-computed cards from the server —
// never re-derives economics or lifecycle rules on the client. Filter changes
// trigger a re-fetch to keep server as the authority.
import React, { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowUpRight } from 'lucide-react';

type Stage = 'NEW' | 'ACCEPTED' | 'READY_TO_WORK' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED';

interface Card {
  id: string;
  stage: Stage;
  status: string;
  brand_company: string;
  channel_slug: string;
  channel_name: string;
  package_name: string;
  gross_minor: number | null;
  owner_earnings_minor: number | null;
  currency: 'USD';
  created_at: string | Date;
  expected_delivery_at: string | Date | null;
  last_activity_at: string | Date | null;
  needs_attention: boolean;
  needs_attention_reason: string | null;
  cta_label: string;
  cta_href: string;
}

interface Data {
  plan: string;
  metrics: {
    active_opportunities: number;
    awaiting_your_action: number;
    in_progress: number;
    awaiting_brand_review: number;
  };
  channels: Array<{ slug: string; name: string }>;
  stages: readonly Stage[];
  cards: Card[];
}

const STAGE_LABELS: Record<Stage, string> = {
  NEW: 'New',
  ACCEPTED: 'Accepted / Awaiting Payment',
  READY_TO_WORK: 'Ready to Work',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  COMPLETED: 'Completed',
};

function fmtUsd(minor: number | null): string {
  if (minor === null) return '—';
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string | Date | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function relative(d: string | Date | null): string {
  if (!d) return '—';
  const t = new Date(d).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function PipelineClient({ initial, stages }: { initial: Data; stages: readonly Stage[] }) {
  const [data, setData] = useState<Data>(initial);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<Stage | ''>('');
  const [attentionOnly, setAttentionOnly] = useState(false);

  async function reload(next: { channel?: string; stage?: Stage | ''; attention?: boolean }) {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      const c = next.channel ?? channel;
      const s = next.stage ?? stageFilter;
      const a = next.attention ?? attentionOnly;
      if (c) params.set('channel', c);
      if (s) params.set('stage', s);
      if (a) params.set('attention', '1');
      const r = await fetch(`/api/owner/sponsorship-pipeline${params.toString() ? '?' + params.toString() : ''}`, { credentials: 'include' });
      const j = await r.json() as { ok?: boolean; data?: Data };
      if (r.ok && j?.data) setData(j.data);
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="pipeline-kanban">
      {/* Metrics */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active Opportunities" value={data.metrics.active_opportunities} />
        <Metric label="Awaiting Your Action" value={data.metrics.awaiting_your_action} highlight />
        <Metric label="In Progress" value={data.metrics.in_progress} />
        <Metric label="Awaiting Brand Review" value={data.metrics.awaiting_brand_review} />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-2 items-center" data-testid="pipeline-filters">
        <select
          value={channel}
          onChange={(e) => { setChannel(e.target.value); reload({ channel: e.target.value }); }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="filter-channel"
        >
          <option value="">All channels</option>
          {data.channels.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => { const v = e.target.value as Stage | ''; setStageFilter(v); reload({ stage: v }); }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="filter-stage"
        >
          <option value="">All stages</option>
          {stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(e) => { setAttentionOnly(e.target.checked); reload({ attention: e.target.checked }); }}
            data-testid="filter-attention"
          />
          Needs Attention only
        </label>
        {busy && <span className="text-xs text-muted-foreground">Refreshing…</span>}
      </div>

      {/* Kanban */}
      <div className="mt-6 grid gap-4 xl:grid-cols-6 lg:grid-cols-3 sm:grid-cols-2 grid-cols-1">
        {stages.map((stage) => {
          const cards = data.cards.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="wh-card p-3" data-testid={`pipeline-col-${stage}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{STAGE_LABELS[stage]}</div>
                <Badge variant="outline" className="text-[10px]">{cards.length}</Badge>
              </div>
              <div className="space-y-2">
                {cards.length === 0 && <div className="text-xs text-muted-foreground italic py-4 text-center">No cards</div>}
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className={`rounded-md border p-3 text-xs ${card.needs_attention ? 'border-amber-400 bg-amber-50/50' : 'border-border bg-background'}`}
                    data-testid={`pipeline-card-${card.id}`}
                  >
                    <div className="font-semibold text-sm">{card.brand_company}</div>
                    <div className="text-muted-foreground truncate">{card.channel_name} · {card.package_name}</div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-muted-foreground">Gross</span>
                      <span className="font-medium">{fmtUsd(card.gross_minor)}</span>
                    </div>
                    {card.owner_earnings_minor !== null && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-muted-foreground">Owner</span>
                        <span className="font-medium text-primary">{fmtUsd(card.owner_earnings_minor)}</span>
                      </div>
                    )}
                    <div className="mt-2 flex items-baseline justify-between text-[10px] text-muted-foreground">
                      <span>Requested {fmtDate(card.created_at)}</span>
                      {card.expected_delivery_at && <span>Due {fmtDate(card.expected_delivery_at)}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Last: {relative(card.last_activity_at)}</div>
                    {card.needs_attention && card.needs_attention_reason && (
                      <div className="mt-2 flex items-center gap-1 text-amber-700 text-[11px] font-medium" data-testid="attention-flag">
                        <AlertCircle className="h-3 w-3" /> {card.needs_attention_reason}
                      </div>
                    )}
                    <div className="mt-2">
                      <Link href={card.cta_href}>
                        <Button size="sm" variant="outline" className="w-full text-xs h-8">
                          {card.cta_label} <ArrowUpRight className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-primary/60 bg-primary/5' : 'border-border'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
