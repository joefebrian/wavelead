'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { countryByCode } from '@/lib/constants/countries';
import { Loader2, Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';

type Section = 'popular' | 'new_noteworthy' | 'featured';

interface Slot {
  id: string;
  section: Section;
  channel_id: string;
  priority: number;
  active: boolean;
  channel_name: string | null;
  channel_slug: string | null;
  channel_country_code: string | null;
}

interface ApprovedOpt {
  id: string;
  name: string;
  slug: string;
  country_code: string | null;
  follower_count: number;
}

interface Props {
  initialSlots: Slot[];
  approved: ApprovedOpt[];
}

const SECTIONS: { key: Section; title: string; blurb: string }[] = [
  { key: 'popular', title: 'Popular on WaveLead', blurb: 'Fills the “Popular on WaveLead” homepage row.' },
  { key: 'new_noteworthy', title: 'New & Noteworthy', blurb: 'Fresh channels worth a look.' },
  { key: 'featured', title: 'Featured', blurb: 'Editorial highlights.' },
];

export default function CurationClient({ initialSlots, approved }: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<Section | null>(null);
  const [addChannel, setAddChannel] = useState('');
  const [addPriority, setAddPriority] = useState<number>(100);
  const [addFilter, setAddFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const bySection = useMemo(() => {
    const map: Record<Section, Slot[]> = { popular: [], new_noteworthy: [], featured: [] };
    slots.forEach((s) => map[s.section].push(s));
    (Object.keys(map) as Section[]).forEach((k) => map[k].sort((a, b) => a.priority - b.priority));
    return map;
  }, [slots]);

  const slottedIdsBySection = useMemo(() => {
    const m: Record<Section, Set<string>> = { popular: new Set(), new_noteworthy: new Set(), featured: new Set() };
    slots.forEach((s) => m[s.section].add(s.channel_id));
    return m;
  }, [slots]);

  function refresh() { startTransition(() => router.refresh()); }

  async function updateSlot(id: string, patch: { priority?: number; active?: boolean }) {
    setError(null); setBusyId(id);
    try {
      const r = await fetch(`/api/admin/homepage/slots/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Update failed'); return; }
      setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      refresh();
    } finally { setBusyId(null); }
  }

  async function removeSlot(id: string) {
    if (!confirm('Remove this channel from the section?')) return;
    setError(null); setBusyId(id);
    try {
      const r = await fetch(`/api/admin/homepage/slots/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Remove failed'); return; }
      setSlots((prev) => prev.filter((s) => s.id !== id));
      refresh();
    } finally { setBusyId(null); }
  }

  async function addSlot(section: Section) {
    if (!addChannel) return;
    setError(null); setAdding(true);
    try {
      const r = await fetch('/api/admin/homepage/slots', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, channel_id: addChannel, priority: Number(addPriority) || 100 }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not add slot'); return; }
      const ch = approved.find((a) => a.id === addChannel);
      const newSlot: Slot = {
        id: j.data.slot.id, section, channel_id: addChannel,
        priority: j.data.slot.priority, active: true,
        channel_name: ch?.name ?? null, channel_slug: ch?.slug ?? null,
        channel_country_code: ch?.country_code ?? null,
      };
      setSlots((prev) => [...prev, newSlot]);
      setAddChannel(''); setAddPriority(100); setAddFor(null); setAddFilter('');
      refresh();
    } finally { setAdding(false); }
  }

  function move(section: Section, id: string, dir: -1 | 1) {
    const list = bySection[section];
    const idx = list.findIndex((s) => s.id === id);
    const target = list[idx + dir];
    if (!target) return;
    const a = list[idx];
    const swappedA = { priority: target.priority };
    const swappedB = { priority: a.priority };
    Promise.all([updateSlot(a.id, swappedA), updateSlot(target.id, swappedB)]);
  }

  return (
    <div className="mt-6 grid gap-6">
      {error && (
        <div className="wh-card border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {error}
        </div>
      )}

      {SECTIONS.map((sec) => {
        const list = bySection[sec.key];
        const isAdding = addFor === sec.key;
        const availableOptions = approved
          .filter((a) => !slottedIdsBySection[sec.key].has(a.id))
          .filter((a) => a.name.toLowerCase().includes(addFilter.toLowerCase()));

        return (
          <div key={sec.key} className="wh-card p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-bold">{sec.title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{sec.blurb}</p>
              </div>
              <Button size="sm" onClick={() => { setAddFor(isAdding ? null : sec.key); setAddChannel(''); setAddFilter(''); setAddPriority(100); }}>
                {isAdding ? 'Close' : (<><Plus className="h-4 w-4 mr-1" /> Add channel</>)}
              </Button>
            </div>

            {isAdding && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end border-t border-border/60 pt-4">
                <div>
                  <Label htmlFor={`filter-${sec.key}`}>Approved channel</Label>
                  <Input id={`filter-${sec.key}`} placeholder="Filter approved channels by name…" value={addFilter} onChange={(e) => setAddFilter(e.target.value)} className="mt-1.5" />
                  <select value={addChannel} onChange={(e) => setAddChannel(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm">
                    <option value="">— Choose approved channel —</option>
                    {availableOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.country_code || ''} · {a.follower_count.toLocaleString()} followers</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`p-${sec.key}`}>Priority</Label>
                  <Input id={`p-${sec.key}`} type="number" min={0} max={1000} value={addPriority} onChange={(e) => setAddPriority(parseInt(e.target.value || '100', 10))} className="mt-1.5" />
                </div>
                <Button onClick={() => addSlot(sec.key)} disabled={!addChannel || adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />} Add
                </Button>
                <p className="sm:col-span-3 text-xs text-muted-foreground">Only approved channels can be curated. Lower priority number appears first.</p>
              </div>
            )}

            {list.length === 0 ? (
              <div className="mt-4 text-sm text-muted-foreground border border-dashed border-border rounded-md p-4">
                No manual slots. This section auto-fills from algorithmic ranking.
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border/60">
                {list.map((s, i) => {
                  const country = countryByCode(s.channel_country_code);
                  return (
                    <li key={s.id} className="py-3 flex items-center gap-3">
                      <div className="w-8 text-center text-sm font-bold text-muted-foreground">{i + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold truncate">{s.channel_name || '—'}</span>
                          {country && <Badge variant="outline">{country.flag} {country.code}</Badge>}
                          {!s.active && <Badge variant="secondary">Inactive</Badge>}
                          <Badge variant="outline">priority {s.priority}</Badge>
                        </div>
                        {s.channel_slug && <Link href={`/channel/${s.channel_slug}`} className="text-xs text-primary">/channel/{s.channel_slug}</Link>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" title="Move up" onClick={() => move(sec.key, s.id, -1)} disabled={i === 0 || busyId === s.id}><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title="Move down" onClick={() => move(sec.key, s.id, 1)} disabled={i === list.length - 1 || busyId === s.id}><ArrowDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" title={s.active ? 'Deactivate' : 'Activate'} onClick={() => updateSlot(s.id, { active: !s.active })} disabled={busyId === s.id}>
                          {s.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Remove" onClick={() => removeSlot(s.id)} disabled={busyId === s.id}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
