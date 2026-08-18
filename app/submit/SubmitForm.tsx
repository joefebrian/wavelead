'use client';

import { useState, useMemo, FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';

interface CategoryOpt { id: string; slug: string; name: string; }
interface CountryOpt { code: string; name: string; flag: string; }

interface Props {
  categories: CategoryOpt[];
  countries: CountryOpt[];
}

type CheckState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; normalized: string }
  | { state: 'duplicate'; normalized: string; existingSlug?: string; existingName?: string; isPublic?: boolean }
  | { state: 'invalid'; reason: string };

const LANGS: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'hi', name: 'Hindi' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'es', name: 'Spanish' },
  { code: 'ms', name: 'Malay' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'tl', name: 'Filipino' },
];

export default function SubmitForm({ categories, countries }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [desc, setDesc] = useState('');
  const [categorySlug, setCategorySlug] = useState(categories[0]?.slug || '');
  const [countryCode, setCountryCode] = useState(countries[0]?.code || 'ID');
  const [lang, setLang] = useState('en');
  const [website, setWebsite] = useState('');
  const [logo, setLogo] = useState('');

  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; name: string } | null>(null);

  const canSubmit =
    !submitting &&
    (check.state === 'ok') &&
    name.trim().length >= 2 &&
    shortDesc.trim().length >= 10 &&
    categorySlug &&
    countryCode.length === 2 &&
    lang;

  async function runCheck() {
    if (!url.trim()) { setCheck({ state: 'invalid', reason: 'URL is required' }); return; }
    setCheck({ state: 'checking' });
    try {
      const r = await fetch('/api/submit/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ whatsapp_url: url.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setCheck({ state: 'invalid', reason: j?.error || 'URL is not a valid WhatsApp channel link' });
        return;
      }
      const d = j.data;
      if (d.duplicate) {
        setCheck({
          state: 'duplicate',
          normalized: d.normalized,
          existingSlug: d.channel?.slug,
          existingName: d.channel?.name,
          isPublic: d.channel?.is_public,
        });
      } else {
        setCheck({ state: 'ok', normalized: d.normalized });
      }
    } catch {
      setCheck({ state: 'invalid', reason: 'Could not reach the server. Please retry.' });
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          whatsapp_url: url.trim(),
          name: name.trim(),
          short_description: shortDesc.trim(),
          description: desc.trim() || undefined,
          category_slug: categorySlug,
          country_code: countryCode.toUpperCase(),
          primary_language: lang,
          website_url: website.trim() || undefined,
          logo_url: logo.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setSubmitError(j?.error || 'Something went wrong. Please try again.');
        return;
      }
      setSuccess({ slug: j.data?.channel?.slug, name: j.data?.channel?.name });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setSubmitError('Could not reach the server. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }

  const preview = useMemo(() => ({
    name: name.trim() || 'Your channel name',
    short: shortDesc.trim() || 'A short description will appear here.',
    country: countries.find((c) => c.code === countryCode),
    category: categories.find((c) => c.slug === categorySlug),
    lang,
  }), [name, shortDesc, categorySlug, countryCode, lang, categories, countries]);

  if (success) {
    return (
      <div className="mt-8 wh-card p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary grid place-items-center">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="mt-4 text-xl font-bold">Submission received</h2>
        <p className="mt-2 text-muted-foreground">
          <span className="font-semibold text-foreground">{success.name}</span> is now <span className="font-semibold">Pending Review</span>. A moderator will check the link and approve it if it meets our guidelines.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">You&apos;ll be able to see it publicly after approval. This usually takes under 24 hours.</p>
        <div className="mt-6 flex gap-2 justify-center flex-wrap">
          <Link href="/channels"><Button variant="outline">Back to Discover</Button></Link>
          <Link href="/dashboard"><Button>Go to Dashboard</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-6">
      {/* URL + duplicate check */}
      <div className="wh-card p-6 grid gap-3">
        <Label htmlFor="url">WhatsApp Channel URL <span className="text-destructive">*</span></Label>
        <div className="flex gap-2 flex-col sm:flex-row">
          <Input
            id="url"
            type="url"
            required
            placeholder="https://whatsapp.com/channel/0029..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); setCheck({ state: 'idle' }); }}
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={runCheck} disabled={!url.trim() || check.state === 'checking'}>
            {check.state === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check URL'}
          </Button>
        </div>
        {check.state === 'ok' && (
          <div className="text-sm text-primary flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Looks good. Normalized: <code className="text-xs">{check.normalized}</code></div>
        )}
        {check.state === 'duplicate' && (
          <div className="text-sm text-amber-700 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Already listed</div>
              <div>This WhatsApp channel is already on WaveLead{check.existingName ? ` as ${check.existingName}` : ''}.</div>
              {check.isPublic && check.existingSlug && (
                <Link href={`/channel/${check.existingSlug}`} className="underline inline-flex items-center gap-1 mt-1">View existing listing <ExternalLink className="h-3 w-3" /></Link>
              )}
            </div>
          </div>
        )}
        {check.state === 'invalid' && (
          <div className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {check.reason}</div>
        )}
        <p className="text-xs text-muted-foreground">Must be a public whatsapp.com or wa.me link that contains <code>/channel/...</code>.</p>
      </div>

      {/* Channel details */}
      <div className="wh-card p-6 grid gap-4">
        <div>
          <Label htmlFor="name">Channel name <span className="text-destructive">*</span></Label>
          <Input id="name" required maxLength={80} placeholder="e.g. Nusantara Daily" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="short">Short description <span className="text-destructive">*</span></Label>
          <Input id="short" required minLength={10} maxLength={180} placeholder="One line, 10–180 chars." value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} className="mt-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">{shortDesc.length}/180</p>
        </div>
        <div>
          <Label htmlFor="desc">Full description (optional)</Label>
          <Textarea id="desc" maxLength={2000} rows={4} placeholder="Tell people what the channel covers, how often it posts, who it's for." value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1.5" />
        </div>
      </div>

      {/* Classification */}
      <div className="wh-card p-6 grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="cat">Category <span className="text-destructive">*</span></Label>
          <select id="cat" required value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="country">Country <span className="text-destructive">*</span></Label>
          <select id="country" required value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
            {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="lang">Primary language <span className="text-destructive">*</span></Label>
          <select id="lang" required value={lang} onChange={(e) => setLang(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Optional media */}
      <div className="wh-card p-6 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="website">Website (optional)</Label>
          <Input id="website" type="url" placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="logo">Logo URL (optional)</Label>
          <Input id="logo" type="url" placeholder="https://…" value={logo} onChange={(e) => setLogo(e.target.value)} className="mt-1.5" />
        </div>
      </div>

      {/* Preview */}
      <div className="wh-card p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Preview</div>
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold" aria-hidden>
            {preview.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{preview.name}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
              {preview.country?.flag} {preview.country?.name}
              {preview.lang && <> · {preview.lang}</>}
              {preview.category && <> · {preview.category.name}</>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview.short}</p>
          </div>
        </div>
      </div>

      {submitError && (
        <div className="wh-card border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {submitError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Submissions go to <span className="font-semibold">Pending Review</span>. They won&apos;t appear on WaveLead until a moderator approves them.</p>
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting…</> : 'Submit for review'}
        </Button>
      </div>
    </form>
  );
}
