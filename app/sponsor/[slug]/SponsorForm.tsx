'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  channelSlug: string;
  channelName: string;
  presetTargetCountry: string | null;
  initialContactName: string;
  initialWorkEmail: string;
}

const OBJECTIVES: [string, string][] = [
  ['brand_awareness', 'Brand Awareness'],
  ['traffic', 'Traffic'],
  ['product_launch', 'Product Launch'],
  ['promotion', 'Promotion'],
  ['other', 'Other'],
];
const BUDGETS: [string, string][] = [
  ['under_500', 'Under $500'],
  ['500_1000', '$500 – $1,000'],
  ['1000_2500', '$1,000 – $2,500'],
  ['2500_5000', '$2,500 – $5,000'],
  ['5000_plus', '$5,000+'],
];

export default function SponsorForm({ channelSlug, channelName, presetTargetCountry, initialContactName, initialWorkEmail }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    company_name: '', contact_name: initialContactName, work_email: initialWorkEmail,
    objective: 'brand_awareness', budget_range: '1000_2500',
    target_country: presetTargetCountry || '', desired_start_at: '', brief: '',
  });

  function update<K extends keyof typeof form>(key: K, val: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: val })); }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null); setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        channel_slug: channelSlug,
        company_name: form.company_name.trim(),
        contact_name: form.contact_name.trim(),
        work_email: form.work_email.trim(),
        objective: form.objective,
        budget_range: form.budget_range,
        brief: form.brief.trim(),
      };
      if (form.target_country.trim()) body.target_country = form.target_country.trim().toUpperCase();
      if (form.desired_start_at) body.desired_start_at = new Date(form.desired_start_at + 'T00:00:00Z').toISOString();
      const res = await fetch('/api/sponsorship-leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Failed to submit');
      setDone({ id: j.data.lead.id });
    } catch (err) {
      setError((err as Error).message || 'Something went wrong');
    } finally { setSubmitting(false); }
  }

  if (done) {
    return (
      <div className="wh-card p-6 md:p-8 border-emerald-200 bg-emerald-50/40">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold">Request received</h2>
            <p className="mt-1 text-sm text-muted-foreground">Thanks! We&apos;ll reach out shortly to coordinate a sponsorship with <span className="font-medium text-foreground">{channelName}</span>. Reference: <span className="font-mono text-xs">{done.id.slice(0, 8)}</span>.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => router.push('/channels')}>Explore more channels</Button>
              <Button onClick={() => { setDone(null); setForm((f) => ({ ...f, company_name: '', brief: '' })); }}>Submit another</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="wh-card p-6 md:p-8 space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Company / Brand name" required>
          <input type="text" required maxLength={200} value={form.company_name} onChange={(e) => update('company_name', e.target.value)} className={inputCls} placeholder="Acme Beverages" />
        </Field>
        <Field label="Contact name" required>
          <input type="text" required maxLength={200} value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} className={inputCls} placeholder="Alex Sponsor" />
        </Field>
      </div>
      <Field label="Work email" required>
        <input type="email" required maxLength={200} value={form.work_email} onChange={(e) => update('work_email', e.target.value)} className={inputCls} placeholder="alex@acme.com" />
      </Field>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Campaign objective" required>
          <select value={form.objective} onChange={(e) => update('objective', e.target.value)} className={inputCls}>
            {OBJECTIVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Budget range" required>
          <select value={form.budget_range} onChange={(e) => update('budget_range', e.target.value)} className={inputCls}>
            {BUDGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Target country (ISO-2)">
          <input type="text" maxLength={2} value={form.target_country} onChange={(e) => update('target_country', e.target.value.toUpperCase())} className={inputCls} placeholder="ID" />
        </Field>
        <Field label="Desired start date">
          <input type="date" value={form.desired_start_at} onChange={(e) => update('desired_start_at', e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Campaign brief" required>
        <textarea required minLength={10} maxLength={4000} rows={5} value={form.brief} onChange={(e) => update('brief', e.target.value)} className={inputCls} placeholder="Tell us about your product, audience, and what a great partnership would look like." />
      </Field>
      {error && <div className="text-sm text-rose-600">{error}</div>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting} className="min-w-44">{submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : 'Send sponsorship request'}</Button>
        <span className="text-xs text-muted-foreground">We won&apos;t charge you today. WaveLead will contact you to coordinate.</span>
      </div>
    </form>
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
