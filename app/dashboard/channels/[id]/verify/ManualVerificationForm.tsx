'use client';
// M17.1 — MANUAL VERIFICATION (FREE) — one straightforward form.
//
// The legacy three-card method selector is NOT used here: the owner sees the
// identity fields and every evidence field directly, fills whatever they have,
// and submits ONE request.
// No payment is involved and human review is preserved: this posts to the
// EXISTING claim service, which routes the submission to admin review.
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import CountryCombobox from '@/components/forms/CountryCombobox';
import { ga4Track } from '@/components/analytics/GoogleAnalytics';
import { ROLE_OPTIONS, identityIncompleteReason, type IdentityForm } from './FastVerificationForm';

const inputCls = 'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

/** Evidence fields rendered directly on the form — none of them is mandatory on its own. */
export const MANUAL_EVIDENCE_FIELDS = [
  { key: 'website', label: 'Website URL', placeholder: 'https://yourbrand.com' },
  { key: 'instagram', label: 'Instagram URL', placeholder: 'https://instagram.com/yourbrand' },
  { key: 'facebook', label: 'Facebook URL', placeholder: 'https://facebook.com/yourbrand' },
  { key: 'tiktok', label: 'TikTok URL', placeholder: 'https://tiktok.com/@yourbrand' },
  { key: 'threads', label: 'Threads URL', placeholder: 'https://threads.net/@yourbrand' },
  { key: 'other', label: 'Other Public Proof URL', placeholder: 'https://…' },
] as const;

type EvidenceKey = typeof MANUAL_EVIDENCE_FIELDS[number]['key'];

