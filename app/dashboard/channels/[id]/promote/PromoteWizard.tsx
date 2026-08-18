'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Target, Globe, DollarSign, CheckCircle2, Info } from 'lucide-react';

interface ChannelSummary { id: string; slug: string; name: string; logo_url: string | null; short_description: string | null; country_code: string | null; primary_language: string | null; category_id: string | null; }
interface Cat { slug: string; name: string; }
interface Cc { code: string; name: string; flag: string; }

const PLACEMENTS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'sponsored_search', label: 'Sponsored Search', hint: 'Shown to people searching WaveLead for related channels.' },
  { id: 'sponsored_homepage', label: 'Sponsored Homepage', hint: 'A clearly labeled slot on the WaveLead homepage.' },
  { id: 'sponsored_category', label: 'Sponsored Category', hint: 'Inside category discovery pages matching your channel.' },
  { id: 'sponsored_country', label: 'Sponsored Country', hint: 'Inside country discovery pages matching your audience.' },
  { id: 'sponsored_related_channel', label: 'Sponsored Related Channels', hint: 'On channel profile “Related” modules of similar channels.' },
];

// $2.00 CPM QA default. Displayed as a hint only; server always resolves live.
const DEFAULT_CPM_USD_MINOR = 200;

function dollars(minor: number): string { return `$${(minor / 100).toFixed(2)}`; }

