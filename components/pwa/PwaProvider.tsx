'use client';

// WaveLead PWA provider:
//   • service-worker registration + user-controlled update flow
//   • native install prompt capture (beforeinstallprompt / appinstalled)
//   • standalone detection, offline indicator
//   • engagement-gated automatic install suggestion
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { WifiOff, Wifi } from 'lucide-react';
import { trackGa4Event } from '@/lib/analytics/events';
import {
  detectPwaPlatform, installModeFor, isMobilePlatform, isSensitiveLocation, shouldAutoSuggest,
  type InstallMode, type PwaPlatform,
} from '@/lib/pwa/platform';
import InstallSheet from './InstallSheet';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}
declare global {
  interface Window { __wlBip?: BeforeInstallPromptEvent | null; __wlInstalled?: boolean }
  interface Navigator { standalone?: boolean }
}

export type InstallTrigger = 'auto' | 'menu' | 'footer';

interface PwaContextValue {
  platform: PwaPlatform;
  standalone: boolean;
  mode: InstallMode;
  /** True when a real install path (native or guided) exists on this device. */
  canOfferInstall: boolean;
  openInstall: (trigger: InstallTrigger) => void;
}

const PwaContext = createContext<PwaContextValue>({
  platform: 'unknown', standalone: false, mode: 'none', canOfferInstall: false, openInstall: () => {},
});
export const usePwa = () => useContext(PwaContext);

const K_DISMISSED = 'wl_pwa_dismissed_at';     // localStorage
const K_SHOWN = 'wl_pwa_auto_shown';           // sessionStorage
const K_PAGES = 'wl_pwa_pages';                // sessionStorage
const K_START = 'wl_pwa_session_start';        // sessionStorage
const K_STANDALONE = 'wl_pwa_standalone_tracked';

function ss(): Storage | null { try { return window.sessionStorage; } catch { return null; } }
function ls(): Storage | null { try { return window.localStorage; } catch { return null; } }

function detectStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

/** Something else is already asking for the user's attention. */
function attentionBusy(): boolean {
  if (document.querySelector('[data-testid="consent-banner"]')) return true;
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return true;
  return document.visibilityState !== 'visible';
}

