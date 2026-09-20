// M18 — Admin → Campaigns. OVERSIGHT ONLY.
//
// There is no campaign approval gate: admins inspect and support, they do not
// gate a brand's campaign. Read-only view over the isolated brand_campaigns
// domain plus the committed value from real marketplace orders.
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { brandCampaignService } from '@/lib/services/brandCampaignService';
import { PageHeader, DataTable, EmptyState, StatusBadge, InfoBanner, StatCard, type Tone } from '@/components/appkit';

export const metadata: Metadata = { title: 'Admin · Campaigns', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Record<string, Tone> = {
  draft: 'neutral', open: 'success', in_selection: 'info', active: 'info', completed: 'neutral', cancelled: 'danger',
};
const usd = (m: number) => `$${(m / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export default async function AdminCampaignsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/campaigns');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return <section className="w-full"><h1 className="text-2xl font-bold">403 — Forbidden</h1></section>;
  }
  const rows = await brandCampaignService.adminOverview();
  const totalCommitted = rows.reduce((s, r) => s + r.committed_booking_value_minor, 0);

  return (
    <section className="w-full">
      <PageHeader title="Campaigns" description="Brand Launch Campaigns across WaveLead. Oversight only — no approval gate." />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Campaigns" value={rows.length} />
        <StatCard label="Open / in selection" value={rows.filter((r) => r.status === 'open' || r.status === 'in_selection').length} />
        <StatCard label="Committed booking value" value={usd(totalCommitted)} hint="From real marketplace orders" />
      </div>

      <div className="mb-4">
        <InfoBanner>
          Campaigns publish only after their 5% Campaign Commitment Deposit is captured. That deposit is campaign-linked
          funding (payment purpose CAMPAIGN_COMMITMENT_DEPOSIT), never WaveLead revenue and never the 10% marketplace fee.
          Booking obligations to creators still come only from
          marketplace orders, which keep Payment Protection and the 90% owner / 10% WaveLead split.
        </InfoBanner>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Brand campaigns appear here as soon as a brand creates one." />
      ) : (
        <DataTable head={['Campaign', 'Brand', 'Budget (plan)', 'Apps', 'Shortlisted', 'Approved', 'Bookings', 'Committed', 'Status', 'Created']} testId="admin-campaign-table">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className="px-3 py-2.5 font-medium">{r.name}</td>
              <td className="px-3 py-2.5 text-xs">{r.brand_name}</td>
              <td className="px-3 py-2.5 tabular-nums">{usd(r.budget_total_usd_minor)}</td>
              <td className="px-3 py-2.5 tabular-nums">{r.applications}</td>
              <td className="px-3 py-2.5 tabular-nums">{r.shortlisted}</td>
              <td className="px-3 py-2.5 tabular-nums">{r.approved}</td>
              <td className="px-3 py-2.5 tabular-nums">{r.marketplace_bookings}</td>
              <td className="px-3 py-2.5 tabular-nums">{usd(r.committed_booking_value_minor)}</td>
              <td className="px-3 py-2.5"><StatusBadge tone={TONE[r.status] || 'neutral'}>{r.status.replace(/_/g, ' ')}</StatusBadge></td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </section>
  );
}
