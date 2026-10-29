// WaveLead PWA — pure platform detection + suggestion gating rules.
// No DOM access here so every rule is unit-testable.

export type PwaPlatform =
  | 'android_chromium'   // Chrome / Samsung Internet / Edge / Opera on Android (beforeinstallprompt capable)
  | 'android_other'      // e.g. Firefox for Android (menu → Install)
  | 'android_in_app'     // WebView inside another app (Instagram, Facebook, WhatsApp…)
  | 'ios_safari'         // Safari on iPhone / iPad (Share → Add to Home Screen)
  | 'ios_other_browser'  // Chrome / Firefox / Edge on iOS
  | 'ios_in_app'         // In-app browser on iOS
  | 'desktop'
  | 'unknown';

const IN_APP_RE = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|LinkedInApp|Twitter|TikTok|musical_ly|BytedanceWebview|Snapchat|WhatsApp|Pinterest|GSA\/|MicroMessenger/i;
const IOS_OTHER_RE = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|YaBrowser|Brave/i;

export function detectPwaPlatform(ua: string, maxTouchPoints = 0): PwaPlatform {
  if (!ua) return 'unknown';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  if (isIOS) {
    if (IN_APP_RE.test(ua)) return 'ios_in_app';
    if (IOS_OTHER_RE.test(ua)) return 'ios_other_browser';
    if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'ios_safari';
    // WKWebView without the Safari token = embedded browser.
    return 'ios_in_app';
  }
  if (/Android/i.test(ua)) {
    if (IN_APP_RE.test(ua) || /; wv\)/i.test(ua)) return 'android_in_app';
    if (/Firefox\//i.test(ua)) return 'android_other';
    if (/Chrome\/|SamsungBrowser|EdgA|OPR\//i.test(ua)) return 'android_chromium';
    return 'android_other';
  }
  return 'desktop';
}

export const isMobilePlatform = (p: PwaPlatform) => p !== 'desktop' && p !== 'unknown';

/** Third-party iOS browser, for browser-specific Add to Home Screen steps. */
export type IosBrowser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'other';
export function detectIosBrowser(ua: string): IosBrowser {
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/EdgiOS/i.test(ua)) return 'edge';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (IOS_OTHER_RE.test(ua)) return 'other';
  return 'safari';
}
/** iOS version as a number (e.g. 16.4), or null when not an iOS UA. */
export function iosVersion(ua: string): number | null {
  const m = /OS (\d+)[_.](\d+)(?:[_.]\d+)? like Mac OS X/i.exec(ua);
  return m ? Number(m[1]) + Number(m[2]) / 10 : null;
}
/**
 * Since iOS 16.4, Chrome, Edge and Firefox on iOS can Add to Home Screen via
 * the iOS share sheet. iPadOS desktop-mode UAs carry no iOS version; those are
 * treated as supported.
 */
export function iosThirdPartyCanInstall(ua: string): boolean {
  const b = detectIosBrowser(ua);
  if (b !== 'chrome' && b !== 'edge' && b !== 'firefox') return false;
  const v = iosVersion(ua);
  return v === null ? true : v >= 16.4;
}

/** Which install experience the sheet should show. */
export type InstallMode = 'native' | 'ios_safari' | 'ios_share' | 'ios_open_in_safari' | 'android_manual' | 'open_in_browser' | 'none';

export function installModeFor(p: PwaPlatform, nativePromptAvailable: boolean, standalone: boolean, iosThirdPartySupported = false): InstallMode {
  if (standalone) return 'none';
  if (nativePromptAvailable && p !== 'ios_safari' && p !== 'ios_other_browser' && p !== 'ios_in_app') return 'native';
  switch (p) {
    case 'ios_safari': return 'ios_safari';
    case 'ios_other_browser': return iosThirdPartySupported ? 'ios_share' : 'ios_open_in_safari';
    case 'ios_in_app':
    case 'android_in_app': return 'open_in_browser';
    case 'android_chromium':
    case 'android_other': return 'android_manual';
    default: return 'none'; // desktop: the desktop website stays unchanged
  }
}

// ---------------------------------------------------------------------------
// Automatic suggestion gating
// ---------------------------------------------------------------------------
// Trigger A: ≥15 s active browsing + ≥1 meaningful interaction.
// Trigger B: 2nd eligible page visit + ≥8 s cumulative active browsing.
// "Active" time only accrues while the tab is visible and focused.
export const AUTO_TIME_MS = 15_000;
export const AUTO_SECOND_PAGE_MS = 8_000;
export const DISMISS_SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000;
export type AutoTrigger = 'time_engagement' | 'second_page';