export default function PwaProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const [platform, setPlatform] = useState<PwaPlatform>('unknown');
  const [standalone, setStandalone] = useState(false);
  const [bip, setBip] = useState<BeforeInstallPromptEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [trigger, setTrigger] = useState<InstallTrigger>('menu');
  const [online, setOnline] = useState(true);
  const [backOnline, setBackOnline] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);
  const updateToastRef = useRef<string | number | null>(null);

  // ---- platform / standalone / install events ---------------------------
  useEffect(() => {
    const p = detectPwaPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
    setPlatform(p);
    const sa = detectStandalone();
    setStandalone(sa);
    if (sa && !ss()?.getItem(K_STANDALONE)) {
      ss()?.setItem(K_STANDALONE, '1');
      trackGa4Event('pwa_standalone_launched', { pwa_platform: p });
    }
    if (window.__wlBip) setBip(window.__wlBip);
    const onBip = () => setBip(window.__wlBip || null);
    const onInstalled = () => {
      setBip(null);
      setSheetOpen(false);
      trackGa4Event('pwa_app_installed', { pwa_platform: p });
      toast.success('WaveLead was added to your home screen.');
    };
    window.addEventListener('wl:bip', onBip);
    window.addEventListener('wl:appinstalled', onInstalled);
    let mq: MediaQueryList | null = null;
    const onMode = () => setStandalone(detectStandalone());
    try { mq = window.matchMedia('(display-mode: standalone)'); mq.addEventListener('change', onMode); } catch { /* old Safari */ }
    return () => {
      window.removeEventListener('wl:bip', onBip);
      window.removeEventListener('wl:appinstalled', onInstalled);
      try { mq?.removeEventListener('change', onMode); } catch { /* noop */ }
    };
  }, []);

  // ---- service worker registration + updates ---------------------------
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    let reg: ServiceWorkerRegistration | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const markWaiting = (w: ServiceWorker | null) => {
      if (w && navigator.serviceWorker.controller) { waitingRef.current = w; setUpdateReady(true); }
    };
    const onControllerChange = () => {
      if (!reloadingRef.current) return;   // only reload when the user asked for the update
      reloadingRef.current = false;
      window.location.reload();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reg?.update().catch(() => {}); };

    const register = async () => {
      try {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        markWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg?.installing;
          nw?.addEventListener('statechange', () => { if (nw.state === 'installed') markWaiting(nw); });
        });
        interval = setInterval(() => reg?.update().catch(() => {}), 60 * 60 * 1000);
        document.addEventListener('visibilitychange', onVisible);
      } catch { /* registration failure never affects the site */ }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // Update notice — never on login / checkout / booking / dashboards, never forced.
  useEffect(() => {
    if (!updateReady) return;
    const sensitive = isSensitiveLocation(pathname, window.location.search);
    if (sensitive) {
      if (updateToastRef.current !== null) { toast.dismiss(updateToastRef.current); updateToastRef.current = null; }
      return;
    }
    if (updateToastRef.current !== null) return;
    updateToastRef.current = toast('A new version of WaveLead is available', {
      duration: Infinity,
      action: {
        label: 'Refresh',
        onClick: () => {
          const w = waitingRef.current;
          if (!w) { window.location.reload(); return; }
          reloadingRef.current = true;
          w.postMessage({ type: 'SKIP_WAITING' });
        },
      },
      onDismiss: () => { updateToastRef.current = null; },
    });
  }, [updateReady, pathname]);

  // ---- offline indicator -------------------------------------------------
  useEffect(() => {
    setOnline(navigator.onLine);
    let t: ReturnType<typeof setTimeout> | null = null;
    const up = () => { setOnline(true); setBackOnline(true); t = setTimeout(() => setBackOnline(false), 3000); };
    const down = () => { setOnline(false); setBackOnline(false); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); if (t) clearTimeout(t); };
  }, []);

  // ---- engagement tracking (distinct pages + time) -----------------------
  useEffect(() => {
    const s = ss(); if (!s) return;
    if (!s.getItem(K_START)) s.setItem(K_START, String(Date.now()));
    let pages: string[] = [];
    try { pages = JSON.parse(s.getItem(K_PAGES) || '[]'); } catch { pages = []; }
    if (!pages.includes(pathname)) { pages.push(pathname); s.setItem(K_PAGES, JSON.stringify(pages.slice(-20))); }
  }, [pathname]);

  const mode = installModeFor(platform, !!bip, standalone);
  const canOfferInstall = isMobilePlatform(platform) && mode !== 'none';

  const openInstall = useCallback((t: InstallTrigger) => {
    setTrigger(t);
    setSheetOpen(true);
  }, []);

  // ---- automatic suggestion ---------------------------------------------
  useEffect(() => {
    if (standalone || !isMobilePlatform(platform)) return;
    const check = () => {
      if (sheetOpen) return;
      const s = ss(); const l = ls();
      let pages: string[] = [];
      try { pages = JSON.parse(s?.getItem(K_PAGES) || '[]'); } catch { pages = []; }
      const start = Number(s?.getItem(K_START) || Date.now());
      const dismissed = Number(l?.getItem(K_DISMISSED) || 0) || null;
      const ok = shouldAutoSuggest({
        platform, nativePromptAvailable: !!bip, standalone, pathname, search: window.location.search,
        distinctPages: pages.length, engagedMs: Date.now() - start,
        shownThisSession: s?.getItem(K_SHOWN) === '1', dismissedAt: dismissed, now: Date.now(),
      });
      if (!ok || attentionBusy()) return;
      s?.setItem(K_SHOWN, '1');
      openInstall('auto');
    };
    const id = setInterval(check, 5000);
    check();
    return () => clearInterval(id);
  }, [platform, bip, standalone, pathname, sheetOpen, openInstall]);

  const dismiss = useCallback(() => {
    ls()?.setItem(K_DISMISSED, String(Date.now()));
    setSheetOpen(false);
  }, []);

  const runNativePrompt = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const ev = bip;
    if (!ev) return 'unavailable';
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      window.__wlBip = null;
      setBip(null);                          // a prompt event can only be used once
      if (choice.outcome === 'accepted') {
        trackGa4Event('pwa_install_prompt_accepted', { pwa_platform: platform });
        return 'accepted';
      }
      trackGa4Event('pwa_install_prompt_dismissed', { pwa_platform: platform });
      ls()?.setItem(K_DISMISSED, String(Date.now()));
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [bip, platform]);

  const value = useMemo<PwaContextValue>(() => ({ platform, standalone, mode, canOfferInstall, openInstall }),
    [platform, standalone, mode, canOfferInstall, openInstall]);

  return (
    <PwaContext.Provider value={value}>
      {children}
      {sheetOpen && mode !== 'none' && (
        <InstallSheet
          mode={mode}
          platform={platform}
          trigger={trigger}
          onClose={() => setSheetOpen(false)}
          onNotNow={dismiss}
          onNativeInstall={runNativePrompt}
        />
      )}
      {(!online || backOnline) && (
        <div
          role="status"
          aria-live="polite"
          data-testid={online ? 'pwa-back-online' : 'pwa-offline-indicator'}
          className="fixed left-1/2 -translate-x-1/2 z-[60] bottom-[calc(1rem+env(safe-area-inset-bottom))] flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-xs font-medium shadow-md backdrop-blur"
        >
          {online ? <Wifi className="h-3.5 w-3.5 text-primary" /> : <WifiOff className="h-3.5 w-3.5 text-amber-600" />}
          {online ? 'Back online' : 'You’re offline — reconnect to load the latest data'}
        </div>
      )}
    </PwaContext.Provider>
  );
}
