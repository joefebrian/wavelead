'use client';
// M17 — Dashboard fallback for a pending paid intent.
//
// Appears ONLY when the user previously clicked a paid CTA while logged out
// and the auth round-trip landed them on /dashboard. It NEVER creates a
// payment or an order: it only links back to the existing pricing surface,
// where the user must deliberately click again. Dismiss clears the stored
// intent (no permanent nagging).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sparkles, X } from 'lucide-react';
import {
  readCommercialIntent, clearCommercialIntent,
  INTENT_DESTINATION, INTENT_LABEL, type CommercialIntent,
} from '@/lib/utils/commercialIntent';

export default function PendingIntentCard() {
  const [intent, setIntent] = useState<CommercialIntent | null>(null);

  useEffect(() => { setIntent(readCommercialIntent()); }, []);

  if (!intent) return null;
  const copy = INTENT_LABEL[intent];

  return (
    <section className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4" data-testid="pending-intent-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
            <Sparkles className="h-4 w-4" /> Pending purchase
          </div>
          <h2 className="mt-1 text-lg font-semibold text-emerald-900">{copy.title}</h2>
          <p className="mt-0.5 text-sm text-emerald-900/80">
            <span className="font-semibold">{copy.price}</span> · {copy.body}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={INTENT_DESTINATION[intent]} data-testid="pending-intent-cta">
            <Button size="sm">{copy.cta}</Button>
          </Link>
          <button
            type="button"
            onClick={() => { clearCommercialIntent(); setIntent(null); }}
            className="rounded-md p-1.5 text-emerald-900/70 hover:bg-emerald-100"
            aria-label="Dismiss"
            data-testid="pending-intent-dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
