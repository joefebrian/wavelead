// PWA — platform detection, install-mode and automatic-suggestion gating.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectPwaPlatform, detectIosBrowser, iosVersion, iosThirdPartyCanInstall, installModeFor, isSensitiveLocation, isAutoSuggestPath, shouldAutoSuggest,
  AUTO_MIN_MS, DISMISS_SUPPRESS_MS,
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

describe('automatic suggestion gating', () => {
  const now = Date.now();
  const base = {
    platform: 'android_chromium' as const, nativePromptAvailable: true, standalone: false,
    pathname: '/channels', search: '', distinctPages: 2, engagedMs: AUTO_MIN_MS, shownThisSession: false, dismissedAt: null, now,
  };
  it('requires ≥2 pages AND ≥30s', () => {
    expect(shouldAutoSuggest(base)).toBe(true);
    expect(shouldAutoSuggest({ ...base, distinctPages: 1 })).toBe(false);
    expect(shouldAutoSuggest({ ...base, engagedMs: AUTO_MIN_MS - 1 })).toBe(false);
  });
  it('once per session, 7-day dismissal, never when installed', () => {
    expect(shouldAutoSuggest({ ...base, shownThisSession: true })).toBe(false);
    expect(shouldAutoSuggest({ ...base, dismissedAt: now - 1000 })).toBe(false);
    expect(shouldAutoSuggest({ ...base, dismissedAt: now - DISMISS_SUPPRESS_MS - 1 })).toBe(true);
    expect(shouldAutoSuggest({ ...base, standalone: true })).toBe(false);
  });
  it('only where a real install path exists', () => {
    expect(shouldAutoSuggest({ ...base, nativePromptAvailable: false })).toBe(false);
    expect(shouldAutoSuggest({ ...base, platform: 'ios_safari', nativePromptAvailable: false })).toBe(true);
    expect(shouldAutoSuggest({ ...base, platform: 'ios_other_browser', nativePromptAvailable: false })).toBe(false);
    expect(shouldAutoSuggest({ ...base, platform: 'ios_other_browser', nativePromptAvailable: false, iosThirdPartySupported: true })).toBe(true);
    expect(shouldAutoSuggest({ ...base, platform: 'android_in_app' })).toBe(false);
    expect(shouldAutoSuggest({ ...base, platform: 'desktop' })).toBe(false);
  });
  it('never on sensitive flows', () => {
    expect(shouldAutoSuggest({ ...base, pathname: '/login' })).toBe(false);
    expect(shouldAutoSuggest({ ...base, pathname: '/sponsor/x' })).toBe(false);
    expect(shouldAutoSuggest({ ...base, search: '?token=abc' })).toBe(false);
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
