'use client';
// M17.1 — FAST VERIFICATION ($1) — step 1 of the paid path.
//
// The paid path deliberately asks for NO social-media or website ownership
// evidence and requires NO second human ownership approval.
// Prerequisites are: approved listing + eligible submitter/claimant + owner
// identity + declaration + payout destination + authoritative $1 capture.
//
// This component collects the identity, payout destination and declaration and
// then hands the user to the EXISTING Owner Activation PayPal checkout.
// It never captures a payment and never flips verification itself.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, ArrowLeft, ShieldCheck } from 'lucide-react';
import CountryCombobox from '@/components/forms/CountryCombobox';
import { ga4Track } from '@/components/analytics/GoogleAnalytics';

export interface IdentityForm {
  full_legal_name: string;
  country_code: string;
  city: string;
  email: string;
  mobile_number: string;
  role_in_channel: string;
  company_name: string;
  declaration_accepted: boolean;
}

const inputCls = 'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

export const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'authorized_representative', label: 'Authorized Representative' },
];

export function identityIncompleteReason(f: IdentityForm): string | null {
  if (f.full_legal_name.trim().length < 3) return 'Enter your full legal name.';
  if (!f.country_code) return 'Select your country.';
  if (f.city.trim().length < 2) return 'Enter your city.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Enter a valid email address.';
  if (f.mobile_number.trim().length < 6) return 'Enter your mobile / WhatsApp number.';
  if (!f.role_in_channel) return 'Select your role in the channel.';
  return null;
}

export default function FastVerificationForm({
  channelId, channelSlug, listingApproved, payoutConfigured, paymentFinalized,
  declarationText, initialForm, onBack, onRefresh,
}: {
  channelId: string;
  channelSlug: string;
  /** M18.1: eligibility (NOT listing approval) — fast path starts pre-moderation. */
  listingApproved: boolean;
  payoutConfigured: boolean;
  paymentFinalized: boolean;
  declarationText: string;
  initialForm: IdentityForm;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<IdentityForm>(initialForm);
  const [payoutEmail, setPayoutEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const needsPayout = !payoutConfigured;
  const blocker = identityIncompleteReason(form)
    || (!form.declaration_accepted ? 'Please accept the owner declaration.' : null)
    || (needsPayout && !payoutEmail.trim() ? 'Add the PayPal email where WaveLead should send your earnings.' : null);

  // Saves identity + payout, then opens the EXISTING $1 Owner Activation
  // checkout. Payment is authorized by the user on PayPal — never here.
  async function continueToPayment() {
    if (busy) return;
    setErr(null); setMsg(null);
    if (blocker) { setErr(blocker); return; }
    setBusy(true);
    try {
      if (needsPayout && payoutEmail.trim()) {
        const rp = await fetch('/api/owner/payout-method', {
          method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'paypal', paypal_email: payoutEmail.trim(), confirm: true }),
        });
        const jp = await rp.json();
        if (!rp.ok || !jp?.ok) throw new Error(typeof jp?.error === 'string' ? jp.error : 'Could not save your payout account');
      }
      const ri = await fetch(`/api/owner/channels/${channelId}/verification/identity`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, company_name: form.company_name || '' }),
      });
      const ji = await ri.json();
      if (!ri.ok || !ji?.ok) throw new Error(typeof ji?.error === 'string' ? ji.error : 'Could not save your owner information');
      ga4Track('owner_identity_completed', { channel: channelSlug });

      // Already paid (e.g. resumed flow) — identity submission finalizes
      // server-side, so just refresh.
      if (paymentFinalized) {
        await onRefresh();
        setMsg('Owner information saved. Verification finalizing…');
        return;
      }

      const rs = await fetch(`/api/owner/channels/${channelId}/verification/start-fast`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const js = await rs.json();
      if (!rs.ok || !js?.ok) throw new Error(typeof js?.error === 'string' ? js.error : 'Could not start the $1 verification payment');
      ga4Track('fast_verification_started', { channel: channelSlug });
      const url = js.data?.payment?.approve_url as string | undefined;
      if (url) { window.location.href = url; return; }   // PayPal approval — user authorizes
      await onRefresh();
      setMsg('Owner information saved.');
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 space-y-4" data-testid="fast-verification-flow">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="fast-back">
        <ArrowLeft className="h-4 w-4" /> Verification options
      </button>

      <div className="wh-card p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold">Fast Verification — $1 one-time</div>
            <p className="text-xs text-muted-foreground">No second manual review. The $1 verification helps deter impersonation, spam and scam attempts.</p>
          </div>
        </div>

        {!listingApproved && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="fast-listing-pending">
            This listing is rejected, suspended or archived, so Fast Verification is closed. Contact support if that looks wrong.
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex gap-2" data-testid="fast-error">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{err}
          </div>
        )}
        {msg && <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="fast-msg">{msg}</div>}

        <div className="mt-5 text-sm font-semibold">Owner details</div>
        <p className="mt-0.5 text-xs text-muted-foreground">Private. Visible only to you and authorized WaveLead support — never shown on your public channel profile.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">Full legal name
            <input className={inputCls} value={form.full_legal_name} onChange={(e) => setForm({ ...form, full_legal_name: e.target.value })} data-testid="identity-name" />
          </label>
          <div className="text-sm">Country
            <CountryCombobox value={form.country_code} onChange={(code) => setForm({ ...form, country_code: code })} id="fast-country" testId="identity-country" className="mt-1" />
          </div>
          <label className="text-sm">City
            <input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="identity-city" />
          </label>
          <label className="text-sm">Email
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="identity-email" />
          </label>
          <label className="text-sm">Mobile / WhatsApp number
            <input className={inputCls} value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} data-testid="identity-mobile" />
          </label>
          <label className="text-sm">Role in channel
            <select className={inputCls} value={form.role_in_channel} onChange={(e) => setForm({ ...form, role_in_channel: e.target.value })} data-testid="identity-role">
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="text-sm md:col-span-2">Company / Organization (optional)
            <input className={inputCls} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} data-testid="identity-company" />
          </label>
        </div>

        <div className="mt-6 text-sm font-semibold">Payout account</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Where WaveLead sends your sponsorship earnings (owner receives 90% of the applicable net; WaveLead retains 10%). We store only the payout destination — never a password.
        </p>
        {payoutConfigured ? (
          <div className="mt-2 text-sm text-emerald-700" data-testid="payout-already-configured">Payout destination already configured.</div>
        ) : (
          <label className="mt-2 block text-sm max-w-md">PayPal payout email
            <input className={inputCls} value={payoutEmail} onChange={(e) => setPayoutEmail(e.target.value)} placeholder="you@example.com" data-testid="payout-email" />
          </label>
        )}

        <label className="mt-6 flex gap-2 items-start text-sm">
          <input type="checkbox" className="mt-1" checked={form.declaration_accepted} onChange={(e) => setForm({ ...form, declaration_accepted: e.target.checked })} data-testid="owner-declaration" />
          <span>{declarationText}</span>
        </label>

        <Button className="mt-5" onClick={continueToPayment} disabled={busy || !listingApproved} data-testid="continue-to-payment">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Opening PayPal…</> : 'Continue to $1 Payment'}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          $1 USD one-time. You authorize the payment on PayPal — WaveLead never charges you automatically. Owner Verified activates only after the payment is confirmed by PayPal and all details above are complete.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">We never ask for passport, national ID, bank password or any account password.</p>
      </div>
    </div>
  );
}
