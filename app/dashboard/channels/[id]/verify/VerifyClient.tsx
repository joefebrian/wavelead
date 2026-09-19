'use client';
// M17 — Fast ($1) + Manual (free) owner verification client.
//
// Payment alone never verifies: the server requires identity + declaration +
// payout before flipping the channel to Owner Verified.
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { COUNTRY_OPTIONS } from '@/lib/constants/countries';
import { ga4Track } from '@/components/analytics/GoogleAnalytics';

interface VState {
  step: string;
  listing_approved: boolean;
  fast_amount_minor: number;
  currency: string;
  requirements: { listing_approved: boolean; payment_finalized: boolean; identity_complete: boolean; declaration_accepted: boolean; payout_configured: boolean };
  verification_status: string | null;
  activation_status: string;
  approve_url?: string | null;
}

interface Identity {
  full_legal_name: string; country_code: string; city: string; email: string;
  mobile_number: string; role_in_channel: string; company_name: string | null;
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

export default function VerifyClient({
  channelId, initialState, initialIdentity, declarationText, channelSlug,
}: {
  channelId: string;
  initialState: VState | null;
  initialIdentity: Identity | null;
  declarationText: string;
  channelSlug: string;
}) {
  const [state, setState] = useState<VState | null>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payoutEmail, setPayoutEmail] = useState('');
  const [form, setForm] = useState({
    full_legal_name: initialIdentity?.full_legal_name || '',
    country_code: initialIdentity?.country_code || '',
    city: initialIdentity?.city || '',
    email: initialIdentity?.email || '',
    mobile_number: initialIdentity?.mobile_number || '',
    role_in_channel: initialIdentity?.role_in_channel || 'owner',
    company_name: initialIdentity?.company_name || '',
    declaration_accepted: false,
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/owner/channels/${channelId}/verification/state`, { credentials: 'include' });
      const j = await r.json();
      if (j?.data) setState(j.data as VState);
    } catch { /* keep previous state */ }
  }, [channelId]);

  // Browser return from PayPal → non-authoritative capture kick.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const pid = sp.get('activation');
    if (!pid || sp.get('status') !== 'paid') return;
    (async () => {
      setBusy('capture');
      try {
        await fetch(`/api/owner/channels/${channelId}/verification/capture`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_id: pid }),
        });
        ga4Track('fast_verification_payment_completed', { channel: channelSlug });
        await refresh();
      } catch { /* ignore */ } finally { setBusy(null); }
    })();
  }, [channelId, channelSlug, refresh]);

  async function startFast() {
    setBusy('pay'); setErr(null);
    try {
      const r = await fetch(`/api/owner/channels/${channelId}/verification/start-fast`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not start Fast Verification');
      ga4Track('fast_verification_started', { channel: channelSlug });
      const url = j.data?.payment?.approve_url;
      if (url) { window.location.href = url; return; }
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function savePayout() {
    setBusy('payout'); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/owner/payout-method', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'paypal', paypal_email: payoutEmail.trim(), confirm: true }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not save payout account');
      setMsg('Payout account saved.');
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function submitIdentity() {
    setBusy('identity'); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/owner/channels/${channelId}/verification/identity`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not save your owner information');
      ga4Track('owner_identity_completed', { channel: channelSlug });
      if (j.data?.verification?.verified) { ga4Track('owner_verified', { channel: channelSlug }); setMsg('Owner Verified — your channel is now active.'); }
      else setMsg('Owner information saved.');
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const req = state?.requirements;
  const verified = state?.step === 'verified';

  return (
    <div className="mt-6 space-y-6" data-testid="owner-verification">
      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex gap-2" data-testid="verify-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{err}
        </div>
      )}
      {msg && <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="verify-msg">{msg}</div>}

      {verified ? (
        <div className="wh-card p-6 border-emerald-300 bg-emerald-50/60" data-testid="verify-complete">
          <div className="inline-flex items-center gap-2 font-semibold text-emerald-900"><ShieldCheck className="h-5 w-5" /> Owner Verified</div>
          <p className="mt-1 text-sm text-emerald-900/80">Monetization and payouts are unlocked for this channel.</p>
          <div className="mt-3 flex gap-2">
            <Link href={`/dashboard/channels/${channelId}/monetization`}><Button size="sm">Open monetization</Button></Link>
          </div>
        </div>
      ) : (
        <>
          <div className="wh-card p-6" data-testid="fast-verification-card">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm font-semibold">Fast Verification</div>
                <div className="text-2xl font-bold mt-0.5">$1 one-time</div>
              </div>
              <Button onClick={startFast} disabled={!state?.listing_approved || busy !== null || !!req?.payment_finalized} data-testid="start-fast-verification">
                {busy === 'pay' ? <Loader2 className="h-4 w-4 animate-spin" /> : req?.payment_finalized ? 'Payment completed' : 'Start Fast Verification — $1'}
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Complete a one-time $1 Fast Verification, provide your owner information and payout details, and activate Owner Verified without waiting for a second manual review.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The $1 activation helps deter impersonation, spam and scam attempts while adding an accountability layer for channel owners.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm" data-testid="fast-requirements">
              <Step done={!!req?.listing_approved} label="Channel listing approved" />
              <Step done={!!req?.payment_finalized} label="$1 activation payment completed" />
              <Step done={!!req?.identity_complete} label="Owner information completed" />
              <Step done={!!req?.declaration_accepted} label="Owner declaration accepted" />
              <Step done={!!req?.payout_configured} label="Payout account configured" />
            </ul>
          </div>

          <div className="wh-card p-6" data-testid="owner-identity-form">
            <div className="text-sm font-semibold">Owner information</div>
            <p className="mt-1 text-xs text-muted-foreground">Private. Visible only to you and authorized WaveLead support — never shown on your public channel profile.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">Full legal name<input className={inputCls} value={form.full_legal_name} onChange={(e) => setForm({ ...form, full_legal_name: e.target.value })} data-testid="identity-name" /></label>
              <label className="text-sm">Country
                <select className={inputCls} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} data-testid="identity-country">
                  <option value="">Select a country</option>
                  {COUNTRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="text-sm">City<input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="identity-city" /></label>
              <label className="text-sm">Email<input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="identity-email" /></label>
              <label className="text-sm">Mobile / WhatsApp number<input className={inputCls} value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} data-testid="identity-mobile" /></label>
              <label className="text-sm">Role in channel
                <select className={inputCls} value={form.role_in_channel} onChange={(e) => setForm({ ...form, role_in_channel: e.target.value })} data-testid="identity-role">
                  <option value="owner">Owner</option>
                  <option value="manager">Manager</option>
                  <option value="authorized_representative">Authorized Representative</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">Company / Organization (optional)<input className={inputCls} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></label>
            </div>
            <label className="mt-4 flex gap-2 items-start text-sm">
              <input type="checkbox" className="mt-1" checked={form.declaration_accepted} onChange={(e) => setForm({ ...form, declaration_accepted: e.target.checked })} data-testid="owner-declaration" />
              <span>{declarationText}</span>
            </label>
            <Button className="mt-4" onClick={submitIdentity} disabled={busy !== null || !form.declaration_accepted} data-testid="submit-identity">
              {busy === 'identity' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save owner information'}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">We never ask for passport, national ID, bank password or any account password.</p>
          </div>

          <div className="wh-card p-6" data-testid="payout-setup">
            <div className="text-sm font-semibold">Payout account</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Where WaveLead sends your sponsorship earnings (owner receives 90% of the applicable net; WaveLead retains 10%). Private — we store only the payout destination, never your PayPal password or credentials.
            </p>
            <div className="mt-3 flex gap-2 flex-wrap items-end">
              <label className="text-sm flex-1 min-w-[240px]">PayPal payout email
                <input className={inputCls} value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} placeholder="you@example.com" data-testid="payout-email" />
              </label>
              <Button variant="outline" onClick={savePayout} disabled={busy !== null || !payoutEmail.trim()} data-testid="save-payout">
                {busy === 'payout' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save payout account'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Changing your payout destination later requires explicit reconfirmation.</p>
          </div>

          <div className="wh-card p-6" data-testid="manual-verification-card">
            <div className="text-sm font-semibold">Manual Verification</div>
            <div className="text-2xl font-bold mt-0.5">Free</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Prefer not to pay? Submit supporting website or social-media ownership evidence (Instagram, Facebook, TikTok, Threads, website) for WaveLead review. No $1 payment required.
            </p>
            <Link href={`/claim/${channelSlug}`} className="inline-block mt-3">
              <Button variant="outline" size="sm" data-testid="manual-verification-cta">Start Manual Verification — Free</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
      <span className={done ? '' : 'text-muted-foreground'}>{label}</span>
    </li>
  );
}
