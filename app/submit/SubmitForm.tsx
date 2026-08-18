'use client';

import { useState, useMemo, FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink, Sparkles, Info, ArrowLeft, ShieldAlert, Wand2 } from 'lucide-react';

interface CategoryOpt { id: string; slug: string; name: string; }
interface CountryOpt { code: string; name: string; flag: string; }
interface Props { categories: CategoryOpt[]; countries: CountryOpt[]; }

type Provenance = 'public_metadata' | 'wavelead_inference' | 'user' | null;
interface EnrichField<T> { value: T | null; source: Provenance; confidence: number; editable: boolean; }
interface EnrichmentResp {
  status: 'success' | 'partial' | 'unavailable' | 'rate_limited' | 'invalid_url' | 'duplicate';
  duplicate?: {
    slug: string; name: string; public_url: string;
    is_verified: boolean; has_owner: boolean; is_official: boolean;
    owned_by_me: boolean; pending_submission?: boolean;
    suggested_action: 'view' | 'claim' | 'manage' | 'report' | 'submission_status';
  };
  canonical?: { channel_id: string; canonical_url: string };
  fields?: {
    channel_name: EnrichField<string>; description: EnrichField<string>; logo_url: EnrichField<string>;
    short_description: EnrichField<string>; category_slug: EnrichField<string>;
    primary_language: EnrichField<string>; country_code: EnrichField<string>;
  };
  metadata_available: boolean; inference_available: boolean; cached: boolean;
  refresh_available_at?: string;
}

type ImportState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ready'; resp: EnrichmentResp }
  | { state: 'duplicate'; resp: EnrichmentResp }
  | { state: 'invalid'; reason: string }
  | { state: 'rate_limited'; retryAt?: string };

const LANGS: { code: string; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'id', name: 'Bahasa Indonesia' }, { code: 'hi', name: 'Hindi' },
  { code: 'pt', name: 'Portuguese' }, { code: 'es', name: 'Spanish' }, { code: 'ms', name: 'Malay' },
  { code: 'th', name: 'Thai' }, { code: 'vi', name: 'Vietnamese' }, { code: 'tl', name: 'Filipino' },
  { code: 'ar', name: 'Arabic' }, { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' }, { code: 'ja', name: 'Japanese' }, { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' }, { code: 'ru', name: 'Russian' }, { code: 'tr', name: 'Turkish' },
];

function ProvenanceBadge({ source, confidence, touched }: { source: Provenance; confidence: number; touched: boolean }) {
  if (touched) return <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary font-medium"><Wand2 className="h-3 w-3" /> Your edit</span>;
  if (source === 'public_metadata') return <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-600 font-medium"><CheckCircle2 className="h-3 w-3" /> Auto-filled</span>;
  if (source === 'wavelead_inference') return <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-sky-600 font-medium"><Sparkles className="h-3 w-3" /> Suggested · {Math.round(confidence * 100)}%</span>;
  return <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"><Info className="h-3 w-3" /> Please confirm</span>;
}

