'use client';

// Phase 3 — Pro-only Revenue Intelligence panel.
//
// This component receives EITHER:
//   • metrics (Pro / Enterprise / admin) → renders the metric grid + trend
//   • gated={true} (Free) → renders a compact upgrade state with inline
//     "Join Pro Waitlist" (reuses the existing pro_waitlist commercial-lead
//     endpoint; no new email architecture).
//
// The server is the authority — this component NEVER unlocks metrics by
// flipping a flag. If a Free user tampers with props, they still get 403
// from GET /api/owner/revenue-intelligence, so no PII / revenue data leaks.
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, TrendingUp, Loader2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';

interface Metrics {
  plan: 'pro' | 'enterprise' | 'admin_bypass';
  currency: 'USD';
  totals: {
    gross_revenue_minor: number;
    gateway_fees_minor: number;
    net_transaction_value_minor: number;
    owner_earnings_minor: number;
    platform_commission_minor: number;
    average_sponsorship_value_minor: number;
    orders_with_payment_count: number;
    fee_reconciled_orders_count: number;
  };
  conversion: {
    requests_count: number;
    accepted_count: number;
    paid_count: number;
    completed_count: number;
    acceptance_rate: number;
    payment_rate: number;
    completion_rate: number;
  };
  pipeline: { completed_count: number; in_progress_count: number };
  trend: Array<{ month: string; gross_revenue_minor: number; owner_earnings_minor: number; orders_count: number }>;
}

function fmtUsd(minor: number): string {
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

export default function RevenueIntelligencePanel({
  metrics,
  gated,
  userEmail,
}: {
  metrics: Metrics | null;
  gated: boolean;
  userEmail: string | null;
}) {
  if (gated) return <UpgradeState userEmail={userEmail} />;
  if (!metrics) return null;
  return <MetricsView metrics={metrics} />;
}

// ---------------------------------------------------------------------------
// Metrics view — Pro / Enterprise / admin
// ---------------------------------------------------------------------------
function MetricsView({ metrics }: { metrics: Metrics }) {
  const t = metrics.totals;
  const c = metrics.conversion;
  const maxTrend = Math.max(1, ...metrics.trend.map((m) => m.gross_revenue_minor));
  return (
    <section className="wh-card p-6 mt-8" data-testid="revenue-intelligence-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Revenue Intelligence</h2>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {metrics.plan === 'admin_bypass' ? 'Admin' : metrics.plan}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">All amounts USD. Fees only counted for reconciled orders.</p>
      </div>

      {/* Totals */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ri-totals">
        <Stat label="Gross Sponsorship Revenue" value={fmtUsd(t.gross_revenue_minor)} sub={`${t.orders_with_payment_count} paid order${t.orders_with_payment_count === 1 ? '' : 's'}`} />
        <Stat label="Payment Gateway Fees" value={fmtUsd(t.gateway_fees_minor)} sub={`${t.fee_reconciled_orders_count} reconciled`} />
        <Stat label="Net Transaction Value" value={fmtUsd(t.net_transaction_value_minor)} sub="Gross − fees" />
        <Stat label="Owner Earnings" value={fmtUsd(t.owner_earnings_minor)} sub="Your 90% share" primary />
        <Stat label="WaveLead Commission" value={fmtUsd(t.platform_commission_minor)} sub="10% platform" />
        <Stat label="Avg Sponsorship Value" value={fmtUsd(t.average_sponsorship_value_minor)} sub="Mean gross per paid order" />
        <Stat label="Completed" value={String(metrics.pipeline.completed_count)} sub="Delivered & accepted" />
        <Stat label="In Progress" value={String(metrics.pipeline.in_progress_count)} sub="Paid but not yet completed" />
      </div>

      {/* Conversion funnel */}
      <div className="mt-6" data-testid="ri-funnel">
        <div className="text-sm font-medium mb-3">Sponsorship Conversion</div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FunnelStep label="Requests" value={c.requests_count} rate={null} />
          <FunnelStep label="Accepted" value={c.accepted_count} rate={c.acceptance_rate} rateLabel="acceptance" />
          <FunnelStep label="Paid" value={c.paid_count} rate={c.payment_rate} rateLabel="payment" />
          <FunnelStep label="Completed" value={c.completed_count} rate={c.completion_rate} rateLabel="completion" />
        </div>
      </div>

      {/* Trend */}
      <div className="mt-6" data-testid="ri-trend">
        <div className="text-sm font-medium mb-3">Earnings Trend — last 12 months</div>
        <div className="flex items-end gap-1 h-32">
          {metrics.trend.map((m) => {
            const h = Math.max(2, Math.round((m.gross_revenue_minor / maxTrend) * 100));
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${m.month}: ${fmtUsd(m.gross_revenue_minor)} gross, ${fmtUsd(m.owner_earnings_minor)} owner, ${m.orders_count} orders`}>
                <div className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          {metrics.trend.map((m) => <span key={m.month}>{m.month.slice(5)}</span>)}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, primary }: { label: string; value: string; sub?: string; primary?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${primary ? 'border-primary/60 bg-primary/5' : 'border-border'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function FunnelStep({ label, value, rate, rateLabel }: { label: string; value: number; rate: number | null; rateLabel?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {rate !== null && (
        <div className="text-[11px] text-muted-foreground mt-0.5">{fmtPct(rate)} {rateLabel}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upgrade state — Free plan
// ---------------------------------------------------------------------------
function UpgradeState({ userEmail }: { userEmail: string | null }) {
  const [email, setEmail] = useState(userEmail || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy || !email) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/commercial-leads/pro-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const j = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wh-card p-6 mt-8 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent" data-testid="revenue-intelligence-upgrade">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Revenue Intelligence</h2>
              <Badge className="uppercase tracking-wider text-[10px]" data-testid="ri-pro-badge">
                <Sparkles className="h-3 w-3 mr-1" /> Pro
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground max-w-md">
              Unlock deeper revenue trends and sponsorship performance insights — gross revenue, gateway fees,
              conversion funnel from request to completion, and 12-month earnings trend.
            </p>
          </div>
        </div>
      </div>
      {done ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700" data-testid="ri-waitlist-done">
          <CheckCircle2 className="h-4 w-4" />
          You&apos;re on the Pro waitlist. We&apos;ll notify you when it launches.
        </div>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            data-testid="ri-waitlist-email"
          />
          <Button
            onClick={join}
            disabled={busy || !email}
            data-testid="ri-join-waitlist"
          >
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Joining…</> : 'Join Pro Waitlist'}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-rose-600 flex items-center gap-1">
          <AlertTriangle className="h-4 w-4" />{error}
        </div>
      )}
    </section>
  );
}
