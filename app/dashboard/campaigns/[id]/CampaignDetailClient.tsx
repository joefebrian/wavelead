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
  channel: {
    id: string; slug: string; name: string; logo_url: string | null;
    country_code: string; category_id: string | null; category_name: string | null;
    follower_count: number; public_followers_count: number | null; verification_status: string;
    profile_url: string;
    has_rate_card: boolean; rate_card_packages: number; rate_card_url: string | null;
    has_sample_work: boolean; sample_work_count: number; sample_work_url: string | null;
  } | null;
}
interface Campaign {
  id: string; name: string; brand_name: string; objective: string; brief: string; status: string;
  budget_total_usd_minor: number; application_deadline: string | null;
  budget_history: Array<{ previous_budget_usd_minor: number; new_budget_usd_minor: number; changed_at: string; reason: string | null }>;
  // M19 — set when a provider refund/reversal left the deposit short.
  commitment_issue_state?: string | null; commitment_issue_shortfall_minor?: number;
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
  // M19 — Campaign Commitment Deposit (5%). Server-authoritative: this UI only
  // displays what /commitment returns and never computes the requirement.
  const [commitment, setCommitment] = useState<{
    commitment_percent: number; required_commitment_minor: number; paid_commitment_minor: number;
    topup_required_minor: number; excess_commitment_minor: number; funded: boolean;
    funded_campaign_capacity_minor: number; committed_booking_value_minor: number;
    available_funded_capacity_minor: number; campaign_budget_usd_minor: number;
  } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/brand/campaigns/${campaignId}`, { credentials: 'include' });
    const j = await r.json();
    if (j?.data?.campaign) {
      setCampaign(j.data.campaign);
      setApps(j.data.applications || []);
      setCommitted(j.data.committed_booking_value_minor || 0);
      setBudget(((j.data.campaign.budget_total_usd_minor || 0) / 100).toString());
      try {
        const cr = await fetch(`/api/brand/campaigns/${campaignId}/commitment`, { credentials: 'include' }).then((r) => r.json());
        if (cr?.data?.commitment) setCommitment(cr.data.commitment);
      } catch { /* display only */ }
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

  // Provider return → ALWAYS re-verify with the server. The browser return by
  // itself never unlocks the campaign.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cid = sp.get('commitment');
    if (!cid || sp.get('status') !== 'paid') return;
    (async () => {
      try {
        await fetch(`/api/brand/campaigns/${campaignId}/commitment/${cid}`, { method: 'POST', credentials: 'include' });
      } finally {
        window.history.replaceState({}, '', `/dashboard/campaigns/${campaignId}`);
        load();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function fundCommitment() {
    setBusy('commitment'); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/brand/campaigns/${campaignId}/commitment`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not start the commitment deposit');
      const url = j.data?.commitment?.approve_url;
      if (!url) throw new Error('The payment provider did not return an approval link');
      window.location.href = url;
    } catch (e) { setErr((e as Error).message); setBusy(null); }
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
          ? <Button onClick={() => call(`/api/brand/campaigns/${campaignId}/open`, 'open')} disabled={busy === 'open' || !!(commitment && !commitment.funded)} data-testid="open-campaign">
              {busy === 'open' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Open for applications
            </Button>
          : <StatusBadge tone="info" testId="campaign-status">{campaign.status.replace(/_/g, ' ')}</StatusBadge>}
      />

      {err && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="campaign-error">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</div>}

      {campaign.commitment_issue_state && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="commitment-issue-banner">
          Your Campaign Commitment Deposit was refunded or reversed and is now short by{' '}
          <strong>{usd(campaign.commitment_issue_shortfall_minor ?? 0)}</strong>. Existing bookings, payouts and Payment
          Protection are unaffected, but this campaign is hidden from Campaign Opportunities and no new booking can be
          created until the deposit is restored below.
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={apps.length} />
        <StatCard label="Shortlisted" value={apps.filter((a) => a.status === 'shortlisted').length} />
        <StatCard label="Approved" value={approved.length} />
        <StatCard label="Committed bookings" value={usd(committed)} hint="Existing marketplace orders" testId="committed-value" />
      </div>

      <SectionCard
        title="Campaign Commitment Deposit"
        description="Payment Protection for creators: 5% of your campaign budget is funded up front before your campaign is visible to them."
        className="mb-5" testId="commitment-card">
        {commitment ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label={`Required (${commitment.commitment_percent}% of budget)`} value={usd(commitment.required_commitment_minor)} />
              <StatCard label="Paid" value={usd(commitment.paid_commitment_minor)} />
              <StatCard label="Top-up required" value={usd(commitment.topup_required_minor)} />
            </div>
            {commitment.excess_commitment_minor > 0 && (
              <p className="mt-3 text-sm text-muted-foreground" data-testid="commitment-excess">
                Excess commitment of {usd(commitment.excess_commitment_minor)} is held as a campaign-linked credit after your
                budget decrease. It is not a WaveLead fee and is not recognised as revenue — contact support for credit or refund options.
              </p>
            )}
            {commitment.topup_required_minor > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={fundCommitment} disabled={busy === 'commitment'} data-testid="fund-commitment">
                  {busy === 'commitment' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Fund {usd(commitment.topup_required_minor)} Campaign Commitment Deposit
                </Button>
                <span className="text-xs text-muted-foreground">
                  {commitment.paid_commitment_minor > 0
                    ? 'Top-up required after your budget increase. Until it is captured, new bookings are limited to your currently funded campaign capacity below.'
                    : 'Your campaign becomes visible to creators once this is successfully captured.'}
                </span>
              </div>
            ) : (
              <p className="mt-4 text-sm text-emerald-700" data-testid="commitment-funded">
                Commitment deposit funded. This deposit is campaign-linked funding, not a WaveLead fee, and is separate from the
                10% marketplace fee on any booking you later make.
              </p>
            )}

            {/* M19 D7 — truthful funded-capacity picture. */}
            <div className="mt-5 rounded-md border border-border bg-muted/40 p-4" data-testid="funded-capacity">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funded campaign capacity</div>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>Campaign budget: <strong>{usd(commitment.campaign_budget_usd_minor)}</strong></div>
                <div>Required commitment ({commitment.commitment_percent}%): <strong>{usd(commitment.required_commitment_minor)}</strong></div>
                <div>Commitment paid: <strong>{usd(commitment.paid_commitment_minor)}</strong></div>
                <div>Commitment shortfall: <strong data-testid="capacity-shortfall">{usd(commitment.topup_required_minor)}</strong></div>
                <div>Currently funded capacity: <strong data-testid="capacity-funded">{usd(commitment.funded_campaign_capacity_minor)}</strong></div>
                <div>Committed creator bookings: <strong>{usd(commitment.committed_booking_value_minor)}</strong></div>
                <div className="lg:col-span-3">Available funded capacity: <strong data-testid="capacity-available">{usd(commitment.available_funded_capacity_minor)}</strong></div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Shortlisting, rejecting and approving a creator never move money. The financial gate happens when a NEW
                marketplace booking is created: committed bookings plus the new booking must fit inside your funded campaign
                capacity, which is the part of your budget actually backed by the captured commitment deposit.
              </p>
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">Loading commitment status…</p>}
      </SectionCard>

      <SectionCard title="Campaign budget" description="Sets your required Campaign Commitment Deposit (5%). Bookings remain the only financial obligation to creators." className="mb-5" testId="budget-card">
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
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={campaign.status === 'open' || campaign.status === 'in_selection'
              ? 'Your campaign is live. Applications will appear here as creators apply.'
              : 'No applications yet'}
            description="Open campaigns appear under Campaign Opportunities for eligible channel owners."
          />
        ) : (
          <DataTable head={['Channel', 'Audience', 'Proposed rate', 'Applied', 'Materials', 'Status', 'Actions']} testId="applicants-table">
            {apps.map((a) => (
              <tr key={a.id} className="align-top hover:bg-muted/40" data-testid={`applicant-${a.id}`}>
                <td className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    {a.channel?.logo_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={a.channel.logo_url} alt="" className="mt-0.5 h-8 w-8 rounded-full border border-border object-cover"
                        data-testid={`applicant-avatar-${a.id}`} />
                    ) : (
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold"
                        data-testid={`applicant-avatar-${a.id}`}>
                        {(a.channel?.name || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="font-medium">
                        {a.channel?.profile_url
                          ? <a className="underline-offset-2 hover:underline" href={a.channel.profile_url} target="_blank" rel="noreferrer" data-testid={`view-channel-${a.id}`}>{a.channel.name}</a>
                          : 'Channel'}
                      </div>
                      <div className="text-xs text-muted-foreground" data-testid={`applicant-meta-${a.id}`}>
                        {a.channel?.country_code} · {a.channel?.category_name || 'Uncategorised'} · {a.channel?.verification_status}
                      </div>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{a.pitch}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs tabular-nums" data-testid={`applicant-followers-${a.id}`}>{(a.channel?.public_followers_count ?? a.channel?.follower_count ?? 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 tabular-nums">{usd(a.proposed_rate_usd_minor)}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground" data-testid={`applicant-date-${a.id}`}>{new Date(a.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2.5 text-xs">
                  <div className="flex flex-col gap-1">
                    {a.channel?.has_rate_card
                      ? <a className="text-primary underline-offset-2 hover:underline" href={a.channel.rate_card_url!} target="_blank" rel="noreferrer" data-testid={`view-rate-card-${a.id}`}>Rate card ({a.channel.rate_card_packages})</a>
                      : <span className="text-muted-foreground" data-testid={`no-rate-card-${a.id}`}>No rate card</span>}
                    {a.channel?.has_sample_work
                      ? <a className="text-primary underline-offset-2 hover:underline" href={a.channel.sample_work_url!} target="_blank" rel="noreferrer" data-testid={`view-sample-work-${a.id}`}>Sample work ({a.channel.sample_work_count})</a>
                      : <span className="text-muted-foreground" data-testid={`no-sample-work-${a.id}`}>No sample work</span>}
                    {a.materials_url && <a className="text-primary underline-offset-2 hover:underline" href={a.materials_url} target="_blank" rel="noreferrer">Applicant link</a>}
                  </div>
                </td>
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