export default function SubmitForm({ categories, countries }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [desc, setDesc] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [lang, setLang] = useState('');
  const [website, setWebsite] = useState('');
  const [logo, setLogo] = useState('');
  // Track which fields the user has edited so we can label them "Your edit".
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const setField = <K extends string>(key: K, v: string, setter: (s: string) => void) => { setter(v); setTouched((t) => ({ ...t, [key]: true })); };

  const [imp, setImp] = useState<ImportState>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; name: string } | null>(null);

  const importResp = imp.state === 'ready' ? imp.resp : null;
  const canSubmit =
    !submitting &&
    (imp.state === 'ready') &&
    name.trim().length >= 2 &&
    shortDesc.trim().length >= 10 &&
    categorySlug && countryCode.length === 2 && lang;

  function applyEnrichment(resp: EnrichmentResp) {
    const f = resp.fields;
    if (!f) return;
    if (f.channel_name.value) { setName(f.channel_name.value); setTouched((t) => ({ ...t, name: false })); }
    if (f.description.value) { setDesc(f.description.value); setTouched((t) => ({ ...t, desc: false })); }
    if (f.short_description.value) { setShortDesc(f.short_description.value.slice(0, 180)); setTouched((t) => ({ ...t, shortDesc: false })); }
    if (f.logo_url.value) { setLogo(f.logo_url.value); setTouched((t) => ({ ...t, logo: false })); }
    if (f.category_slug.value && categories.some((c) => c.slug === f.category_slug.value)) { setCategorySlug(f.category_slug.value!); setTouched((t) => ({ ...t, categorySlug: false })); }
    if (f.country_code.value && countries.some((c) => c.code === f.country_code.value)) { setCountryCode(f.country_code.value!); setTouched((t) => ({ ...t, countryCode: false })); }
    if (f.primary_language.value && LANGS.some((l) => l.code === f.primary_language.value)) { setLang(f.primary_language.value!); setTouched((t) => ({ ...t, lang: false })); }
  }

  async function runImport() {
    if (!url.trim()) { setImp({ state: 'invalid', reason: 'URL is required' }); return; }
    setImp({ state: 'checking' });
    setSubmitError(null);
    try {
      const r = await fetch('/api/channels/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ channel_url: url.trim() }),
      });
      const j = await r.json();
      if (r.status === 429) { setImp({ state: 'rate_limited', retryAt: j?.data?.refresh_available_at }); return; }
      if (!j?.ok) { setImp({ state: 'invalid', reason: j?.error || 'Enrichment failed' }); return; }
      const resp = j.data as EnrichmentResp;
      if (resp.status === 'invalid_url') { setImp({ state: 'invalid', reason: 'This is not a valid public WhatsApp channel URL.' }); return; }
      if (resp.status === 'rate_limited') { setImp({ state: 'rate_limited' }); return; }
      if (resp.status === 'duplicate') { setImp({ state: 'duplicate', resp }); return; }
      // success | partial | unavailable → open the form; prefill what we have
      applyEnrichment(resp);
      // Default sensible fallbacks when inference didn't fill enums
      if (!categorySlug && !resp.fields?.category_slug.value) setCategorySlug('');
      if (!countryCode && !resp.fields?.country_code.value) setCountryCode('');
      if (!lang && !resp.fields?.primary_language.value) setLang('');
      setImp({ state: 'ready', resp });
    } catch {
      setImp({ state: 'invalid', reason: 'Could not reach the server. Please retry.' });
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const r = await fetch('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          whatsapp_url: url.trim(),
          name: name.trim(), short_description: shortDesc.trim(),
          description: desc.trim() || undefined,
          category_slug: categorySlug, country_code: countryCode.toUpperCase(),
          primary_language: lang,
          website_url: website.trim() || undefined, logo_url: logo.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setSubmitError(j?.error || 'Something went wrong. Please try again.'); return; }
      setSuccess({ slug: j.data?.channel?.slug, name: j.data?.channel?.name });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setSubmitError('Could not reach the server. Please retry.');
    } finally { setSubmitting(false); }
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
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 text-primary grid place-items-center"><CheckCircle2 className="h-8 w-8" /></div>
        <h2 className="mt-4 text-xl font-bold">Submission received</h2>
        <p className="mt-2 text-muted-foreground"><span className="font-semibold text-foreground">{success.name}</span> is now <span className="font-semibold">Pending Review</span>. A moderator will check the link and approve it if it meets our guidelines.</p>
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
      {/* Smart import bar */}
      <div className="wh-card p-6 grid gap-3">
        <Label htmlFor="url">WhatsApp Channel URL <span className="text-destructive">*</span></Label>
        <div className="flex gap-2 flex-col sm:flex-row">
          <Input
            id="url" type="url" required
            placeholder="https://whatsapp.com/channel/0029..."
            value={url}
            onChange={(e) => { setUrl(e.target.value); setImp({ state: 'idle' }); }}
            className="flex-1"
          />
          <Button type="button" onClick={runImport} disabled={!url.trim() || imp.state === 'checking'} className="gap-1.5">
            {imp.state === 'checking' ? <><Loader2 className="h-4 w-4 animate-spin" /> Fetching channel details…</> : <><Sparkles className="h-4 w-4" /> Fetch channel details</>}
          </Button>
        </div>

        {imp.state === 'checking' && (
          <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking channel · fetching public details · analyzing…</div>
        )}
        {imp.state === 'ready' && (
          <div className="text-sm text-primary flex items-start gap-2 rounded-md bg-primary/5 border border-primary/20 p-3">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Review your channel details</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {imp.resp.status === 'success' && 'Public details found and suggestions ready. Please review before submitting.'}
                {imp.resp.status === 'partial' && 'Public details found. Some suggestions could not be inferred — please complete them manually.'}
                {imp.resp.status === 'unavailable' && 'We couldn\'t fetch public details for this channel. Please enter them manually.'}
              </div>
            </div>
          </div>
        )}
        {imp.state === 'duplicate' && imp.resp.duplicate && (
          <DuplicateCard duplicate={imp.resp.duplicate} onBack={() => { setImp({ state: 'idle' }); setUrl(''); }} />
        )}
        {imp.state === 'rate_limited' && (
          <div className="text-sm text-amber-800 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 p-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Too many fetches, please wait a moment</div>
              <div>You can still submit manually — go ahead and fill the fields below.</div>
            </div>
          </div>
        )}
        {imp.state === 'invalid' && (
          <div className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {imp.reason}</div>
        )}
        {imp.state === 'idle' && (
          <p className="text-xs text-muted-foreground">Paste a public whatsapp.com or wa.me channel link. We&apos;ll pre-fill what we can — you always confirm before submitting.</p>
        )}
      </div>

      {/* Rest of form hidden until URL is validated OR user forces manual entry after failure */}
      {(imp.state === 'ready' || imp.state === 'rate_limited') && (
        <>
          <ChannelDetails
            name={name} shortDesc={shortDesc} desc={desc}
            onName={(v) => setField('name', v, setName)}
            onShortDesc={(v) => setField('shortDesc', v, setShortDesc)}
            onDesc={(v) => setField('desc', v, setDesc)}
            resp={importResp}
            touched={touched}
          />

          <Classification
            categories={categories} countries={countries}
            categorySlug={categorySlug} countryCode={countryCode} lang={lang}
            onCategory={(v) => setField('categorySlug', v, setCategorySlug)}
            onCountry={(v) => setField('countryCode', v, setCountryCode)}
            onLang={(v) => setField('lang', v, setLang)}
            resp={importResp}
            touched={touched}
          />

          <div className="wh-card p-6 grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="website">Website (optional)</Label>
              <Input id="website" type="url" placeholder="https://…" value={website} onChange={(e) => setField('website', e.target.value, setWebsite)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="logo" className="flex items-center">Logo URL (optional){importResp?.fields?.logo_url.source && <ProvenanceBadge source={importResp.fields.logo_url.source} confidence={importResp.fields.logo_url.confidence} touched={!!touched.logo} />}</Label>
              <Input id="logo" type="url" placeholder="https://…" value={logo} onChange={(e) => setField('logo', e.target.value, setLogo)} className="mt-1.5" />
            </div>
          </div>

          {/* Preview */}
          <div className="wh-card p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Preview</div>
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold overflow-hidden" aria-hidden>
                {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : preview.name.charAt(0).toUpperCase()}
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
        </>
      )}
    </form>
  );
}

