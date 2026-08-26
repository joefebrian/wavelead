'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { ChannelRateCard, MarketplaceOrder, RateCardPackage, MarketplacePackageType } from '@/lib/types';

const PKG_TYPES: { value: MarketplacePackageType; label: string }[] = [
  { value: 'sponsored_post', label: 'Sponsored Post' },
  { value: 'sponsored_post_pin', label: 'Sponsored Post + 24h Pin' },
  { value: 'multi_post', label: 'Multi-Post Package' },
  { value: 'custom_quote', label: 'Custom Quote (sales-assisted)' },
];

type DraftPackage = Omit<RateCardPackage, 'id' | 'created_at' | 'updated_at'>;

export default function MonetizationClient({
  channelId, channelName, isVerified, initialCard, initialOrders,
}: { channelId: string; channelName: string; isVerified: boolean; initialCard: ChannelRateCard | null; initialOrders: MarketplaceOrder[] }) {
  const [tab, setTab] = useState<'ratecard' | 'requests'>('ratecard');
  const [packages, setPackages] = useState<DraftPackage[]>(() =>
    (initialCard?.packages || []).map(({ id: _id, created_at: _ca, updated_at: _ua, ...rest }) => { void _id; void _ca; void _ua; return rest; }));
  const [orders, setOrders] = useState<MarketplaceOrder[]>(initialOrders);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<null | { ok: boolean; text: string }>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<Record<string, { notes: string; urls: string }>>({});

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
    const notes = deliveryDraft[orderId]?.notes?.trim();
    const urlsRaw = (deliveryDraft[orderId]?.urls || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!notes) { setMsg({ ok: false, text: 'Please add delivery notes.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/marketplace/orders/${orderId}/submit-delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ delivery_notes: notes, delivery_urls: urlsRaw }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Submission failed');
      setOrders((prev) => prev.map((o) => (o.id === orderId ? j.data.order as MarketplaceOrder : o)));
      setDeliveryDraft((d) => { const n = { ...d }; delete n[orderId]; return n; });
      setMsg({ ok: true, text: 'Delivery submitted for buyer review.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!isVerified) {
    return (
      <div className="mt-6 wh-card p-5 border-amber-300 bg-amber-50/40">
        <div className="font-semibold">Sponsorship marketplace requires verification</div>
        <p className="mt-1 text-sm text-muted-foreground">Only verified channels can publish a sellable rate card. Complete verification first, then return here.</p>
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="owner-monetization">
      <div className="flex gap-2 border-b border-border pb-3">
        <button className={tabClass(tab === 'ratecard')} onClick={() => setTab('ratecard')}>Rate Card</button>
        <button className={tabClass(tab === 'requests')} onClick={() => setTab('requests')}>Sponsorship Requests ({orders.length})</button>
      </div>

      {tab === 'ratecard' && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Buyers pay WaveLead; you receive 90% of net (after gateway fee).</p>
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

      {tab === 'requests' && (
        <div className="mt-4 space-y-3">
          {orders.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No sponsorship requests yet.</div>}
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
              </div>
              <div className="mt-1 text-sm text-muted-foreground line-clamp-3">{o.brief.brief}</div>
              {o.status === 'requested' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => doAction(o.id, 'accept')} disabled={busy}>Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => doAction(o.id, 'reject')} disabled={busy}>Reject</Button>
                </div>
              )}
              {o.status === 'paid' && o.economics_status === 'finalized' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => doAction(o.id, 'start-work')} disabled={busy}>Start Work</Button>
                </div>
              )}
              {o.status === 'in_progress' && (
                <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Submit Delivery</div>
                  <textarea rows={3} placeholder="Delivery notes — what you did, when it ran, results if any." className={inputCls}
                    value={deliveryDraft[o.id]?.notes || ''}
                    onChange={(e) => setDeliveryDraft((d) => ({ ...d, [o.id]: { notes: e.target.value, urls: d[o.id]?.urls || '' } }))} />
                  <input placeholder="Proof URLs (one per line, http/https only)" className={inputCls}
                    value={deliveryDraft[o.id]?.urls || ''}
                    onChange={(e) => setDeliveryDraft((d) => ({ ...d, [o.id]: { notes: d[o.id]?.notes || '', urls: e.target.value } }))} />
                  <Button size="sm" onClick={() => submitDelivery(o.id)} disabled={busy}>Submit delivery for review</Button>
                </div>
              )}
              {o.status === 'submitted_for_review' && (
                <div className="mt-3 text-sm text-muted-foreground">Awaiting buyer review — you&apos;ll be notified when accepted.</div>
              )}
              {o.status === 'completed' && (
                <div className="mt-3 text-sm">
                  {o.owner_payable_status === 'paid_out' ? (
                    <span className="text-emerald-700 font-medium">Paid — ${((o.owner_earnings_minor ?? 0) / 100).toFixed(2)} received {o.paid_out_at ? `on ${new Date(o.paid_out_at).toLocaleDateString()}` : ''}</span>
                  ) : o.owner_payable_status === 'eligible_for_payout' ? (
                    <span className="text-emerald-700 font-medium">Eligible for payout — ${((o.owner_earnings_minor ?? 0) / 100).toFixed(2)} pending WaveLead disbursement</span>
                  ) : o.owner_payable_status === 'manual_reconciliation_required' ? (
                    <span className="text-amber-700 font-medium">Payout reconciliation required — contact WaveLead</span>
                  ) : (
                    <span className="text-muted-foreground">Completed. Payable status: {o.owner_payable_status}</span>
                  )}
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
function statusStyle(s: string): string {
  if (s === 'paid' || s === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (s === 'awaiting_payment') return 'bg-amber-100 text-amber-800';
  if (s === 'owner_accepted') return 'bg-sky-100 text-sky-800';
  if (s === 'in_progress') return 'bg-indigo-100 text-indigo-800';
  if (s === 'submitted_for_review') return 'bg-violet-100 text-violet-800';
  if (s === 'owner_rejected' || s === 'cancelled') return 'bg-slate-200 text-slate-700';
  return 'bg-primary/10 text-primary';
}
