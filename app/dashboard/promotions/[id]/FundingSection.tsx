'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type FundingStatus =
  | 'created' | 'checkout_created' | 'pending'
  | 'paid' | 'failed' | 'cancelled'
  | 'partially_refunded' | 'refunded' | 'legacy_waived';

interface FundingSummary {
  funded: boolean;
  balance_usd_micros: number;
  total_paid_usd_minor: number;
  has_legacy_waiver: boolean;
  last_funding_status: string | null;
}

interface FundingOrder {
  id: string;
  status: FundingStatus;
  amount_minor: number;
  amount_captured_minor: number;
  amount_refunded_minor: number;
  currency: string;
  approve_url: string | null;
  provider_order_id: string | null;
  created_at: string;
}

interface Props {
  campaignId: string;
  campaignStatus: string;
  budgetMinor: number;
  estimatedSpendMinor: number;
  initialSummary: FundingSummary;
  latestOrder: FundingOrder | null;
}

function dollars(minor: number | null | undefined): string { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }

export default function FundingSection({ campaignId, campaignStatus, budgetMinor, estimatedSpendMinor, initialSummary, latestOrder }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [summary, setSummary] = useState<FundingSummary>(initialSummary);
  const [order, setOrder] = useState<FundingOrder | null>(latestOrder);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error' | 'ok'; text: string } | null>(null);
  const returningFundingId = search.get('funding');

  const refresh = useCallback(async () => {
    // Server is the sole source of truth for funding status.
    const [s, o] = await Promise.all([
      fetch(`/api/owner/promotions/${campaignId}/funding-summary`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/owner/promotions/${campaignId}/funding-orders`, { cache: 'no-store' }).then((r) => r.json()),
    ]);
    if (s?.ok) setSummary(s.data as FundingSummary);
    if (o?.ok) {
      const items = (o.data?.items || []) as FundingOrder[];
      setOrder(items[0] || null);
    }
  }, [campaignId]);

  // Post-approval browser return: send ONLY the funding_id. The server does not
  // trust any client-supplied status/amount/paid flag. If capture succeeds via
  // server-to-server PayPal API (or webhook already finalized), we reflect the
  // authoritative state — never the URL.
  useEffect(() => {
    if (!returningFundingId) return;
    (async () => {
      setBusy(true);
      setMessage({ kind: 'info', text: 'Confirming your payment with PayPal…' });
      try {
        const r = await fetch(`/api/payments/funding/${returningFundingId}/capture`, { method: 'POST' });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || 'Capture failed');
        if (j.data?.funding?.status === 'paid') setMessage({ kind: 'ok', text: 'Payment confirmed. Your campaign is now funded.' });
        else if (j.data?.funding?.status === 'failed') setMessage({ kind: 'error', text: 'Payment failed. Please try again.' });
        else if (j.data?.funding?.status === 'cancelled') setMessage({ kind: 'info', text: 'Payment cancelled.' });
        else setMessage({ kind: 'info', text: `Payment status: ${j.data?.funding?.status || 'pending'}.` });
      } catch (e) {
        setMessage({ kind: 'error', text: (e as Error).message || 'Unable to confirm payment.' });
      } finally {
        await refresh();
        router.replace(`/dashboard/promotions/${campaignId}`);
        router.refresh();
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningFundingId]);

  async function fundCampaign() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // No amount / currency / campaign ownership in the request body — the
      // server derives all of those from campaign_id + session actor.
      const r = await fetch(`/api/owner/promotions/${campaignId}/funding`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not start payment');
      const url = j.data?.funding?.approve_url as string | undefined;
      if (!url) throw new Error('Payment provider did not return an approval URL.');
      // Redirect owner to PayPal Checkout.
      window.location.href = url;
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
      setBusy(false);
    }
  }

  async function retryCapture() {
    if (!order || busy) return;
    setBusy(true);
    setMessage({ kind: 'info', text: 'Retrying payment confirmation…' });
    try {
      const r = await fetch(`/api/payments/funding/${order.id}/capture`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Capture failed');
      setMessage({ kind: j.data?.funding?.status === 'paid' ? 'ok' : 'info', text: `Payment status: ${j.data?.funding?.status}.` });
      await refresh();
      router.refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const notFundableStates = ['draft', 'pending_review', 'cancelled', 'rejected', 'completed'];
  const isFundable = !notFundableStates.includes(campaignStatus);
  const hasOpenCheckout = order && ['created', 'checkout_created'].includes(order.status);
  const pendingCapture = order && order.status === 'pending';
  const isFunded = summary.funded && summary.total_paid_usd_minor > 0;
  const isLegacyWaived = summary.has_legacy_waiver;
  const failed = order && order.status === 'failed';
  const cancelled = order && order.status === 'cancelled';
  const refunded = order && (order.status === 'refunded' || order.status === 'partially_refunded');

  const balanceMinor = Math.round((summary.balance_usd_micros || 0) / 10_000);
  const remainingAfterSpend = Math.max(0, balanceMinor - estimatedSpendMinor);

  return (
    <section className="mt-6 wh-card p-5" data-testid="funding-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-semibold text-lg">Funding</div>
        {isFunded && <Badge variant="secondary" data-testid="funding-badge-funded">Funded</Badge>}
        {isLegacyWaived && !isFunded && <Badge variant="outline" data-testid="funding-badge-legacy">Legacy — payment waived</Badge>}
        {hasOpenCheckout && !isFunded && <Badge data-testid="funding-badge-pending">Awaiting payment</Badge>}
        {pendingCapture && !isFunded && <Badge data-testid="funding-badge-processing">Processing</Badge>}
        {failed && <Badge variant="destructive" data-testid="funding-badge-failed">Payment failed</Badge>}
        {refunded && <Badge variant="outline" data-testid="funding-badge-refunded">{order?.status === 'refunded' ? 'Refunded' : 'Partially refunded'}</Badge>}
      </div>

      {message && (
        <div
          role="status"
          data-testid="funding-message"
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            message.kind === 'ok' ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/30 dark:text-green-200 dark:border-green-900' :
            message.kind === 'error' ? 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900' :
            'bg-muted text-muted-foreground border border-border'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* APPROVED + UNFUNDED */}
      {!isFunded && !isLegacyWaived && isFundable && !hasOpenCheckout && !pendingCapture && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCell label="Campaign Budget" value={dollars(budgetMinor)} testid="funding-stat-budget" />
          <StatCell label="Funding Required" value={dollars(budgetMinor)} testid="funding-stat-required" />
          <div className="sm:col-span-2 pt-1">
            <Button onClick={fundCampaign} disabled={busy} className="w-full sm:w-auto" data-testid="fund-campaign-cta">
              {busy ? 'Redirecting to PayPal…' : `Fund Campaign with PayPal — ${dollars(budgetMinor)}`}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              You&apos;ll be redirected to PayPal Sandbox to complete a secure payment. Your campaign will activate automatically after confirmation.
            </p>
          </div>
        </div>
      )}

      {/* AWAITING PAYPAL APPROVAL */}
      {hasOpenCheckout && !isFunded && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">Waiting for you to complete payment on PayPal.</p>
          <div className="flex flex-wrap gap-2">
            {order?.approve_url && (
              <Button asChild data-testid="funding-continue-cta">
                <a href={order.approve_url}>Continue to PayPal — {dollars(order.amount_minor)}</a>
              </Button>
            )}
            <Button variant="outline" onClick={retryCapture} disabled={busy} data-testid="funding-refresh-cta">
              I&apos;ve completed payment — check status
            </Button>
          </div>
        </div>
      )}

      {/* PENDING SERVER CAPTURE */}
      {pendingCapture && !isFunded && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">Your payment is being verified with PayPal. This usually only takes a moment.</p>
          <Button variant="outline" onClick={retryCapture} disabled={busy}>Check status</Button>
        </div>
      )}

      {/* FUNDED */}
      {isFunded && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="funding-state-funded">
          <StatCell label="Campaign Funded" value={dollars(summary.total_paid_usd_minor)} tone="ok" />
          <StatCell label="Spent" value={dollars(estimatedSpendMinor)} />
          <StatCell label="Remaining" value={dollars(remainingAfterSpend)} />
        </div>
      )}

      {/* LEGACY WAIVED */}
      {isLegacyWaived && !isFunded && (
        <div className="mt-4">
          <StatCell label="Legacy Campaign" value="Payment requirement waived" tone="ok" />
          <p className="mt-2 text-xs text-muted-foreground">
            This campaign was created before WaveLead introduced paid funding. It runs on legacy terms.
          </p>
        </div>
      )}

      {/* FAILED — retry */}
      {failed && !isFunded && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">The previous payment attempt failed. You can try again — a fresh PayPal order will be created.</p>
          <Button onClick={fundCampaign} disabled={busy} data-testid="fund-retry-cta">
            {busy ? 'Redirecting to PayPal…' : `Try Again — ${dollars(budgetMinor)}`}
          </Button>
        </div>
      )}

      {/* CANCELLED — allow new attempt */}
      {cancelled && !isFunded && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">The previous checkout was cancelled. You can start a new payment.</p>
          <Button onClick={fundCampaign} disabled={busy}>
            {busy ? 'Redirecting to PayPal…' : `Fund Campaign — ${dollars(budgetMinor)}`}
          </Button>
        </div>
      )}
    </section>
  );
}

function StatCell({ label, value, tone, testid }: { label: string; value: string; tone?: 'ok'; testid?: string }) {
  return (
    <div className={`rounded-md border p-3 ${tone === 'ok' ? 'border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900' : 'border-border bg-card'}`} data-testid={testid}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
