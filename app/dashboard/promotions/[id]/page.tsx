import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { promotionCampaignService } from '@/lib/services/promotion/campaignService';
import { promotionReportingService } from '@/lib/services/promotion/reportingService';
import { campaignFundingService } from '@/lib/services/payments/campaignFundingService';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import CampaignActions from './CampaignActions';
import FundingSection from './FundingSection';
import IdrEquivalentPanel from './IdrEquivalentPanel';

export const metadata: Metadata = { title: 'Campaign — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function dollars(minor: number | null | undefined): string { if (minor == null) return '—'; return `$${(minor / 100).toFixed(2)}`; }
function pct(v: number | null | undefined): string { if (v == null) return '—'; return `${v}%`; }

interface Params { id: string; }

export default async function PromotionDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/promotions/${id}`);
  let camp; try { camp = await promotionCampaignService.getForOwner(actor, id); } catch { notFound(); }
  const report = await promotionReportingService.forOwner(actor, id);
  const o = report.overall;
  const fundingSummary = await campaignFundingService.fundingSummary(camp.id);
  const fundingOrders = await paymentFundingOrderRepo.listForCampaign(camp.id);
  const latestOrder = fundingOrders[0] || null;
  // Sanitize funding order for the client — never leak provider-internal
  // metadata such as raw PayPal responses.
  const latestOrderPublic = latestOrder ? {
    id: latestOrder.id,
    status: latestOrder.status,
    amount_minor: latestOrder.amount_minor,
    amount_captured_minor: latestOrder.amount_captured_minor,
    amount_refunded_minor: latestOrder.amount_refunded_minor,
    currency: latestOrder.currency,
    approve_url: latestOrder.approve_url,
    provider_order_id: latestOrder.provider_order_id,
    created_at: latestOrder.created_at instanceof Date ? latestOrder.created_at.toISOString() : String(latestOrder.created_at),
  } : null;

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <Link href="/dashboard/promotions" className="text-sm text-muted-foreground hover:text-foreground">← All promotions</Link>
        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{camp.name}</h1>
            <div className="mt-1 flex items-center gap-2"><Badge>{camp.status.replace('_', ' ')}</Badge><span className="text-sm text-muted-foreground">Objective: {camp.objective === 'visibility' ? 'Increase Visibility' : 'Drive Follow Intent'}</span></div>
          </div>
          <CampaignActions id={camp.id} status={camp.status} />
        </div>

        <FundingSection
          campaignId={camp.id}
          campaignStatus={camp.status}
          budgetMinor={camp.budget_total_usd_minor}
          estimatedSpendMinor={camp.estimated_spend_usd_minor}
          initialSummary={fundingSummary}
          latestOrder={latestOrderPublic}
        />

        <IdrEquivalentPanel campaignId={camp.id} />

        <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Sponsored impressions" value={o.sponsored_impressions.toLocaleString()} />
          <Kpi label="Sponsored profile views" value={o.sponsored_profile_views.toLocaleString()} />
          <Kpi label="Follow clicks" value={o.follow_clicks.toLocaleString()} />
          <Kpi label="Unique follow intent" value={o.unique_follow_intents.toLocaleString()} />
          <Kpi label="Profile CTR" value={pct(o.profile_ctr_pct)} />
          <Kpi label="Follow intent rate" value={pct(o.follow_intent_rate_pct)} />
          <Kpi label="Est. spend" value={dollars(camp.estimated_spend_usd_minor)} />
          <Kpi label="Cost / UFI" value={dollars(o.cost_per_unique_follow_intent_usd_minor)} />
        </section>

        <section className="mt-8 wh-card p-5">
          <div className="font-semibold">Placement performance</div>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground text-left"><th className="py-1">Placement</th><th>Impr.</th><th>Views</th><th>UFI</th><th>CTR</th><th>Spend</th></tr></thead>
            <tbody>
              {camp.placements.map((p) => {
                const r = report.by_placement[p];
                return (
                  <tr key={p} className="border-t">
                    <td className="py-1.5">{p.replace('sponsored_', '').replace('_', ' ')}</td>
                    <td>{r?.sponsored_impressions ?? 0}</td>
                    <td>{r?.sponsored_profile_views ?? 0}</td>
                    <td>{r?.unique_follow_intents ?? 0}</td>
                    <td>{pct(r?.profile_ctr_pct)}</td>
                    <td>{dollars(r?.estimated_spend_usd_minor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="mt-8 wh-card p-5 text-sm space-y-2">
          <div className="font-semibold">Campaign</div>
          <div><span className="text-muted-foreground">Budget:</span> {dollars(camp.budget_total_usd_minor)} total — remaining {dollars(camp.budget_total_usd_minor - camp.estimated_spend_usd_minor)}</div>
          <div><span className="text-muted-foreground">Schedule:</span> {new Date(camp.start_at).toLocaleString()} → {new Date(camp.end_at).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Countries:</span> {camp.targeting.countries.join(', ') || 'Any'}</div>
          <div><span className="text-muted-foreground">Languages:</span> {camp.targeting.languages.join(', ').toUpperCase() || 'Any'}</div>
          <div><span className="text-muted-foreground">Categories:</span> {camp.targeting.categories.join(', ') || 'Any'}</div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="wh-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}