export default function PromoteWizard({ channel, categories, countries }: { channel: ChannelSummary; categories: Cat[]; countries: Cc[]; }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [objective, setObjective] = useState<'visibility' | 'follow_intent'>('visibility');
  const [placements, setPlacements] = useState<string[]>(['sponsored_search']);
  const [tCountries, setTCountries] = useState<string[]>(channel.country_code ? [channel.country_code.toUpperCase()] : []);
  const [tLanguages, setTLanguages] = useState<string[]>(channel.primary_language ? [channel.primary_language.toLowerCase()] : []);
  const [tCategories, setTCategories] = useState<string[]>([]);
  const [budget, setBudget] = useState(2500); // $25 default
  const [dailyBudget, setDailyBudget] = useState('');
  const [startAt, setStartAt] = useState(() => new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [name, setName] = useState(`Promote ${channel.name}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const estImpressions = useMemo(() => {
    // budget minor / CPM * 1000. Rough estimate using default fixture CPM.
    if (!budget || placements.length === 0) return 0;
    return Math.floor((budget / DEFAULT_CPM_USD_MINOR) * 1000);
  }, [budget, placements]);

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      const create = await fetch('/api/owner/promotions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channel.id, name, objective, placements,
          targeting: { countries: tCountries, languages: tLanguages, categories: tCategories },
          budget_total_usd_minor: budget,
          budget_daily_usd_minor: dailyBudget ? Math.round(parseFloat(dailyBudget) * 100) : null,
          start_at: new Date(startAt).toISOString(),
          end_at: new Date(endAt).toISOString(),
        }),
      }).then((r) => r.json());
      if (!create.ok) throw new Error(create.error || 'Failed to create');
      const id = create.data.campaign.id as string;
      const submitR = await fetch(`/api/owner/promotions/${id}/submit`, { method: 'POST' }).then((r) => r.json());
      if (!submitR.ok) throw new Error(submitR.error || 'Failed to submit');
      setSubmittedId(id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setSubmitting(false); }
  }

  if (submittedId) {
    return (
      <div className="mt-6 wh-card p-6">
        <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="h-5 w-5" /> Submitted for WaveLead review</div>
        <p className="mt-2 text-sm text-muted-foreground">Your campaign is under review. Approved campaigns activate immediately (or on your scheduled start).</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => router.push(`/dashboard/promotions/${submittedId}`)}>View campaign</Button>
          <Button variant="outline" onClick={() => router.push('/dashboard/promotions')}>All promotions</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {['Channel', 'Objective', 'Audience', 'Placements', 'Budget', 'Review'].map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <span className="mx-1">›</span>}
            <span className={i < step ? 'text-foreground font-medium' : ''}>{label}</span>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Channel */}
      {step === 1 && (
        <section className="wh-card p-6 space-y-3">
          <div className="flex items-center gap-3">
            {channel.logo_url
              ? <img src={channel.logo_url} alt={channel.name} className="h-12 w-12 rounded-full object-cover border" />
              : <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center font-semibold">{channel.name[0]}</div>}
            <div>
              <div className="font-semibold">{channel.name}</div>
              <div className="text-xs text-muted-foreground">{channel.short_description}</div>
            </div>
          </div>
          <div className="flex gap-2 pt-2"><Badge variant="outline">Verified</Badge>{channel.country_code && <Badge variant="outline">{channel.country_code}</Badge>}</div>
          <div className="pt-3"><Button onClick={() => setStep(2)}>Continue</Button></div>
        </section>
      )}

      {/* Step 2: Objective */}
      {step === 2 && (
        <section className="wh-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-semibold"><Target className="h-4 w-4" /> Choose objective</div>
          {[
            { id: 'visibility', title: 'Increase Visibility', desc: 'Show my channel to more relevant users on WaveLead.' },
            { id: 'follow_intent', title: 'Drive Follow Intent', desc: 'Reach people likely to discover and follow my channel.' },
          ].map((o) => (
            <label key={o.id} className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer ${objective === o.id ? 'border-primary bg-primary/5' : ''}`}>
              <input type="radio" name="objective" checked={objective === o.id} onChange={() => setObjective(o.id as typeof objective)} className="mt-1" />
              <div>
                <div className="font-medium">{o.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{o.desc}</div>
              </div>
            </label>
          ))}
          <div className="flex gap-2 pt-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button onClick={() => setStep(3)}>Continue</Button></div>
        </section>
      )}

      {/* Step 3: Audience */}
      {step === 3 && (
        <section className="wh-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-semibold"><Globe className="h-4 w-4" /> Audience (contextual)</div>
          <p className="text-xs text-muted-foreground">WaveLead promotions target contextual signals only. No behavioural profiling, no sensitive attributes.</p>
          <div>
            <Label>Countries (leave empty for any)</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {countries.slice(0, 20).map((c) => (
                <button type="button" key={c.code} onClick={() => toggle(tCountries, c.code, setTCountries)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${tCountries.includes(c.code) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
                  {c.flag} {c.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Languages</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {['en','id','ms','es','pt','ar','fr','de','hi','ja','ko','zh','ru','it','nl','tr','th','vi'].map((code) => (
                <button type="button" key={code} onClick={() => toggle(tLanguages, code, setTLanguages)}
                  className={`px-2.5 py-1 rounded-full text-xs border uppercase ${tLanguages.includes(code) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
                  {code}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Categories</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {categories.map((c) => (
                <button type="button" key={c.slug} onClick={() => toggle(tCategories, c.slug, setTCategories)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${tCategories.includes(c.slug) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)}>Continue</Button></div>
        </section>
      )}

      {/* Step 4: Placements */}
      {step === 4 && (
        <section className="wh-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" /> Sponsored placements</div>
          <p className="text-xs text-muted-foreground">Sponsored inventory is a separate rendered layer. It does not affect Trending or Top Channels.</p>
          {PLACEMENTS.map((p) => (
            <label key={p.id} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${placements.includes(p.id) ? 'border-primary bg-primary/5' : ''}`}>
              <input type="checkbox" checked={placements.includes(p.id)} onChange={() => toggle(placements, p.id, setPlacements)} className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2"><div className="font-medium text-sm">{p.label}</div><div className="text-xs text-muted-foreground">{dollars(DEFAULT_CPM_USD_MINOR)} CPM</div></div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.hint}</div>
              </div>
            </label>
          ))}
          <div className="flex gap-2 pt-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button disabled={placements.length === 0} onClick={() => setStep(5)}>Continue</Button></div>
        </section>
      )}

      {/* Step 5: Budget */}
      {step === 5 && (
        <section className="wh-card p-6 space-y-4">
          <div className="flex items-center gap-2 font-semibold"><DollarSign className="h-4 w-4" /> Budget & schedule</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total budget (USD)</Label>
              <Input type="number" min={1} value={(budget / 100).toString()} onChange={(e) => setBudget(Math.max(100, Math.round(parseFloat(e.target.value || '0') * 100)))} />
            </div>
            <div>
              <Label>Daily budget (optional)</Label>
              <Input type="number" min={0} value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="—" />
            </div>
            <div>
              <Label>Start</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="font-medium">Estimated delivery ~ {estImpressions.toLocaleString()} impressions</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1"><Info className="h-3.5 w-3.5 mt-0.5" /> Estimated delivery based on current WaveLead rate card. Actual delivery may vary.</div>
          </div>
          <div className="flex gap-2 pt-2"><Button variant="outline" onClick={() => setStep(4)}>Back</Button><Button onClick={() => setStep(6)}>Continue</Button></div>
        </section>
      )}

      {/* Step 6: Review */}
      {step === 6 && (
        <section className="wh-card p-6 space-y-3">
          <div className="font-semibold">Review</div>
          <div>
            <Label>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-muted-foreground text-xs">Objective</div>{objective === 'visibility' ? 'Increase Visibility' : 'Drive Follow Intent'}</div>
            <div><div className="text-muted-foreground text-xs">Placements</div>{placements.length}</div>
            <div><div className="text-muted-foreground text-xs">Total budget</div>{dollars(budget)}</div>
            <div><div className="text-muted-foreground text-xs">Est. impressions</div>~ {estImpressions.toLocaleString()}</div>
            <div><div className="text-muted-foreground text-xs">Countries</div>{tCountries.length ? tCountries.join(', ') : 'Any'}</div>
            <div><div className="text-muted-foreground text-xs">Languages</div>{tLanguages.length ? tLanguages.join(', ').toUpperCase() : 'Any'}</div>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(5)} disabled={submitting}>Back</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting</> : 'Submit for review'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
