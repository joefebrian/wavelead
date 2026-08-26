'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, Loader2, Package } from 'lucide-react';

interface PackageSummary {
  id: string;
  type: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  deliverables: string[];
  estimated_delivery_days: number | null;
}

interface Props {
  channelId: string;
  channelName: string;
  channelSlug: string;
  pkg: PackageSummary;
  initialContactName: string;
  initialWorkEmail: string;
  isAuthed: boolean;
}

/**
 * Fixed-price marketplace booking form. Displayed price is INFORMATIONAL only —
 * the server derives channel/package/price/currency/seller from package_id.
 * We never send price_minor / owner_user_id / status / commission from the client.
 */
export default function MarketplaceBookingForm({
  channelId, channelName, channelSlug, pkg, initialContactName, initialWorkEmail, isAuthed,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    company_name: '',
    contact_name: initialContactName,
    contact_email: initialWorkEmail,
    campaign_objective: '',
    brief: '',
    target_start_date: '',
    target_end_date: '',
    product_url: '',
    notes: '',
  });

  function update<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Client only sends non-economic fields. Server owns price/seller/currency.
      const body: Record<string, unknown> = {
        channel_id: channelId,
        package_id: pkg.id,
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        campaign_objective: form.campaign_objective.trim(),
        brief: form.brief.trim(),
      };
      if (form.target_start_date) body.target_start_date = new Date(form.target_start_date + 'T00:00:00Z').toISOString();
      if (form.target_end_date) body.target_end_date = new Date(form.target_end_date + 'T00:00:00Z').toISOString();
      if (form.product_url.trim()) body.product_url = form.product_url.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await fetch('/api/marketplace/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Failed to submit');
      setDone({ id: j.data.order.id });
    } catch (err) {
      setError((err as Error).message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const priceUsd = `$${(pkg.price_minor / 100).toFixed(2)}`;
  const nextForAuth = `/sponsor/${channelSlug}?package=${encodeURIComponent(pkg.id)}`;

  if (done) {
    return (
      <div className="wh-card p-6 md:p-8 border-emerald-200 bg-emerald-50/40">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Sponsorship request submitted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your request for <span className="font-medium text-foreground">{pkg.name}</span> on{' '}
              <span className="font-medium text-foreground">{channelName}</span> has been sent to the channel owner.
              Reference: <span className="font-mono text-xs">{done.id.slice(0, 8)}</span>.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">The owner has 7 days to accept or reject. You&apos;ll be notified either way.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {isAuthed ? (
                <Link href="/dashboard/sponsorships"><Button>View My Sponsorships</Button></Link>
              ) : (
                <Link href={`/login?next=${encodeURIComponent('/dashboard/sponsorships')}`}><Button>View My Sponsorships</Button></Link>
              )}
              <Button variant="outline" onClick={() => router.push('/channels')}>Explore more channels</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-6 items-start">
      <form onSubmit={onSubmit} className="wh-card p-5 md:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Sponsor {channelName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You&apos;re booking a fixed-price marketplace package. Fields marked <span className="text-rose-500">*</span> are required.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Company / Brand name" required>
            <input type="text" required maxLength={200} value={form.company_name} onChange={(e) => update('company_name', e.target.value)} className={inputCls} placeholder="Acme Beverages" />
          </Field>
          <Field label="Contact name" required>
            <input type="text" required maxLength={120} value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} className={inputCls} placeholder="Alex Sponsor" />
          </Field>
        </div>
        <Field label="Contact email" required>
          <input type="email" required maxLength={200} value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} className={inputCls} placeholder="alex@acme.com" />
        </Field>
        <Field label="Campaign objective" required>
          <input type="text" required maxLength={500} value={form.campaign_objective} onChange={(e) => update('campaign_objective', e.target.value)} className={inputCls} placeholder="Drive product launch awareness" />
        </Field>
        <Field label="Campaign brief" required>
          <textarea required minLength={10} maxLength={4000} rows={5} value={form.brief} onChange={(e) => update('brief', e.target.value)} className={inputCls} placeholder="Tell the channel owner about your product, audience, and what a great partnership would look like." />
        </Field>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Target start date">
            <input type="date" value={form.target_start_date} onChange={(e) => update('target_start_date', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Target end date">
            <input type="date" value={form.target_end_date} onChange={(e) => update('target_end_date', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Product / Landing URL">
          <input type="url" maxLength={500} value={form.product_url} onChange={(e) => update('product_url', e.target.value)} className={inputCls} placeholder="https://acme.com/launch" />
        </Field>
        <Field label="Notes for the owner">
          <textarea maxLength={2000} rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} className={inputCls} placeholder="Anything else the owner should know." />
        </Field>

        {error && <div className="text-sm text-rose-600" data-testid="mp-book-error">{error}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={submitting} className="min-w-44">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Send sponsorship request'}
          </Button>
          {!isAuthed && (
            <span className="text-xs text-muted-foreground">
              Not signed in?{' '}
              <Link href={`/signup?next=${encodeURIComponent(nextForAuth)}`} className="text-primary underline">Sign up</Link>
              {' '}or{' '}
              <Link href={`/login?next=${encodeURIComponent(nextForAuth)}`} className="text-primary underline">log in</Link>
              {' '}to track your requests.
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          No payment is collected on this page. WaveLead confirms payment manually before the campaign begins.
        </p>
      </form>

      <aside className="wh-card p-5 md:sticky md:top-24 h-fit" data-testid="mp-package-summary">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-medium">
          <Package className="h-3.5 w-3.5 text-primary" /> Selected package
        </div>
        <div className="mt-2 font-semibold">{pkg.name}</div>
        <div className="text-xs text-muted-foreground">{pkg.type.replace(/_/g, ' ')}</div>
        <p className="mt-2 text-sm text-muted-foreground line-clamp-4">{pkg.description}</p>
        {pkg.deliverables.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Deliverables</div>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {pkg.deliverables.map((d, i) => (
                <li key={i} className="flex gap-1.5"><span aria-hidden>•</span><span className="flex-1">{d}</span></li>
              ))}
            </ul>
          </div>
        )}
        {pkg.estimated_delivery_days != null && (
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> ~{pkg.estimated_delivery_days} day{pkg.estimated_delivery_days === 1 ? '' : 's'} to deliver
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border/60">
          <div className="text-xs text-muted-foreground">Price (informational)</div>
          <div className="text-2xl font-bold">{priceUsd} <span className="text-xs font-normal text-muted-foreground">USD</span></div>
          <p className="mt-1 text-xs text-muted-foreground">Final price is set by WaveLead server based on this package.</p>
        </div>
      </aside>
    </div>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}{required && <span className="text-rose-500">*</span>}</span>
      {children}
    </label>
  );
}
