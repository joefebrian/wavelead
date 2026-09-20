'use client';
// M18 — Brand campaign workspace: overview, applicants, approved creators.
//
// CRITICAL: shortlisting, rejecting and APPROVING never charge PayPal, never
// create a payment and never start delivery. An approved applicant only gains
// a "Continue to Booking" action, which reuses the EXISTING marketplace
// booking + Payment Protection + 90/10 payout flow.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionCard, StatCard, EmptyState, StatusBadge, DataTable, InfoBanner, fieldClass, type Tone } from '@/components/appkit';
import { Loader2, Users } from 'lucide-react';

interface Application {
  id: string; status: string; pitch: string; proposed_rate_usd_minor: number | null;
  audience_note: string | null; message_to_brand: string | null; materials_url: string | null;
  created_at: string; marketplace_order_id: string | null;
  channel: { id: string; slug: string; name: string; country_code: string; follower_count: number; public_followers_count: number | null; verification_status: string } | null;
}
interface Campaign {
  id: string; name: string; brand_name: string; objective: string; brief: string; status: string;
  budget_total_usd_minor: number; application_deadline: string | null;
  budget_history: Array<{ previous_budget_usd_minor: number; new_budget_usd_minor: number; changed_at: string; reason: string | null }>;
}

const TONE: Record<string, Tone> = { applied: 'neutral', shortlisted: 'info', approved: 'success', rejected: 'danger', withdrawn: 'neutral' };
const usd = (m: number | null) => (m === null ? '—' : `$${(m / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

export default function CampaignDetailClient({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [committed, setCommitted] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [budget, setBudget] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/brand/campaigns/${campaignId}`, { credentials: 'include' });
    const j = await r.json();
    if (j?.data?.campaign) {
      setCampaign(j.data.campaign);
      setApps(j.data.applications || []);
      setCommitted(j.data.committed_booking_value_minor || 0);
      setBudget(((j.data.campaign.budget_total_usd_minor || 0) / 100).toString());
    } else {
      setErr(typeof j?.error === 'string' ? j.error : 'Campaign not found');
    }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);

  async function call(url: string, label: string) {
    setBusy(label); setErr(null); setMsg(null);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Action failed');
      await load();
      return j.data;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(null); }
  }

  async function saveBudget() {
    setBusy('budget'); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/brand/campaigns/${campaignId}/budget`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget_total_usd_minor: Math.round(Number(budget || '0') * 100) }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not update the budget');
      setMsg('Budget updated. This is planning information only — no funds moved.');
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function continueToBooking(appId: string) {
    const data = await call(`/api/brand/campaign-applications/${appId}/continue-to-booking`, `booking-${appId}`);
    if (data?.booking_url) window.location.href = data.booking_url as string;
  }

  if (!campaign) {
    return <div className="text-sm text-muted-foreground">{err || 'Loading campaign…'}</div>;
  }

  const approved = apps.filter((a) => a.status === 'approved');

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaign.brand_name} · ${campaign.objective}`}
        breadcrumb={{ href: '/dashboard/campaigns', label: 'Campaigns' }}
        actions={campaign.status === 'draft'
          ? <Button onClick={() => call(`/api/brand/campaigns/${campaignId}/open`, 'open')} disabled={busy === 'open'} data-testid="open-campaign">
              {busy === 'open' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Open for applications
            </Button>
          : <StatusBadge tone="info" testId="campaign-status">{campaign.status.replace(/_/g, ' ')}</StatusBadge>}
      />

      {err && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="campaign-error">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={apps.length} />
        <StatCard label="Shortlisted" value={apps.filter((a) => a.status === 'shortlisted').length} />
        <StatCard label="Approved" value={approved.length} />
        <StatCard label="Committed bookings" value={usd(committed)} hint="Existing marketplace orders" testId="committed-value" />
      </div>

      <SectionCard title="Campaign budget" description="Planning and display only — no deposit, no escrow, no wallet." className="mb-5" testId="budget-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Total campaign budget (USD)
            <input className={fieldClass} value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="budget-input" />
          </label>
          <Button variant="outline" onClick={saveBudget} disabled={busy === 'budget'} data-testid="save-budget">Update budget</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The budget cannot be set below {usd(committed)} already committed through marketplace bookings for this campaign.
        </p>
        {campaign.budget_history?.length > 0 && (
          <div className="mt-4" data-testid="budget-history">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget history</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {campaign.budget_history.map((h, i) => (
                <li key={i}>{new Date(h.changed_at).toLocaleString()} — {usd(h.previous_budget_usd_minor)} → {usd(h.new_budget_usd_minor)}{h.reason ? ` (${h.reason})` : ''}</li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <div className="mb-4">
        <InfoBanner testId="approval-no-payment-notice">
          Approving a creator does not charge anything. When you are ready, use <strong>Continue to Booking</strong> to create the
          booking in the normal marketplace flow — Payment Protection, delivery, revisions and the 90% owner / 10% WaveLead split all apply there.
        </InfoBanner>
      </div>

      <SectionCard title="Applicants" description="Shortlist, approve or reject. No WaveLead admin approval is involved." testId="applicants-card">
        {apps.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No applications yet" description="Open campaigns appear under Campaign Opportunities for eligible channel owners." />
        ) : (
          <DataTable head={['Channel', 'Audience', 'Proposed rate', 'Status', 'Actions']} testId="applicants-table">
            {apps.map((a) => (
              <tr key={a.id} className="align-top hover:bg-muted/40" data-testid={`applicant-${a.id}`}>
                <td className="px-3 py-2.5">
                  <div className="font-medium">{a.channel?.name || 'Channel'}</div>
                  <div className="text-xs text-muted-foreground">{a.channel?.country_code} · {a.channel?.verification_status}</div>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">{a.pitch}</p>
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums">{(a.channel?.public_followers_count ?? a.channel?.follower_count ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 tabular-nums">{usd(a.proposed_rate_usd_minor)}</td>
                <td className="px-3 py-2.5"><StatusBadge tone={TONE[a.status] || 'neutral'}>{a.status}</StatusBadge></td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {a.status !== 'approved' && a.status !== 'withdrawn' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => call(`/api/brand/campaign-applications/${a.id}/shortlist`, `s-${a.id}`)} data-testid={`shortlist-${a.id}`}>Shortlist</Button>
                        <Button size="sm" onClick={() => call(`/api/brand/campaign-applications/${a.id}/approve`, `a-${a.id}`)} data-testid={`approve-${a.id}`}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => call(`/api/brand/campaign-applications/${a.id}/reject`, `r-${a.id}`)} data-testid={`reject-${a.id}`}>Reject</Button>
                      </>
                    )}
                    {a.status === 'approved' && (
                      <Button size="sm" onClick={() => continueToBooking(a.id)} disabled={busy === `booking-${a.id}`} data-testid={`continue-to-booking-${a.id}`}>
                        {a.marketplace_order_id ? 'Open existing booking' : 'Continue to Booking'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </>
  );
}
