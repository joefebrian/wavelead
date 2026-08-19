'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminFxCreateForm() {
  const router = useRouter();
  const [rateScaled, setRateScaled] = useState('16500');
  const [rateScale, setRateScale] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/fx-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rate_scaled: Number(rateScaled),
          rate_scale: Number(rateScale),
          note: note || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok || !b.ok) throw new Error(b.error || 'Failed to create rate');
      router.refresh();
      setNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-sm">
      <label className="flex flex-col">
        <span className="text-xs text-muted-foreground mb-1">rate_scaled</span>
        <input value={rateScaled} onChange={(e) => setRateScaled(e.target.value)} inputMode="numeric" pattern="[0-9]*" required className="rounded-md border px-3 py-2 bg-background" />
      </label>
      <label className="flex flex-col">
        <span className="text-xs text-muted-foreground mb-1">rate_scale (0–8)</span>
        <input value={rateScale} onChange={(e) => setRateScale(e.target.value)} inputMode="numeric" pattern="[0-9]" required className="rounded-md border px-3 py-2 bg-background" />
      </label>
      <label className="flex flex-col sm:col-span-2">
        <span className="text-xs text-muted-foreground mb-1">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. mid-market Aug 2026" className="rounded-md border px-3 py-2 bg-background" />
      </label>
      <div className="sm:col-span-4 flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">
          {busy ? 'Activating…' : 'Add + Activate'}
        </button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </form>
  );
}