function DuplicateCard({ duplicate, onBack }: { duplicate: NonNullable<EnrichmentResp['duplicate']>; onBack: () => void }) {
  return (
    <div className="rounded-md border border-sky-300/60 bg-sky-50 p-4">
      <div className="flex items-start gap-2">
        <Info className="h-5 w-5 text-sky-600 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-sky-900">
            {duplicate.owned_by_me
              ? 'This channel is already in your WaveLead account.'
              : duplicate.is_verified
                ? 'This WhatsApp channel is already listed and has a verified owner.'
                : 'This WhatsApp channel is already listed on WaveLead.'}
          </div>
          <div className="mt-1 text-sm text-sky-900">
            <span className="font-medium">{duplicate.name}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {duplicate.suggested_action !== 'submission_status' && (
              <Link href={duplicate.public_url}>
                <Button size="sm" variant="outline" className="gap-1"><ExternalLink className="h-3.5 w-3.5" /> View channel</Button>
              </Link>
            )}
            {duplicate.suggested_action === 'claim' && (
              <Link href={`/claim/${duplicate.slug}`}><Button size="sm">Claim this channel</Button></Link>
            )}
            {duplicate.suggested_action === 'manage' && (
              <Link href={`/dashboard/channels`}><Button size="sm">Manage in dashboard</Button></Link>
            )}
            {duplicate.suggested_action === 'report' && (
              <Link href={`/claim/${duplicate.slug}`}><Button size="sm" variant="outline" className="gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Report ownership issue</Button></Link>
            )}
            {duplicate.suggested_action === 'submission_status' && (
              <Link href={`/dashboard/channels`}><Button size="sm" variant="outline">View submission status</Button></Link>
            )}
            <Button size="sm" variant="ghost" onClick={onBack} className="gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Try a different URL</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelDetails({ name, shortDesc, desc, onName, onShortDesc, onDesc, resp, touched }: {
  name: string; shortDesc: string; desc: string;
  onName: (v: string) => void; onShortDesc: (v: string) => void; onDesc: (v: string) => void;
  resp: EnrichmentResp | null; touched: Record<string, boolean>;
}) {
  return (
    <div className="wh-card p-6 grid gap-4">
      <div>
        <Label htmlFor="name" className="flex items-center">Channel name <span className="text-destructive ml-1">*</span>
          {resp?.fields?.channel_name.source && <ProvenanceBadge source={resp.fields.channel_name.source} confidence={resp.fields.channel_name.confidence} touched={!!touched.name} />}
        </Label>
        <Input id="name" required maxLength={80} placeholder="e.g. Nusantara Daily" value={name} onChange={(e) => onName(e.target.value)} className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor="short" className="flex items-center">Short description <span className="text-destructive ml-1">*</span>
          {resp?.fields?.short_description.source && <ProvenanceBadge source={resp.fields.short_description.source} confidence={resp.fields.short_description.confidence} touched={!!touched.shortDesc} />}
        </Label>
        <Input id="short" required minLength={10} maxLength={180} placeholder="One line, 10–180 chars." value={shortDesc} onChange={(e) => onShortDesc(e.target.value)} className="mt-1.5" />
        <p className="mt-1 text-xs text-muted-foreground">{shortDesc.length}/180</p>
      </div>
      <div>
        <Label htmlFor="desc" className="flex items-center">Full description (optional)
          {resp?.fields?.description.source && <ProvenanceBadge source={resp.fields.description.source} confidence={resp.fields.description.confidence} touched={!!touched.desc} />}
        </Label>
        <Textarea id="desc" maxLength={2000} rows={4} placeholder="Tell people what the channel covers, how often it posts, who it's for." value={desc} onChange={(e) => onDesc(e.target.value)} className="mt-1.5" />
      </div>
    </div>
  );
}

