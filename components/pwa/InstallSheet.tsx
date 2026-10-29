'use client';

// Compact, mobile-first install bottom sheet. Every action does what it says:
// the native button calls the browser's real install prompt; iOS and other
// browsers get accurate manual steps (no fake prompt, no fake success).
import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Share, SquarePlus, ToggleRight, Home, AppWindow, Store, MoreVertical, Compass, Copy, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InstallMode, IosBrowser, PwaPlatform } from '@/lib/pwa/platform';
import { trackGa4EventOnce, type Ga4Params } from '@/lib/analytics/events';
import { baseParams, type InstallOpenContext, type InstallTrigger } from './PwaProvider';

interface Props {
  mode: InstallMode;
  platform: PwaPlatform;
  iosBrowser: IosBrowser;
  trigger: InstallTrigger;
  openCtx: InstallOpenContext | null;
  onClose: () => void;
  onNotNow: () => void;
  onNativeInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n}</span>
      <span className="flex-1 text-sm leading-snug text-foreground">{children}</span>
      <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>{icon}</span>
    </li>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = window.location.origin + window.location.pathname;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt('Copy this link', url); }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="mt-3 w-full" data-testid="pwa-copy-link">
      {copied ? <Check className="mr-1.5 h-4 w-4 text-primary" /> : <Copy className="mr-1.5 h-4 w-4" />}
      {copied ? 'Link copied' : 'Copy WaveLead link'}
    </Button>
  );
}

