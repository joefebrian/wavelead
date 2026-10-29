// PWA — platform detection, install-mode and automatic-suggestion gating.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectPwaPlatform, detectIosBrowser, iosVersion, iosThirdPartyCanInstall, installModeFor, isSensitiveLocation, isAutoSuggestPath, shouldAutoSuggest,
  autoSuggestTrigger, ga4Platform, ga4Browser, AUTO_TIME_MS, AUTO_SECOND_PAGE_MS, DISMISS_SUPPRESS_MS,
} from '@/lib/pwa/platform';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 349.0.0',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
  iosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

describe('platform detection', () => {
  it('classifies the major browsers', () => {
    expect(detectPwaPlatform(UA.androidChrome)).toBe('android_chromium');
    expect(detectPwaPlatform(UA.samsung)).toBe('android_chromium');
    expect(detectPwaPlatform(UA.androidFirefox)).toBe('android_other');
    expect(detectPwaPlatform(UA.androidInstagram)).toBe('android_in_app');
    expect(detectPwaPlatform(UA.iosSafari)).toBe('ios_safari');
    expect(detectPwaPlatform(UA.ipadOS, 5)).toBe('ios_safari');
    expect(detectPwaPlatform(UA.iosChrome)).toBe('ios_other_browser');
    expect(detectPwaPlatform(UA.iosFacebook)).toBe('ios_in_app');
    expect(detectPwaPlatform(UA.iosWebView)).toBe('ios_in_app');
    expect(detectPwaPlatform(UA.desktopChrome)).toBe('desktop');
    expect(detectPwaPlatform(UA.macSafari, 0)).toBe('desktop');
    expect(detectPwaPlatform('')).toBe('unknown');
  });
});

describe('install mode', () => {
  it('uses the native prompt only when captured, never on iOS', () => {
    expect(installModeFor('android_chromium', true, false)).toBe('native');
    expect(installModeFor('android_chromium', false, false)).toBe('android_manual');
    expect(installModeFor('ios_safari', true, false)).toBe('ios_safari');
    expect(installModeFor('ios_other_browser', false, false)).toBe('ios_open_in_safari');
    expect(installModeFor('ios_other_browser', false, false, true)).toBe('ios_share');
  });
  it('iOS third-party browsers: share-sheet install on iOS 16.4+, Safari otherwise', () => {
    expect(detectIosBrowser(UA.iosChrome)).toBe('chrome');
    expect(iosVersion(UA.iosChrome)).toBe(18);
    expect(iosThirdPartyCanInstall(UA.iosChrome)).toBe(true);
    const edge164 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/605.1.15';
    const ff163 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15';
    const ddg = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15';
    expect(iosThirdPartyCanInstall(edge164)).toBe(true);
    expect(iosThirdPartyCanInstall(ff163)).toBe(false);
    expect(iosThirdPartyCanInstall(ddg)).toBe(false);
    expect(iosThirdPartyCanInstall(UA.iosSafari)).toBe(false); // Safari uses its own mode
    expect(installModeFor('ios_in_app', false, false)).toBe('open_in_browser');
    expect(installModeFor('android_in_app', false, false)).toBe('open_in_browser');
  });
  it('shows nothing when installed or on desktop', () => {
    expect(installModeFor('android_chromium', true, true)).toBe('none');
    expect(installModeFor('ios_safari', false, true)).toBe('none');
    expect(installModeFor('desktop', false, false)).toBe('none');
  });
});