function Classification({ categories, countries, categorySlug, countryCode, lang, onCategory, onCountry, onLang, resp, touched }: {
  categories: CategoryOpt[]; countries: CountryOpt[];
  categorySlug: string; countryCode: string; lang: string;
  onCategory: (v: string) => void; onCountry: (v: string) => void; onLang: (v: string) => void;
  resp: EnrichmentResp | null; touched: Record<string, boolean>;
}) {
  return (
    <div className="wh-card p-6 grid gap-4 md:grid-cols-3">
      <div>
        <Label htmlFor="cat" className="flex items-center">Category <span className="text-destructive ml-1">*</span>
          {resp?.fields?.category_slug.source && <ProvenanceBadge source={resp.fields.category_slug.source} confidence={resp.fields.category_slug.confidence} touched={!!touched.categorySlug} />}
        </Label>
        <select id="cat" required value={categorySlug} onChange={(e) => onCategory(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
          <option value="">Select a category</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="country" className="flex items-center">Country <span className="text-destructive ml-1">*</span>
          {resp?.fields?.country_code.source && <ProvenanceBadge source={resp.fields.country_code.source} confidence={resp.fields.country_code.confidence} touched={!!touched.countryCode} />}
        </Label>
        <select id="country" required value={countryCode} onChange={(e) => onCountry(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
          <option value="">Select a country</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="lang" className="flex items-center">Primary language <span className="text-destructive ml-1">*</span>
          {resp?.fields?.primary_language.source && <ProvenanceBadge source={resp.fields.primary_language.source} confidence={resp.fields.primary_language.confidence} touched={!!touched.lang} />}
        </Label>
        <select id="lang" required value={lang} onChange={(e) => onLang(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
          <option value="">Select a language</option>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
    </div>
  );
}
