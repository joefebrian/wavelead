'use client';
import { useEffect, useState } from 'react';

interface Preview {
  idr_whole: number;
  rate: { rate_scaled: number; rate_scale: number; source_rate_id: string };
}

function formatIdr(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp${abs}`;
}

function formatRate(scaled: number, scale: number): string {
  if (scale === 0) return scaled.toLocaleString('id-ID');
  const s = scaled.toString().padStart(scale + 1, '0');
  const whole = s.slice(0, -scale) || '0';
  const frac = s.slice(-scale).replace(/0+$/, '');
  return frac ? `${Number(whole).toLocaleString('id-ID')}.${frac}` : Number(whole).toLocaleString('id-ID');
}

export default function IdrEquivalentPanel({ campaignId }: { campaignId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner/campaigns/${campaignId}/fx-preview`);
        const b = await res.json();
        if (cancelled) return;
        if (!res.ok || !b.ok) throw new Error(b.error || 'Failed');
        setPreview(b.data.preview);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  if (loading) return null;
  if (error || !preview) return null;

  return (
    <div className="mt-3 rounded-md border border-dashed p-3 bg-muted/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-xs text-muted-foreground">IDR equivalent</div>
          <div className="text-lg font-semibold">{formatIdr(preview.idr_whole)}</div>
        </div>
        <div className="text-xs text-muted-foreground text-right">
          Conversion<br />
          $1 = Rp{formatRate(preview.rate.rate_scaled, preview.rate.rate_scale)}
        </div>
      </div>
      <div className="mt-3 rounded-md bg-background border p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Local Payment</div>
          <div className="text-xs text-muted-foreground">Indonesian rupiah checkout</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{formatIdr(preview.idr_whole)}</span>
          <button type="button" disabled aria-disabled="true" className="rounded-md border px-3 py-1.5 text-sm bg-muted text-muted-foreground cursor-not-allowed" title="Local payment methods coming soon">
            Coming Soon
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Local payment methods (QRIS, bank transfer, e-wallets) are not yet available. Use PayPal above to fund this campaign.</p>
    </div>
  );
}
