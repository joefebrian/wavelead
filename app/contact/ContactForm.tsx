'use client';

import { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, AlertTriangle, Loader2, Mail } from 'lucide-react';

const TOPICS: { value: string; label: string }[] = [
  { value: 'general', label: 'General question' },
  { value: 'support', label: 'Owner / channel support' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'press', label: 'Press' },
  { value: 'other', label: 'Other' },
];

interface Props {
  destination: string;
  preselectedTopic: string;
  emailAvailable: boolean;
}

export default function ContactForm({ destination, preselectedTopic, emailAvailable }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [topic, setTopic] = useState<string>(preselectedTopic || 'general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<null | { deliveryStatus: 'sent' | 'persisted_only' | 'send_failed' }>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null); setBusy(true);
    try {
      const r = await fetch('/api/contact', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(),
          company: company.trim() || undefined, topic, message: message.trim(),
          page_context: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Something went wrong. Please try again.'); return; }
      setSuccess({ deliveryStatus: (j.data?.delivery_status as 'sent' | 'persisted_only' | 'send_failed') || 'persisted_only' });
    } catch { setError('Could not reach the server. Please retry.'); }
    finally { setBusy(false); }
  }

  if (success) {
    return (
      <div className="wh-card p-8 text-center" data-testid="contact-success">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary grid place-items-center"><CheckCircle2 className="h-8 w-8" /></div>
        <h2 className="mt-4 text-xl font-bold">Thanks — we&apos;ve received your message.</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          {success.deliveryStatus === 'sent'
            ? <>A copy has been sent to <span className="font-semibold text-foreground">{destination}</span> and someone from the WaveLead team will reply as soon as possible.</>
            : <>Your message is safely recorded in WaveLead. Someone from the team will pick it up and reply directly.</>}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="wh-card p-6 grid gap-5">
      <div className="text-sm text-muted-foreground flex items-center gap-2 border-b border-border/60 pb-4">
        <Mail className="h-4 w-4 text-primary" />
        <span>Messages go to <span className="font-semibold text-foreground">{destination}</span>.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">Name <span className="text-destructive">*</span></Label>
          <Input id="c-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder="Your name" />
        </div>
        <div>
          <Label htmlFor="c-email">Email <span className="text-destructive">*</span></Label>
          <Input id="c-email" required type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" placeholder="you@company.com" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-company">Company / Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input id="c-company" maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1.5" placeholder="Company or brand" />
        </div>
        <div>
          <Label htmlFor="c-topic">Topic <span className="text-destructive">*</span></Label>
          <select id="c-topic" required value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" data-testid="contact-topic">
            {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="c-message">Message <span className="text-destructive">*</span></Label>
        <Textarea id="c-message" required minLength={10} maxLength={4000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1.5" placeholder="Tell us how we can help." />
        <p className="mt-1 text-xs text-muted-foreground">{message.length}/4000</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2" data-testid="contact-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-muted-foreground">
          {emailAvailable
            ? 'A copy of your message will be emailed to the WaveLead team.'
            : 'Your message is stored in WaveLead and monitored by the team.'}
        </p>
        <Button type="submit" size="lg" disabled={busy} data-testid="contact-submit">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…</> : 'Send message'}
        </Button>
      </div>
    </form>
  );
}
