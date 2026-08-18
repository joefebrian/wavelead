'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PLACEMENTS = [
  'sponsored_search', 'sponsored_homepage', 'sponsored_category', 'sponsored_country', 'sponsored_related_channel',
];

export default function RateCardForm() {
  const router = useRouter();
  const [placement, setPlacement] = useState(PLACEMENTS[0]);
  const [country, setCountry] = useState('');
  const [cpm, setCpm] = useState('2.00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/admin/promotion-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placement, country_code: country ? country.toUpperCase() : null,
          cpm_usd_minor: Math.round(parseFloat(cpm) * 100),
          active: true,
        }),
      }).then((r) => r.json());
      if (!r.ok) throw new Error(r.error || 'Failed');
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 wh-card p-4 space-y-3">
      <div className="font-semibold">Add / update rate</div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Placement</Label>
          <select value={placement} onChange={(e) => setPlacement(e.target.value)} className="w-full text-sm rounded border px-2 py-1.5 bg-background">
            {PLACEMENTS.map((p) => <option key={p} value={p}>{p.replace('sponsored_', '')}</option>)}
          </select>
        </div>
        <div>
          <Label>Country (ISO alpha-2, blank = global)</Label>
          <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="ID / US / —" />
        </div>
        <div>
          <Label>CPM (USD)</Label>
          <Input type="number" step="0.01" min="0.01" value={cpm} onChange={(e) => setCpm(e.target.value)} />
        </div>
      </div>
      {err && <div className="text-sm text-destructive">{err}</div>}
      <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save rate card'}</Button>
    </div>
  );
}