/** Automatic suggestions appear ONLY on public discovery / marketing pages. */
const AUTO_ALLOWED_PATH_RE = /^\/(?:$|channels\/?$|channel\/[^/]+\/?$|categories\/?$|category\/[^/]+\/?$|countries\/?$|country\/[^/]+\/?$|trending\/?$|top\/?$|search\/?$|for-brands\/?$|about\/?$|faq\/?$)/;

/**
 * Sensitive flows: login/registration/onboarding, payments & checkout returns,
 * sponsorship booking, claims/verification, dashboards and admin. Never
 * interrupted by a suggestion, and never reloaded by an update.
 */
const SENSITIVE_PATH_RE = /^\/(?:login|signup|auth|onboarding|forgot|reset|dashboard|admin|sponsor|claim|submit|pricing|go|checkout|pay)(?:\/|$)/;
const SENSITIVE_QUERY_KEYS = ['token', 'PayerID', 'paymentId', 'order', 'attempt', 'activation', 'commitment', 'funding', 'brand_pro', 'founding_lifetime', 'status', 'payment', 'next'];

export function isSensitiveLocation(pathname: string, search = ''): boolean {
  if (SENSITIVE_PATH_RE.test(pathname || '/')) return true;
  const q = new URLSearchParams(search || '');
  return SENSITIVE_QUERY_KEYS.some((k) => q.has(k));
}

export function isAutoSuggestPath(pathname: string, search = ''): boolean {
  if (isSensitiveLocation(pathname, search)) return false;
  return AUTO_ALLOWED_PATH_RE.test(pathname || '/');
}

export interface AutoSuggestInput {
  platform: PwaPlatform;
  nativePromptAvailable: boolean;
  standalone: boolean;
  pathname: string;
  search: string;
  /** Distinct auto-eligible (discovery) pages visited this session. */
  eligiblePages: number;
  /** Cumulative visible + focused browsing time this session. */
  activeMs: number;
  /** Meaningful interactions (tap/click/key/scroll) this session. */
  interactions: number;
  shownThisSession: boolean;
  dismissedAt: number | null;
  now: number;
  /** Chrome / Edge / Firefox on iOS 16.4+ (share-sheet install). */
  iosThirdPartySupported?: boolean;
}

/** Which automatic trigger fires now, or null. */
export function autoSuggestTrigger(i: AutoSuggestInput): AutoTrigger | null {
  if (i.standalone || i.shownThisSession) return null;
  // Only where a real install path exists right now.
  const eligible = (i.nativePromptAvailable && (i.platform === 'android_chromium' || i.platform === 'android_other'))
    || i.platform === 'ios_safari'
    || (i.platform === 'ios_other_browser' && i.iosThirdPartySupported === true);
  if (!eligible) return null;
  if (i.dismissedAt && i.now - i.dismissedAt < DISMISS_SUPPRESS_MS) return null;
  if (!isAutoSuggestPath(i.pathname, i.search)) return null;
  if (i.eligiblePages >= 2 && i.activeMs >= AUTO_SECOND_PAGE_MS) return 'second_page';
  if (i.activeMs >= AUTO_TIME_MS && i.interactions >= 1) return 'time_engagement';
  return null;
}

export function shouldAutoSuggest(i: AutoSuggestInput): boolean {
  return autoSuggestTrigger(i) !== null;
}

// ---------------------------------------------------------------------------
// GA4 parameter mapping (coarse, non-identifying vocabularies)
// ---------------------------------------------------------------------------
export type Ga4PwaPlatform = 'android' | 'ios' | 'desktop' | 'other';
export type Ga4PwaBrowser = 'chrome' | 'safari' | 'edge' | 'firefox' | 'samsung_internet' | 'other';

export function ga4Platform(p: PwaPlatform): Ga4PwaPlatform {
  if (p.startsWith('android')) return 'android';
  if (p.startsWith('ios')) return 'ios';
  if (p === 'desktop') return 'desktop';
  return 'other';
}

export function ga4Browser(ua: string): Ga4PwaBrowser {
  if (!ua) return 'other';
  if (IN_APP_RE.test(ua) || /; wv\)/i.test(ua)) return 'other';
  if (/SamsungBrowser/i.test(ua)) return 'samsung_internet';
  if (/EdgiOS|EdgA|Edg\//i.test(ua)) return 'edge';
  if (/FxiOS|Firefox\//i.test(ua)) return 'firefox';
  if (/OPR\/|OPiOS|OPT\/|YaBrowser|DuckDuckGo|Brave/i.test(ua)) return 'other';
  if (/CriOS|Chrome\//i.test(ua)) return 'chrome';
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'safari';
  return 'other';
}