export default function InstallSheet({ mode, platform, iosBrowser, trigger, openCtx, onClose, onNotNow, onNativeInstall }: Props) {
  const [view, setView] = useState<'intro' | 'steps' | 'installing'>('intro');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const isIos = platform.startsWith('ios');
  const method = mode === 'native' ? 'native_prompt' : 'manual_a2hs';
  const ev = (extra: Ga4Params = {}): Ga4Params => ({
    ...baseParams(platform), pwa_entry_point: openCtx?.entry_point, pwa_trigger: openCtx?.trigger, ...extra,
  });
  const oid = openCtx?.openId || 'x';
  const iosSteps = () => {
    // Instructions actually displayed on iOS (any browser). Never an install.
    if (isIos) trackGa4EventOnce(`pwa_ios_instr:${oid}`, 'pwa_ios_instructions_viewed', ev({ pwa_install_method: 'manual_a2hs' }));
  };

  useEffect(() => {
    // One impression per sheet opening (strict-mode / re-render safe).
    trackGa4EventOnce(`pwa_viewed:${oid}`, 'pwa_install_cta_viewed', ev());
    // iOS modes that show the steps immediately (no intro step).
    if (mode === 'ios_open_in_safari' || (mode === 'open_in_browser' && isIos)) iosSteps();
    const t = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid]);

  async function primary() {
    trackGa4EventOnce(`pwa_click:${oid}`, 'pwa_install_cta_clicked', ev({ pwa_install_method: method }));
    if (mode === 'native') {
      setBusy(true);
      const r = await onNativeInstall();
      setBusy(false);
      if (r === 'accepted') setView('installing');
      else if (r === 'dismissed') onClose();
      else setView('steps'); // prompt no longer available → honest manual steps
      return;
    }
    if (mode === 'ios_safari' || mode === 'ios_share') iosSteps();
    setView('steps');
  }

  const steps = (() => {
    switch (mode) {
      case 'ios_safari':
        return (
          <ol className="space-y-3" data-testid="pwa-ios-steps">
            <Step n={1} icon={<Share className="h-4 w-4" />}>Tap <strong>Share</strong> in Safari&rsquo;s toolbar. On newer Safari, tap the <strong>•••</strong> page menu first, then <strong>Share</strong>.</Step>
            <Step n={2} icon={<SquarePlus className="h-4 w-4" />}>Scroll down and choose <strong>Add to Home Screen</strong>.</Step>
            <Step n={3} icon={<ToggleRight className="h-4 w-4" />}>Keep <strong>Open as Web App</strong> switched on if you see it.</Step>
            <Step n={4} icon={<Home className="h-4 w-4" />}>Tap <strong>Add</strong>, then open WaveLead from your Home Screen.</Step>
          </ol>
        );
      case 'ios_share':
        return (
          <ol className="space-y-3" data-testid={`pwa-ios-share-steps-${iosBrowser}`}>
            {iosBrowser === 'chrome' ? (
              <Step n={1} icon={<Share className="h-4 w-4" />}>Tap the <strong>Share</strong> icon in Chrome&rsquo;s address bar.</Step>
            ) : (
              <Step n={1} icon={<MoreVertical className="h-4 w-4" />}>Open the <strong>{iosBrowser === 'edge' ? '•••' : '☰'}</strong> menu, then tap <strong>Share</strong>.</Step>
            )}
            <Step n={2} icon={<SquarePlus className="h-4 w-4" />}>Choose <strong>Add to Home Screen</strong> (scroll down if needed).</Step>
            <Step n={3} icon={<ToggleRight className="h-4 w-4" />}>Keep <strong>Open as Web App</strong> switched on if you see it.</Step>
            <Step n={4} icon={<Home className="h-4 w-4" />}>Tap <strong>Add</strong>, then open WaveLead from your Home Screen.</Step>
            <li className="pt-1 text-xs text-muted-foreground">Don&rsquo;t see Add to Home Screen? Open wavelead.org in Safari and use Share there.</li>
          </ol>
        );
      case 'ios_open_in_safari':
        return (
          <div data-testid="pwa-open-in-safari">
            <ol className="space-y-3">
              <Step n={1} icon={<Copy className="h-4 w-4" />}>Copy the WaveLead link below.</Step>
              <Step n={2} icon={<Compass className="h-4 w-4" />}>Open <strong>Safari</strong> and paste it into the address bar.</Step>
              <Step n={3} icon={<Share className="h-4 w-4" />}>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> → <strong>Add</strong>.</Step>
            </ol>
            <CopyLink />
          </div>
        );
      case 'open_in_browser':
        return (
          <div data-testid="pwa-open-in-browser">
            <p className="text-sm text-muted-foreground">This in-app browser can&rsquo;t install apps.</p>
            <ol className="mt-3 space-y-3">
              <Step n={1} icon={<MoreVertical className="h-4 w-4" />}>Tap the <strong>•••</strong> or <strong>⋮</strong> menu and choose <strong>Open in browser</strong> ({platform === 'ios_in_app' ? 'Safari' : 'Chrome'}).</Step>
              <Step n={2} icon={<SquarePlus className="h-4 w-4" />}>Then use <strong>Install WaveLead</strong> from the menu there.</Step>
            </ol>
            <CopyLink />
          </div>
        );
      case 'android_manual':
      case 'native':
      default:
        return (
          <div data-testid="pwa-android-steps">
            <ol className="space-y-3">
              <Step n={1} icon={<MoreVertical className="h-4 w-4" />}>Tap your browser&rsquo;s <strong>⋮</strong> menu.</Step>
              <Step n={2} icon={<SquarePlus className="h-4 w-4" />}>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</Step>
              <Step n={3} icon={<Home className="h-4 w-4" />}>Confirm, then open WaveLead from your home screen.</Step>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">If neither option appears, WaveLead may already be installed, or this browser doesn&rsquo;t support installing apps.</p>
          </div>
        );
    }
  })();

  const showIntro = view === 'intro' && (mode === 'native' || mode === 'ios_safari' || mode === 'ios_share');
  const primaryLabel = 'Install WaveLead';

  return (
    <div className="fixed inset-0 z-[70]" data-testid="pwa-install-sheet">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-foreground/20 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-sheet-title"
        className={`absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-2xl border border-b-0 border-border bg-card text-card-foreground shadow-[0_-8px_30px_rgba(16,35,63,0.12)] transition-transform duration-300 ease-out ${shown ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-3">
            <Image src="/icons/icon-192.png" alt="" width={48} height={48} className="rounded-xl border border-border/60" />
            <div className="min-w-0">
              <h2 id="pwa-sheet-title" className="text-base font-semibold leading-tight">Get WaveLead App</h2>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                Grow, manage, and monetize your WhatsApp Channels — right from your home screen.
              </p>
            </div>
          </div>

          {view === 'installing' ? (
            <div className="mt-5 rounded-lg bg-primary/5 px-4 py-3 text-sm" data-testid="pwa-installing">
              Installing… WaveLead will appear on your home screen once your browser finishes.
            </div>
          ) : (
            <>
              {showIntro ? (
                <ul className="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="pwa-benefits">
                  {[
                    { icon: <Home className="h-4 w-4" />, label: 'Quick access from your home screen' },
                    { icon: <AppWindow className="h-4 w-4" />, label: 'Standalone app experience' },
                    { icon: <Store className="h-4 w-4" />, label: 'No app store required' },
                  ].map((b) => (
                    <li key={b.label} className="rounded-lg border border-border/70 px-2 py-2.5">
                      <span className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">{b.icon}</span>
                      <span className="block text-[11px] leading-tight text-muted-foreground">{b.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4">{steps}</div>
              )}

              {(mode === 'ios_safari' || mode === 'ios_share') && view === 'steps' && (
                <p className="mt-3 text-xs text-muted-foreground">WaveLead then opens full-screen like an app, without Safari&rsquo;s address bar.</p>
              )}

              <div className="mt-5 flex gap-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={onNotNow} data-testid="pwa-not-now">Not Now</Button>
                {showIntro ? (
                  <Button ref={primaryRef} type="button" className="flex-[1.4]" onClick={primary} disabled={busy} data-testid="pwa-install-primary">
                    {busy ? 'Opening…' : primaryLabel}
                  </Button>
                ) : (
                  <Button type="button" className="flex-[1.4]" onClick={onClose} data-testid="pwa-done">Done</Button>
                )}
              </div>
            </>
          )}
          {view === 'installing' && (
            <Button type="button" variant="outline" className="mt-4 w-full" onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}