describe('sensitive flows', () => {
  it('blocks auth, onboarding, payments, booking, claims, dashboards, admin', () => {
    for (const p of ['/login', '/signup', '/auth/google/callback', '/dashboard', '/dashboard/billing', '/sponsor/abc', '/claim/abc',
      '/submit', '/pricing', '/admin/claims', '/dashboard/channels/1/verify', '/go/x']) {
      expect(isSensitiveLocation(p)).toBe(true);
      expect(isAutoSuggestPath(p)).toBe(false);
    }
    expect(isSensitiveLocation('/channels', '?token=EC-123&PayerID=X')).toBe(true);
    expect(isSensitiveLocation('/', '?status=cancelled')).toBe(true);
  });
  it('allows discovery pages only', () => {
    for (const p of ['/', '/channels', '/channel/los40', '/categories', '/category/news', '/trending', '/top', '/search', '/for-brands']) {
      expect(isAutoSuggestPath(p)).toBe(true);
    }
    expect(isAutoSuggestPath('/terms')).toBe(false);
  });
});

describe('automatic suggestion gating (Trigger A / Trigger B)', () => {
  const now = Date.now();
  const base = {
    platform: 'android_chromium' as const, nativePromptAvailable: true, standalone: false,
    pathname: '/channels', search: '', eligiblePages: 1, activeMs: 0, interactions: 0,
    shownThisSession: false, dismissedAt: null, now,
  };
  it('Trigger A: 15s active + at least one interaction', () => {
    expect(autoSuggestTrigger({ ...base, activeMs: AUTO_TIME_MS, interactions: 1 })).toBe('time_engagement');
    expect(autoSuggestTrigger({ ...base, activeMs: AUTO_TIME_MS, interactions: 0 })).toBeNull();
    expect(autoSuggestTrigger({ ...base, activeMs: AUTO_TIME_MS - 1000, interactions: 5 })).toBeNull();
  });
  it('Trigger B: 2nd eligible page after 8s active (no interaction needed)', () => {
    expect(autoSuggestTrigger({ ...base, eligiblePages: 2, activeMs: AUTO_SECOND_PAGE_MS })).toBe('second_page');
    expect(autoSuggestTrigger({ ...base, eligiblePages: 2, activeMs: AUTO_SECOND_PAGE_MS - 1000 })).toBeNull();
    expect(autoSuggestTrigger({ ...base, eligiblePages: 1, activeMs: 14_000 })).toBeNull();
  });
  it('either trigger suffices; second_page wins when both hold', () => {
    expect(autoSuggestTrigger({ ...base, eligiblePages: 3, activeMs: 20_000, interactions: 2 })).toBe('second_page');
  });
  it('once per session, 7-day dismissal, never when installed', () => {
    const ok = { ...base, eligiblePages: 2, activeMs: 9000 };
    expect(shouldAutoSuggest({ ...ok, shownThisSession: true })).toBe(false);
    expect(shouldAutoSuggest({ ...ok, dismissedAt: now - 1000 })).toBe(false);
    expect(shouldAutoSuggest({ ...ok, dismissedAt: now - DISMISS_SUPPRESS_MS - 1 })).toBe(true);
    expect(shouldAutoSuggest({ ...ok, standalone: true })).toBe(false);
  });
  it('only where a real install path exists', () => {
    const ok = { ...base, eligiblePages: 2, activeMs: 9000 };
    expect(shouldAutoSuggest({ ...ok, nativePromptAvailable: false })).toBe(false);
    expect(shouldAutoSuggest({ ...ok, platform: 'ios_safari', nativePromptAvailable: false })).toBe(true);
    expect(shouldAutoSuggest({ ...ok, platform: 'ios_other_browser', nativePromptAvailable: false })).toBe(false);
    expect(shouldAutoSuggest({ ...ok, platform: 'ios_other_browser', nativePromptAvailable: false, iosThirdPartySupported: true })).toBe(true);
    expect(shouldAutoSuggest({ ...ok, platform: 'android_in_app' })).toBe(false);
    expect(shouldAutoSuggest({ ...ok, platform: 'desktop' })).toBe(false);
  });
  it('never on restricted routes or sensitive URLs', () => {
    const ok = { ...base, eligiblePages: 2, activeMs: 20_000, interactions: 3 };
    for (const pathname of ['/login', '/signup', '/sponsor/x', '/dashboard', '/pricing', '/admin', '/claim/x', '/submit']) {
      expect(shouldAutoSuggest({ ...ok, pathname })).toBe(false);
    }
    expect(shouldAutoSuggest({ ...ok, search: '?token=abc' })).toBe(false);
  });
});

