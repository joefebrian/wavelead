'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { ChannelRateCard, MarketplaceOrder, RateCardPackage, MarketplacePackageType, SponsorshipLead } from '@/lib/types';

const PKG_TYPES: { value: MarketplacePackageType; label: string }[] = [
  { value: 'sponsored_post', label: 'Sponsored Post' },
  { value: 'sponsored_post_pin', label: 'Sponsored Post + 24h Pin' },
  { value: 'multi_post', label: 'Multi-Post Package' },
  { value: 'custom_quote', label: 'Custom Quote (sales-assisted)' },
];

type DraftPackage = Omit<RateCardPackage, 'id' | 'created_at' | 'updated_at'>;

export default function MonetizationClient({
  channelId, channelName, channelSlug, isVerified, verificationStatus, initialCard, initialOrders, initialLeads = [],
}: { channelId: string; channelName: string; channelSlug: string; isVerified: boolean; verificationStatus: string | null; initialCard: ChannelRateCard | null; initialOrders: MarketplaceOrder[]; initialLeads?: SponsorshipLead[] }) {
  // M16 — three canonical surfaces. "Incoming Requests" = M15 sponsorship
  // leads for this channel. "Active Sponsorships" = marketplace bookings in
  // the WaveLead payment + delivery workflow. Never merged, never duplicated.
  const [tab, setTab] = useState<'ratecard' | 'incoming' | 'active'>('ratecard');
  const [packages, setPackages] = useState<DraftPackage[]>(() =>
    (initialCard?.packages || []).map(({ id: _id, created_at: _ca, updated_at: _ua, ...rest }) => { void _id; void _ca; void _ua; return rest; }));
  const [orders, setOrders] = useState<MarketplaceOrder[]>(initialOrders);
  const leads = initialLeads || [];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<Record<string, { notes: string; urls: string; evidenceUrl: string }>>({});

  function addPkg() {
    setPackages((p) => [...p, { type: 'sponsored_post', name: '', description: '', price_minor: 25000, currency: 'USD', deliverables: [], estimated_delivery_days: null, is_active: true }]);
  }
  function updatePkg(i: number, patch: Partial<DraftPackage>) {
    setPackages((p) => p.map((pk, ix) => (ix === i ? { ...pk, ...patch } : pk)));
  }
  function delPkg(i: number) { setPackages((p) => p.filter((_, ix) => ix !== i)); }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const cleaned = packages.map((p) => ({
        type: p.type, name: p.name.trim(), description: p.description.trim(),
        price_minor: p.type === 'custom_quote' ? null : (p.price_minor ?? 0),
        currency: 'USD', deliverables: p.deliverables.filter(Boolean),
        estimated_delivery_days: p.estimated_delivery_days ?? null,
        is_active: p.is_active,
      }));
      const r = await fetch(`/api/owner/channels/${channelId}/rate-card`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ packages: cleaned }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Save failed');
      setMsg({ ok: true, text: 'Rate card saved.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function doAction(orderId: string, action: 'accept' | 'reject' | 'start-work') {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: action === 'reject' ? JSON.stringify({ reason: 'Not a fit' }) : '{}',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Action failed');
      setOrders((prev) => prev.map((o) => (o.id === orderId ? j.data.order as MarketplaceOrder : o)));
      setMsg({ ok: true, text: `Order ${action.replace('-', ' ')}ed.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function submitDelivery(orderId: string) {
    // M16 — URL-based delivery evidence. WaveLead does NOT host evidence file
    // bytes: owners paste published content URLs and (optionally) a Google
    // Drive link for screenshots / supporting files.
    const draft = deliveryDraft[orderId] || { notes: '', urls: '', evidenceUrl: '' };
    const notes = draft.notes?.trim();
    const urlsRaw = (draft.urls || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const evidenceUrl = (draft.evidenceUrl || '').trim();
    if (urlsRaw.length === 0) {
      setMsg({ ok: false, text: 'Please add at least one published content URL (https://…).' }); return;
    }
    const bad = [...urlsRaw, ...(evidenceUrl ? [evidenceUrl] : [])].find((u) => !/^https:\/\/\S+$/i.test(u));
    if (bad) { setMsg({ ok: false, text: `Links must start with https:// — check: ${bad.slice(0, 60)}` }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/submit-delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          notes_to_brand: notes,
          delivery_urls: urlsRaw,
          proof_urls: evidenceUrl ? [evidenceUrl] : [],
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setOrders((prev) => prev.map((o) => (o.id === orderId ? j.data.order as MarketplaceOrder : o)));
      setDeliveryDraft((d) => { const n = { ...d }; delete n[orderId]; return n; });
      setMsg({ ok: true, text: 'Delivery submitted for brand review. WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function reportNoResponse(orderId: string) {
    if (busy) return;
    if (!confirm('Ask WaveLead to review this delivery because the brand has not responded within the review period?')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/report-no-response`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: '{}',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Escalation failed');
      setMsg({ ok: true, text: 'WaveLead has been notified. A moderator will review your submitted delivery.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!isVerified) {
    // M03.7 — canonical unverified condition: verification_status ∉ {'verified','official'}.
    // Covers 'claimed', 'unclaimed', null, undefined, and any legacy value.
    // We ALWAYS reach this block only after page.tsx has verified
    // `channel.owner_id === actor.user.id`, so the "linked to your account"
    // phrasing is always accurate.
    void channelName; void channelId; void verificationStatus;
    return (
      <div className="mt-6 wh-card p-5 border-amber-300 bg-amber-50/40" data-testid="ownership-verification-required">
        <div className="font-semibold">Ownership verification required</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your channel is linked to your WaveLead account, but ownership has not yet been verified. Complete verification to unlock the sponsorship marketplace.
        </p>
        <div className="mt-4">
          <a href={`/dashboard/channels/${channelId}/verify`} className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" data-testid="complete-verification-cta">
            Complete verification
          </a>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Choose Fast Verification ($1, no second manual review) or free Manual Verification reviewed by a moderator.</p>
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="owner-monetization">
      <div className="flex gap-2 border-b border-border pb-3 flex-wrap">
        <button className={tabClass(tab === 'ratecard')} onClick={() => setTab('ratecard')} data-testid="tab-rate-card">Rate Card</button>
        <button className={tabClass(tab === 'incoming')} onClick={() => setTab('incoming')} data-testid="tab-incoming-requests">Incoming Requests ({leads.length})</button>
        <button className={tabClass(tab === 'active')} onClick={() => setTab('active')} data-testid="tab-active-sponsorships">Active Sponsorships ({orders.length})</button>
      </div>

      {tab === 'ratecard' && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Brands pay WaveLead; you receive 90% of the applicable net (after gateway fee), WaveLead retains 10%.</p>
            <Button size="sm" onClick={addPkg}><Plus className="h-4 w-4 mr-1" />Add package</Button>
          </div>
          <div className="space-y-3">
            {packages.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No packages yet.</div>}
            {packages.map((p, i) => (
              <div key={i} className="wh-card p-4 grid md:grid-cols-2 gap-3">
                <label className="block text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Type</span>
                  <select value={p.type} onChange={(e) => updatePkg(i, { type: e.target.value as MarketplacePackageType })} className={inputCls}>
                    {PKG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select></label>
                <label className="block text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Name</span>
                  <input value={p.name} onChange={(e) => updatePkg(i, { name: e.target.value })} className={inputCls} /></label>
                <label className="block text-sm md:col-span-2"><span className="block text-xs uppercase text-muted-foreground mb-1">Description</span>
                  <textarea rows={2} value={p.description} onChange={(e) => updatePkg(i, { description: e.target.value })} className={inputCls} /></label>
                {p.type !== 'custom_quote' && (
                  <label className="block text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Price (USD)</span>
                    <input type="number" step={1} value={p.price_minor == null ? '' : (p.price_minor / 100).toString()} onChange={(e) => updatePkg(i, { price_minor: Math.round(Number(e.target.value) * 100) })} className={inputCls} /></label>
                )}
                <label className="block text-sm"><span className="block text-xs uppercase text-muted-foreground mb-1">Estimated delivery (days)</span>
                  <input type="number" step={1} value={p.estimated_delivery_days ?? ''} onChange={(e) => updatePkg(i, { estimated_delivery_days: e.target.value ? Number(e.target.value) : null })} className={inputCls} /></label>
                <div className="flex items-center gap-3 md:col-span-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.is_active} onChange={(e) => updatePkg(i, { is_active: e.target.checked })} /> Active (public)</label>
                  <Button variant="outline" size="sm" onClick={() => delPkg(i)} className="ml-auto text-rose-700"><Trash2 className="h-3.5 w-3.5 mr-1" />Remove</Button>
                </div>
              </div>
            ))}
          </div>
          {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</div>}
          <Button onClick={save} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Save rate card'}</Button>
          <p className="text-xs text-muted-foreground">Editing a package here does <span className="font-semibold">not</span> retroactively change any already-accepted order &mdash; the accepted order snapshot is immutable.</p>
        </div>
      )}

      {tab === 'incoming' && (
        <div className="mt-4 space-y-3" data-testid="channel-incoming-requests">
          <p className="text-sm text-muted-foreground">
            Sponsorship requests brands sent to this channel. These appear here immediately — before any payment or booking exists. Accept, decline or message the brand from the request page.
          </p>
          {leads.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center" data-testid="channel-incoming-empty">No incoming requests for this channel yet.</div>}
          {leads.map((l) => (
            <Link key={l.id} href={`/dashboard/sponsorship-requests/${l.id}`} className="wh-card p-4 block hover:border-primary/50" data-testid={`channel-incoming-request-${l.id}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{l.company_name}</div>
                  <div className="text-xs text-muted-foreground">Received {new Date(l.created_at).toLocaleString()}</div>
                </div>
                <Badge className={leadStatusStyle(l.status)}>{leadStatusLabel(l.status)}</Badge>
              </div>
              <div className="mt-2 text-sm text-muted-foreground line-clamp-3">{l.brief}</div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'active' && (
        <div className="mt-4 space-y-3" data-testid="channel-active-sponsorships">
          <p className="text-sm text-muted-foreground">
            Confirmed sponsorship bookings in the WaveLead payment and delivery workflow. WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed — you receive 90% of the applicable net, WaveLead retains 10%.
          </p>
          {orders.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center" data-testid="channel-active-empty">No active sponsorships for this channel yet.</div>}
          {orders.map((o) => (
            <div key={o.id} className="wh-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium">{o.brief.company_name}</div>
                  <div className="text-xs text-muted-foreground">{o.brief.contact_email} · requested {new Date(o.created_at).toLocaleString()}</div>
                </div>
                <Badge className={statusStyle(o.status)}>{o.status.replace('_', ' ')}</Badge>
              </div>
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">Package: </span>{o.package_type} · <span className="font-medium">${((o.snapshot?.gross_price_minor ?? o.quoted_price_minor ?? 0) / 100).toFixed(2)}</span>
                {typeof o.owner_earnings_minor === 'number' && (
                  <span className="ml-3">
                    <span className="text-muted-foreground">Your Earnings: </span><span className="font-semibold text-emerald-700">${(o.owner_earnings_minor / 100).toFixed(2)}</span>
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-muted-foreground line-clamp-3">{o.brief.brief}</div>
              {o.status === 'requested' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => doAction(o.id, 'accept')} disabled={busy}>Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => doAction(o.id, 'reject')} disabled={busy}>Reject</Button>
                </div>
              )}
              {(o.status === 'owner_accepted' || o.status === 'awaiting_payment') && (
                <div className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  <span className="font-medium">Awaiting brand payment</span>
                  <span className="block text-xs text-amber-900/80 mt-0.5">Once the brand completes payment, this order will be ready for you to start work.</span>
                </div>
              )}
              {o.status === 'paid' && o.economics_status === 'finalized' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => doAction(o.id, 'start-work')} disabled={busy}>Start Work</Button>
                </div>
              )}
              {o.status === 'paid' && o.economics_status !== 'finalized' && (
                <div className="mt-3 text-sm text-muted-foreground">Payment received. Awaiting fee reconciliation before you can start work.</div>
              )}
              {(o.status === 'in_progress' || o.status === 'revision_requested') && (
                <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                  {o.status === 'revision_requested' && (
                    <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                      <div className="text-xs uppercase tracking-wide font-semibold text-amber-800">Revision requested</div>
                      {o.revision_notes_latest && <div className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{o.revision_notes_latest}</div>}
                      <div className="mt-1 text-xs text-amber-800/80">Update your work and submit a new delivery below. Your prior submission is preserved in the history.</div>
                    </div>
                  )}
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    {o.status === 'revision_requested' ? 'Submit Revised Delivery' : 'Submit Delivery'}
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Published Content URL(s) <span className="text-rose-600">*</span></div>
                    <div className="text-xs text-muted-foreground mb-2">Paste the public https:// link(s) where the sponsored content was published — WhatsApp Channel content, social post, or other public campaign result. One per line.</div>
                    <textarea rows={3} placeholder={'https://whatsapp.com/channel/...\nhttps://...'} className={inputCls}
                      data-testid={`published-content-urls-${o.id}`}
                      value={deliveryDraft[o.id]?.urls || ''}
                      onChange={(e) => setDeliveryDraft((d) => ({ ...d, [o.id]: { notes: d[o.id]?.notes || '', urls: e.target.value, evidenceUrl: d[o.id]?.evidenceUrl || '' } }))} />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Evidence / Supporting Materials Link <span className="text-muted-foreground/70">(optional)</span></div>
                    <div className="text-xs text-muted-foreground mb-2">Need to share screenshots or supporting files? Upload them to Google Drive and paste a shareable link here.</div>
                    <input placeholder="https://drive.google.com/…" className={inputCls}
                      data-testid={`evidence-url-${o.id}`}
                      value={deliveryDraft[o.id]?.evidenceUrl || ''}
                      onChange={(e) => setDeliveryDraft((d) => ({ ...d, [o.id]: { notes: d[o.id]?.notes || '', urls: d[o.id]?.urls || '', evidenceUrl: e.target.value } }))} />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Notes to brand <span className="text-muted-foreground/70">(optional)</span></div>
                    <textarea rows={3} placeholder="Anything the brand should know — when it ran, results if any." className={inputCls}
                      value={deliveryDraft[o.id]?.notes || ''}
                      onChange={(e) => setDeliveryDraft((d) => ({ ...d, [o.id]: { notes: e.target.value, urls: d[o.id]?.urls || '', evidenceUrl: d[o.id]?.evidenceUrl || '' } }))} />
                  </div>
                  <Button size="sm" onClick={() => submitDelivery(o.id)} disabled={busy || !(deliveryDraft[o.id]?.urls || '').trim()} data-testid={`submit-delivery-${o.id}`}>
                    {o.status === 'revision_requested' ? 'Submit Revision' : 'Submit delivery for review'}
                  </Button>
                </div>
              )}
              {o.status === 'submitted_for_review' && (
                <div className="mt-3 space-y-2">
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs uppercase tracking-wide font-semibold text-primary">Delivery submitted</div>
                    <div className="mt-1 text-sm">The brand is reviewing your delivery.</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">Your earnings are protected by WaveLead while the delivery is under review. Payout eligibility begins after the brand accepts your delivery or WaveLead resolves an eligible delivery review in your favor.</div>
                  </div>
                  {isReviewOverdue(o) && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                      <div className="text-sm text-amber-900">The brand has not reviewed your submitted delivery within the review period.</div>
                      <div className="mt-2">
                        <Button size="sm" variant="outline" onClick={() => reportNoResponse(o.id)} disabled={busy}>Report No Response to WaveLead</Button>
                      </div>
                      <div className="mt-1 text-xs text-amber-800/80">This is not a payout request. A WaveLead moderator will review your submitted delivery.</div>
                    </div>
                  )}
                </div>
              )}
              {o.status === 'completed' && (
                <div className="mt-3 text-sm space-y-2">
                  {o.owner_payable_status === 'paid_out' ? (
                    <div>
                      <span className="text-emerald-700 font-medium">External payout completed — ${((o.owner_earnings_minor ?? 0) / 100).toFixed(2)}</span>
                      {o.paid_out_at && (
                        <span className="block text-xs text-muted-foreground mt-0.5">Paid at {new Date(o.paid_out_at).toLocaleString()}. Payout method and reference are on record with WaveLead.</span>
                      )}
                    </div>
                  ) : o.owner_payable_status === 'eligible_for_payout' ? (
                    (() => {
                      const availAtMs = o.payout_available_at ? new Date(o.payout_available_at as unknown as string).getTime() : 0;
                      const nowMs = Date.now();
                      const stillHeld = availAtMs > nowMs;
                      return (
                        <div>
                          {stillHeld ? (
                            <>
                              <span className="text-primary font-medium">Delivery completed — ${((o.owner_earnings_minor ?? 0) / 100).toFixed(2)}</span>
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                Your earnings are in the settlement period and will become available for payout on {new Date(availAtMs).toLocaleString()}.
                                {o.payout_requested_at && ' A payout has already been requested — WaveLead will complete the transfer externally.'}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-emerald-700 font-medium">Available for payout — ${((o.owner_earnings_minor ?? 0) / 100).toFixed(2)}</span>
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                {o.payout_requested_at ? 'A payout has been requested — WaveLead will coordinate the transfer externally.' : 'Head to your Earnings dashboard to request an external payout.'}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })()
                  ) : o.owner_payable_status === 'manual_reconciliation_required' ? (
                    <span className="text-amber-700 font-medium">Payout reconciliation required — contact WaveLead</span>
                  ) : (
                    <span className="text-muted-foreground">Completed. Payable status: {o.owner_payable_status}</span>
                  )}
                  <div>
                    <a href="/dashboard/earnings" className="inline-flex items-center gap-1 text-sm text-primary underline hover:no-underline">
                      View Earnings →
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
          {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</div>}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">Channel: <span className="font-mono">{channelName}</span></p>
    </div>
  );
}

const tabClass = (a: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`;
const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

// Client-side estimate of the review SLA — the server is authoritative.
// Keep in sync with MARKETPLACE_DELIVERY_REVIEW_HOURS (default 72h).
const REVIEW_SLA_HOURS_CLIENT = 72;
function isReviewOverdue(o: MarketplaceOrder): boolean {
  if (o.status !== 'submitted_for_review') return false;
  const ts = o.submitted_for_review_at || o.submitted_at;
  if (!ts) return false;
  const startedMs = new Date(ts as unknown as string).getTime();
  return (Date.now() - startedMs) >= REVIEW_SLA_HOURS_CLIENT * 3600 * 1000;
}

// M16 — incoming request (M15 sponsorship lead) presentation helpers.
function leadStatusLabel(s: SponsorshipLead['status']): string {
  if (s === 'new') return 'Awaiting your response';
  if (s === 'accepted_by_owner') return 'Accepted — awaiting brand payment';
  if (s === 'declined_by_owner') return 'Declined';
  if (s === 'won') return 'Booked';
  if (s === 'lost') return 'Closed';
  return 'In discussion';
}

function leadStatusStyle(s: SponsorshipLead['status']): string {
  if (s === 'new') return 'bg-sky-100 text-sky-800';
  if (s === 'accepted_by_owner' || s === 'won') return 'bg-emerald-100 text-emerald-800';
  if (s === 'declined_by_owner') return 'bg-rose-100 text-rose-800';
  if (s === 'lost') return 'bg-slate-200 text-slate-700';
  return 'bg-amber-100 text-amber-800';
}

function statusStyle(s: string): string {  if (s === 'paid' || s === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'in_progress') return 'bg-indigo-100 text-indigo-800';
  if (s === 'submitted_for_review') return 'bg-violet-100 text-violet-800';
  if (s === 'revision_requested') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