export default function ManualVerificationForm({
  channelId, channelSlug, listingApproved, declarationText, initialForm, onBack,
}: {
  channelId: string;
  channelSlug: string;
  listingApproved: boolean;
  declarationText: string;
  initialForm: IdentityForm;
  onBack: () => void;
}) {
  const [form, setForm] = useState<IdentityForm>(initialForm);
  const [evidence, setEvidence] = useState<Record<EvidenceKey, string>>({
    website: '', instagram: '', facebook: '', tiktok: '', threads: '', other: '',
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const filled = MANUAL_EVIDENCE_FIELDS.filter((f) => evidence[f.key].trim().length > 0);

  function validate(): string | null {
    const idErr = identityIncompleteReason(form);
    if (idErr) return idErr;
    if (!form.declaration_accepted) return 'Please accept the owner declaration.';
    // Existing manual-review policy: enough to review. At least one public
    // evidence link OR a clear written explanation.
    if (filled.length === 0 && note.trim().length < 30) {
      return 'Add at least one ownership evidence link, or explain in more detail how you own or represent this channel.';
    }
    for (const f of filled) {
      if (!/^https?:\/\//i.test(evidence[f.key].trim())) return `${f.label} must start with https://`;
    }
    return null;
  }

  async function submitManual() {
    if (busy) return;
    setErr(null);
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      const identityBlock = [
        `Full legal name: ${form.full_legal_name.trim()}`,
        `Country: ${form.country_code}`,
        `City: ${form.city.trim()}`,
        `Email: ${form.email.trim()}`,
        `Mobile / WhatsApp: ${form.mobile_number.trim()}`,
        `Role in channel: ${form.role_in_channel}`,
        form.company_name.trim() ? `Company / Organization: ${form.company_name.trim()}` : null,
        '',
        note.trim() ? `Message to reviewer: ${note.trim()}` : null,
      ].filter(Boolean).join('\n').slice(0, 2000);

      const r = await fetch(`/api/claims/${encodeURIComponent(channelSlug)}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_method: 'manual',
          claimant_note: identityBlock,
          evidence_urls: filled.map((f) => ({ evidence_type: f.key, evidence_url: evidence[f.key].trim() })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not submit your manual verification');

      // Best-effort: persist the structured owner identity profile too. Only
      // possible once the listing is approved (server-side precondition), and
      // a failure must never lose the submitted claim.
      if (listingApproved) {
        await fetch(`/api/owner/channels/${channelId}/verification/identity`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, company_name: form.company_name || '' }),
        }).catch(() => null);
      }
      ga4Track('manual_verification_submitted', { channel: channelSlug });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="mt-6 wh-card p-6 border-emerald-300 bg-emerald-50/60" data-testid="manual-submitted">
        <div className="inline-flex items-center gap-2 font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5" /> Manual Verification submitted</div>
        <p className="mt-1 text-sm text-emerald-900/80">
          A WaveLead reviewer will check your ownership evidence. You may be asked for more information. No payment was required.
        </p>
        <div className="mt-3 flex gap-2 flex-wrap">
          <Link href="/dashboard/claims"><Button size="sm" variant="outline">Track my verification</Button></Link>
          <Button size="sm" variant="ghost" onClick={onBack} data-testid="manual-back-to-options">Verification options</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4" data-testid="manual-verification-flow">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="manual-back">
        <ArrowLeft className="h-4 w-4" /> Verification options
      </button>

      <div className="wh-card p-6">
        <div className="font-semibold">Manual Verification — Free</div>
        <p className="mt-0.5 text-xs text-muted-foreground">Reviewed manually by WaveLead. No payment required.</p>

        {err && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex gap-2" data-testid="manual-error">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{err}
          </div>
        )}

        <div className="mt-5 text-sm font-semibold">Required owner information</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm">Full legal name
            <input className={inputCls} value={form.full_legal_name} onChange={(e) => setForm({ ...form, full_legal_name: e.target.value })} data-testid="manual-name" />
          </label>
          <div className="text-sm">Country
            <CountryCombobox value={form.country_code} onChange={(code) => setForm({ ...form, country_code: code })} id="manual-country" testId="manual-country" className="mt-1" />
          </div>
          <label className="text-sm">City
            <input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="manual-city" />
          </label>
          <label className="text-sm">Email
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="manual-email" />
          </label>
          <label className="text-sm">Mobile / WhatsApp number
            <input className={inputCls} value={form.mobile_number} onChange={(e) => setForm({ ...form, mobile_number: e.target.value })} data-testid="manual-mobile" />
          </label>
          <label className="text-sm">Role in channel
            <select className={inputCls} value={form.role_in_channel} onChange={(e) => setForm({ ...form, role_in_channel: e.target.value })} data-testid="manual-role">
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="text-sm md:col-span-2">Company / Organization (optional)
            <input className={inputCls} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} data-testid="manual-company" />
          </label>
        </div>

        <div className="mt-6 text-sm font-semibold">Ownership evidence</div>
        <p className="mt-0.5 text-xs text-muted-foreground">Add whatever you have — you do NOT need every platform.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="manual-evidence-fields">
          {MANUAL_EVIDENCE_FIELDS.map((f) => (
            <label key={f.key} className="text-sm">{f.label}
              <input
                className={inputCls}
                value={evidence[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setEvidence({ ...evidence, [f.key]: e.target.value })}
                data-testid={`manual-evidence-${f.key}`}
              />
            </label>
          ))}
        </div>

        <label className="mt-5 block text-sm">Explanation / Message to Reviewer
          <textarea
            className={`${inputCls} min-h-[96px]`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell us how you own, manage or are authorized to represent this channel."
            data-testid="manual-note"
          />
        </label>

        <label className="mt-5 flex gap-2 items-start text-sm">
          <input type="checkbox" className="mt-1" checked={form.declaration_accepted} onChange={(e) => setForm({ ...form, declaration_accepted: e.target.checked })} data-testid="manual-declaration" />
          <span>{declarationText}</span>
        </label>

        <Button className="mt-5" onClick={submitManual} disabled={busy} data-testid="submit-manual-verification">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Submit Manual Verification'}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Free. A WaveLead reviewer checks your evidence — approval is manual and no payment is taken.</p>
      </div>
    </div>
  );
}