describe('GA4 parameter mapping', () => {
  it('maps platform to android / ios / desktop / other', () => {
    expect(ga4Platform('android_chromium')).toBe('android');
    expect(ga4Platform('android_in_app')).toBe('android');
    expect(ga4Platform('ios_safari')).toBe('ios');
    expect(ga4Platform('ios_other_browser')).toBe('ios');
    expect(ga4Platform('desktop')).toBe('desktop');
    expect(ga4Platform('unknown')).toBe('other');
  });
  it('maps browser vocabulary', () => {
    expect(ga4Browser(UA.androidChrome)).toBe('chrome');
    expect(ga4Browser(UA.samsung)).toBe('samsung_internet');
    expect(ga4Browser(UA.androidFirefox)).toBe('firefox');
    expect(ga4Browser(UA.iosSafari)).toBe('safari');
    expect(ga4Browser(UA.iosChrome)).toBe('chrome');
    expect(ga4Browser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/125.0 Mobile/15E148 Safari/605.1.15')).toBe('edge');
    expect(ga4Browser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 EdgA/129.0')).toBe('edge');
    expect(ga4Browser(UA.iosFacebook)).toBe('other');
    expect(ga4Browser(UA.androidInstagram)).toBe('other');
    expect(ga4Browser('')).toBe('other');
  });
  it('the GA4 allowlist accepts exactly the documented vocabularies', () => {
    const src = readFileSync('lib/analytics/events.ts', 'utf8');
    expect(src).toContain("pwa_platform:        new Set(['android', 'ios', 'desktop', 'other'])");
    expect(src).toContain("pwa_browser:         new Set(['chrome', 'safari', 'edge', 'firefox', 'samsung_internet', 'other'])");
    expect(src).toContain("pwa_entry_point:     new Set(['auto_prompt', 'mobile_menu', 'footer'])");
    expect(src).toContain("pwa_trigger:         new Set(['time_engagement', 'second_page', 'manual'])");
    expect(src).toContain("pwa_display_mode:    new Set(['browser', 'standalone'])");
    expect(src).toContain("pwa_install_method:  new Set(['native_prompt', 'manual_a2hs'])");
  });
  it('pwa_app_installed is never fired from instruction views or CTA clicks', () => {
    const sheet = readFileSync('components/pwa/InstallSheet.tsx', 'utf8');
    expect(sheet).not.toContain('pwa_app_installed');
    const prov = readFileSync('components/pwa/PwaProvider.tsx', 'utf8');
    // only inside the browser's appinstalled handler
    expect(prov.match(/'pwa_app_installed'/g)?.length).toBe(2); // once-key + event name, single call site
  });
});

describe('service worker safety (source checks)', () => {
  const src = readFileSync('app/sw.js/route.ts', 'utf8');
  it('never intercepts mutations, APIs, auth, payments or dashboards', () => {
    expect(src).toContain("if (request.method !== 'GET') return;");
    expect(src).toMatch(/NETWORK_ONLY = .*api\|auth\|admin\|dashboard\|login\|signup\|sponsor\|claim\|submit\|pricing/);
  });
  it('never caches page HTML and has no background sync / replay', () => {
    expect(src).toContain('Pages are NEVER cached');
    expect(src).not.toMatch(/addEventListener\('sync'/);
    expect(src).not.toMatch(/backgroundFetch|periodicsync/i);
  });
  it('does not force updates and ships a kill switch', () => {
    expect(src).not.toMatch(/install[\s\S]{0,400}self\.skipWaiting\(\);\s*\}\);\s*\n\s*self\.addEventListener\('activate'/);
    expect(src).toContain("event.data.type === 'SKIP_WAITING'");
    expect(src).toContain('PWA_SW_DISABLED');
  });
});
