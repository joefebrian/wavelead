'use client';
// M11-Batch3 — Consent banner + preferences modal.
//
// Behaviour:
//   • On mount, GET /api/consent to determine whether a decision exists.
//     If not → render the banner (compact bottom-anchored card).
//   • Buttons: Accept All / Reject Non-Essential / Manage Preferences.
//     Analytics is NOT pre-checked in the modal; Reject Non-Essential is
//     equally functional (single POST that persists analytics=false).
//   • Footer trigger (window event 'wl:open-cookie-preferences') re-opens
//     the same modal so users can enable / disable / withdraw consent.
import { useCallback, useEffect, useState } from 'react';
import { X, Cookie } from 'lucide-react';

interface ConsentState {
  necessary: true;
  analytics: boolean;
  policy_version: number;
  consented_at: string;
  updated_at: string;
}

async function fetchConsent(): Promise<{ consent: ConsentState | null }> {
  const res = await fetch('/api/consent', { credentials: 'include' });
  const j = (await res.json().catch(() => ({}))) as { data?: { consent?: ConsentState | null } };
  return { consent: j.data?.consent ?? null };
}

async function saveConsent(analytics: boolean): Promise<ConsentState | null> {
  const res = await fetch('/api/consent', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analytics }),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { consent?: ConsentState | null } };
  return j.data?.consent ?? null;
}

export default function ConsentBanner() {
  const [state, setState] = useState<ConsentState | null | 'loading'>('loading');
  const [managerOpen, setManagerOpen] = useState(false);
  const [analyticsPref, setAnalyticsPref] = useState(false); // NOT pre-checked
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchConsent();
      setState(r.consent);
      if (r.consent) setAnalyticsPref(!!r.consent.analytics);
    } catch { setState(null); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    function open() { setManagerOpen(true); }
    window.addEventListener('wl:open-cookie-preferences', open);
    return () => window.removeEventListener('wl:open-cookie-preferences', open);
  }, []);

  async function commit(analytics: boolean) {
    setBusy(true);
    try {
      const next = await saveConsent(analytics);
      if (next) setState(next);
      setManagerOpen(false);
    } finally { setBusy(false); }
  }

  const bannerVisible = state === null; // no cookie yet → show banner
  const showManager = managerOpen;

  return (
    <>
      {bannerVisible && (
        <div
          role="dialog" aria-live="polite" aria-label="Cookie preferences"
          data-testid="consent-banner"
          className="fixed inset-x-3 bottom-3 z-[70] md:left-auto md:right-4 md:bottom-4 md:max-w-lg rounded-lg border border-border bg-background/95 backdrop-blur shadow-xl p-4"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary shrink-0">
              <Cookie className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">WaveLead uses cookies</div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                We use necessary cookies to keep WaveLead working and, with your permission, analytics cookies to
                understand how people discover and use WaveLead.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button" disabled={busy} onClick={() => commit(true)}
                  data-testid="consent-accept-all"
                  className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >Accept All</button>
                <button
                  type="button" disabled={busy} onClick={() => commit(false)}
                  data-testid="consent-reject-non-essential"
                  className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
                >Reject Non-Essential</button>
                <button
                  type="button" disabled={busy} onClick={() => setManagerOpen(true)}
                  data-testid="consent-manage"
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                >Manage Preferences</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showManager && (
        <div
          role="dialog" aria-modal="true" aria-label="Manage cookie preferences"
          data-testid="consent-manager"
          className="fixed inset-0 z-[80] grid place-items-center bg-foreground/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setManagerOpen(false); }}
        >
          <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="font-semibold">Cookie Preferences</div>
              <button type="button" onClick={() => setManagerOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Necessary</div>
                    <p className="text-xs text-muted-foreground mt-0.5">Session, security, and remembering your cookie choice. Always on.</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-700">Always on</span>
                </div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">Analytics</div>
                    <p className="text-xs text-muted-foreground mt-0.5">First-party, aggregated understanding of how people discover and use WaveLead. Off by default.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox" data-testid="consent-analytics-toggle"
                      checked={analyticsPref} onChange={(e) => setAnalyticsPref(e.target.checked)}
                    />
                    <span className="text-xs">{analyticsPref ? 'On' : 'Off'}</span>
                  </label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                No marketing / retargeting cookies, no session replay, no browser fingerprinting.
              </p>
            </div>
            <div className="p-4 border-t border-border flex flex-wrap gap-2 justify-end">
              <button
                type="button" onClick={() => setManagerOpen(false)}
                data-testid="consent-manager-cancel"
                className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
              >Cancel</button>
              <button
                type="button" disabled={busy} onClick={() => commit(analyticsPref)}
                data-testid="consent-manager-save"
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >Save Preferences</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
