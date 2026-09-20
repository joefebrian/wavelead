// M18 GA4 CONSENT MODE V2 AUDIT — targeted consent / analytics tests.
//
// Scope (audit-driven, no broad browser matrix):
//   • Consent Mode v2 four parameters + default all-denied
//   • BASIC mode: zero GA4 loading/requests before analytics consent
//   • accept / reject / revoke (immediate, no reload) / persistence
//   • single GA4 loader, single gtag init, single config, single page_view
//   • no sensitive query parameters / PII in GA4 payloads or page_location
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { safeGa4Path, normalizeGa4Pathname, GA4_SAFE_QUERY_KEYS } from '@/lib/analytics/ga4Location';

const UUID = '3f2a9c14-7b51-4d8e-9a20-6c1e5d4b8f77';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');

const GA = src('components/analytics/GoogleAnalytics.tsx');
const LAYOUT = src('app/layout.tsx');
const BANNER = src('components/consent/ConsentBanner.tsx');
const CONSENT_SVC = src('lib/services/consentService.ts');
const INGEST = src('lib/services/analyticsEventsService.ts');

// ------------------------------------------------------------------ 1. DEFAULT
describe('M18-GA4 §1 default consent state (before any choice)', () => {
  it('1.1 all four Consent Mode v2 signals default to denied', () => {
    for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) {
      expect(GA).toContain(`${k}:'denied'`);
    }
    expect(GA).toContain("gtag('consent','default'");
  });

  it('1.2 BASIC mode — no gtag.js, no dataLayer, no config before consent', () => {
    // The whole tag subtree (loader + init + page_view tracker) lives behind the gate.
    expect(GA).toContain('if (!granted) return null');
    const gateIdx = GA.indexOf('if (!granted) return null');
    const loaderIdx = GA.indexOf('googletagmanager.com/gtag/js');
    const configIdx = GA.indexOf("gtag('config'");
    const dlIdx = GA.indexOf('window.dataLayer=window.dataLayer');
    const pvIdx = GA.indexOf('<Suspense fallback={null}><PageViews');
    for (const i of [loaderIdx, configIdx, dlIdx, pvIdx]) {
      expect(i).toBeGreaterThan(gateIdx);        // only reachable after consent
    }
  });

  it('1.3 consent is read from the server-persisted first-party record', () => {
    expect(GA).toContain("'/api/consent'");
    expect(GA).toContain('setGranted(!!j?.data?.consent?.analytics)');
    // No consent record → stays denied (catch branch leaves `granted` false).
    expect(GA).toContain('const [granted, setGranted] = useState(false)');
  });
});

// ------------------------------------------------- 2. ACCEPT / REJECT / REVOKE
describe('M18-GA4 §2 accept, reject, revoke', () => {
  it('2.1 accept grants analytics_storage ONLY (ad_* stay denied)', () => {
    expect(GA).toContain("gtag('consent','update',{analytics_storage:'granted'})");
    // No code path ever grants an advertising signal.
    expect(GA).not.toMatch(/ad_storage:\s*'granted'/);
    expect(GA).not.toMatch(/ad_user_data:\s*'granted'/);
    expect(GA).not.toMatch(/ad_personalization:\s*'granted'/);
    expect(GA).not.toContain('ad_personalization: granted');
  });

  it('2.2 reject keeps all four denied and sends nothing', () => {
    expect(BANNER).toContain('commit(false)');                    // Reject Non-Essential
    expect(BANNER).toContain('saveConsent(analytics)');
    // Server records analytics=false unless the client explicitly sent true.
    expect(src('app/api/[[...path]]/route.ts')).toContain("body as { analytics?: unknown }).analytics === true");
    expect(GA).toContain("analytics_storage: granted ? 'granted' : 'denied'");
  });

  it('2.3 revocation is immediate — no reload, and the event helper is gated', () => {
    expect(BANNER).toContain("window.dispatchEvent(new Event('wl-consent-changed'))");
    expect(GA).toContain("window.addEventListener('wl-consent-changed', onChange)");
    // Consent update fires on every change of `granted`, in the same tick.
    expect(GA).toContain("window.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' })");
    // gtag.js stays resident after unmount → the event helper must also gate.
    expect(GA).toContain('let ga4Granted = false');
    expect(GA).toContain('ga4Granted = granted;');
    expect(GA).toContain('if (!ga4Granted) return;');
  });

  it('2.4 page_view tracker stops firing once consent is not granted', () => {
    expect(GA).toContain('if (!enabled || typeof window === \'undefined\' || !window.gtag) return;');
    expect(GA).toContain('<PageViews enabled={granted} />');
  });
});

// ------------------------------------------------------------- 3. PERSISTENCE
describe('M18-GA4 §3 consent persistence (existing first-party mechanism)', () => {
  it('3.1 single first-party HttpOnly cookie, versioned, 1 year', () => {
    expect(CONSENT_SVC).toContain("export const CONSENT_COOKIE = 'wl_consent'");
    expect(CONSENT_SVC).toContain('CONSENT_POLICY_VERSION');
    expect(CONSENT_SVC).toContain('httpOnly: true');
    expect(CONSENT_SVC).toContain('60 * 60 * 24 * 365');
    // No second consent store was introduced by this audit.
    expect(GA).not.toContain('localStorage');
    expect(GA).not.toContain('document.cookie');
  });

  it('3.2 absent cookie ⇒ null decision ⇒ denied + banner shown', () => {
    expect(CONSENT_SVC).toContain('if (!raw) return null');
    expect(CONSENT_SVC).toContain('if (!s.analytics) return null');
    expect(CONSENT_SVC).toContain('if (s.policy_version !== CONSENT_POLICY_VERSION) return null');
    expect(BANNER).toContain('const bannerVisible = state === null');
  });

  it('3.3 a changed decision is re-persisted (accept, reject and revoke)', () => {
    expect(CONSENT_SVC).toContain('setConsentCookieOnResponse(response, state)');
    expect(CONSENT_SVC).toContain('const priorConsentedAt =');   // consented_at preserved
    expect(BANNER).toContain("method: 'POST'");
  });

  it('3.4 first-party analytics ingest is consent-gated server-side', () => {
    expect(INGEST).toContain('const consent = hasAnalyticsConsent(request)');
    expect(INGEST).toContain('status: 204');
  });
});

// -------------------------------------------------------- 4. NO DUPLICATION
describe('M18-GA4 §4 single initialization and single page_view', () => {
  it('4.1 one loader, one gtag bootstrap, one config, one mount', () => {
    expect((GA.match(/googletagmanager\.com\/gtag\/js/g) || []).length).toBe(1);
    expect((GA.match(/window\.dataLayer=window\.dataLayer/g) || []).length).toBe(1);
    expect((GA.match(/gtag\('config'/g) || []).length).toBe(1);
    expect((LAYOUT.match(/<GoogleAnalytics \/>/g) || []).length).toBe(1);
    expect(LAYOUT).not.toContain('GoogleTagManager');
  });

  it('4.2 automatic page_view is off and the manual one de-dupes per navigation', () => {
    expect(GA).toContain('send_page_view:false');
    expect(GA).toContain('last.current === url');
    expect((GA.match(/'event', 'page_view'/g) || []).length).toBe(1);
  });

  it('4.3 the only other page_view pipeline is first-party (not GA4)', () => {
    const auto = src('components/consent/AnalyticsAutoPageView.tsx');
    expect(auto).toContain("trackEvent('page_view')");
    expect(auto).not.toContain('gtag');
    expect(src('lib/analytics/client.ts')).toContain("'/api/analytics/events'");
    expect(src('lib/analytics/client.ts')).not.toContain('gtag');
  });
});

// ------------------------------------------------ 5. PII / SENSITIVE PAYLOADS
describe('M18-GA4 §5 no PII or sensitive identifiers reach GA4', () => {
  it('5.1 sensitive event parameter keys are blocked', () => {
    expect(GA).toContain('BLOCKED_KEYS');
    for (const k of ['email', 'phone', 'mobile', 'name', 'paypal', 'capture', 'order_id', 'token', 'password', 'secret', 'message', 'evidence', 'drive']) {
      expect(GA).toContain(k);
    }
  });

  it('5.2 PayPal provider identifiers in the return URL never reach GA4', () => {
    // Live PayPal return: /dashboard/billing?brand_pro=<id>&status=paid&token=<order id>&PayerID=<payer id>
    const out = safeGa4Path('/dashboard/billing', 'brand_pro=abc-123&status=paid&token=5O190127TN364715T&PayerID=QFTDZLK9Q2TXC');
    expect(out).toBe('/dashboard/billing?status=paid');
    expect(out).not.toContain('token');
    expect(out).not.toContain('PayerID');
    expect(out).not.toContain('brand_pro');
  });

  it('5.3 internal commercial identifiers are stripped from the query', () => {
    expect(safeGa4Path('/dashboard/sponsorships', 'order=o-1&payment=paypal&attempt=a-1&status=return'))
      .toBe('/dashboard/sponsorships?status=return');
    expect(safeGa4Path('/pricing', 'founding_lifetime=fl-1&status=paid')).toBe('/pricing?status=paid');
    expect(safeGa4Path(`/dashboard/channels/${UUID}/verify`, 'activation=p-9&status=paid'))
      .toBe('/dashboard/channels/[id]/verify?status=paid');
    expect(safeGa4Path(`/dashboard/promotions/${UUID}`, 'funding=f-1&status=paid'))
      .toBe('/dashboard/promotions/[id]?status=paid');
  });

  it('5.3b internal object ids in the PATH are normalized to a route pattern', () => {
    expect(normalizeGa4Pathname(`/dashboard/campaigns/${UUID}`)).toBe('/dashboard/campaigns/[id]');
    expect(normalizeGa4Pathname(`/dashboard/sponsorship-requests/${UUID}`)).toBe('/dashboard/sponsorship-requests/[id]');
    expect(normalizeGa4Pathname(`/admin/users/${UUID}/edit`)).toBe('/admin/users/[id]/edit');
    expect(normalizeGa4Pathname('/admin/audience-snapshots/507f1f77bcf86cd799439011')).toBe('/admin/audience-snapshots/[id]');
    expect(normalizeGa4Pathname('/dashboard/bookings/1234567890')).toBe('/dashboard/bookings/[id]');
    expect(normalizeGa4Pathname('/x/ab12cd34ef56gh78ij90kl')).toBe('/x/[id]');
    // Public slug surfaces keep their (non-sensitive, useful) context.
    expect(normalizeGa4Pathname('/channels/daily-tech-news')).toBe('/channels/daily-tech-news');
    expect(normalizeGa4Pathname('/category/business-finance')).toBe('/category/business-finance');
    expect(normalizeGa4Pathname('/sponsor/daily-tech-news')).toBe('/sponsor/daily-tech-news');
    expect(normalizeGa4Pathname('/')).toBe('/');
    expect(normalizeGa4Pathname('/pricing')).toBe('/pricing');
    // Real application routes are untouched — this is analytics-only.
    expect(GA).toContain('safeGa4Path');
    expect(src('lib/analytics/ga4Location.ts')).toContain('[id]');
  });

  it('5.4 auth / session / email / free-text values are stripped', () => {
    expect(safeGa4Path('/reset-password', 'token=eyJhbGciOi.J9.sig')).toBe('/reset-password');
    expect(safeGa4Path('/login', 'email=someone@example.com&next=/dashboard')).toBe('/login');
    expect(safeGa4Path('/channels', 'q=my+private+search')).toBe('/channels');
    expect(safeGa4Path('/x', 'wl_session=abc&jwt=abc&access_token=abc')).toBe('/x');
    expect(safeGa4Path('/x', 'status=paid@x')).toBe('/x');            // email-shaped value dropped
    expect(safeGa4Path('/x', `category=${'a'.repeat(61)}`)).toBe('/x'); // over-long value dropped
  });

  it('5.5 marketing attribution survives (analytics stays useful)', () => {
    expect(safeGa4Path('/', 'utm_source=newsletter&utm_medium=email&utm_campaign=launch&token=secret'))
      .toBe('/?utm_source=newsletter&utm_medium=email&utm_campaign=launch');
    expect(GA4_SAFE_QUERY_KEYS).toContain('utm_source');
    expect(GA4_SAFE_QUERY_KEYS).not.toContain('token');
    expect(GA4_SAFE_QUERY_KEYS as readonly string[]).not.toContain('PayerID');
  });

  it('5.6 edge cases never throw and degrade to the bare path', () => {
    expect(safeGa4Path('/', null)).toBe('/');
    expect(safeGa4Path('', '')).toBe('/');
    expect(safeGa4Path('/a?b=c', 'status=ok')).toBe('/a?status=ok');
    expect(safeGa4Path('/a#frag', 'status=ok')).toBe('/a?status=ok');
    expect(safeGa4Path('/a', '?status=ok')).toBe('/a?status=ok');
  });

  it('5.7 page_location/page_path are pinned to the sanitized URL for ALL hits', () => {
    expect(GA).toContain("window.gtag('set', { page_path: url, page_location: loc })");
    expect(GA).toContain('const url = safeGa4Path(pathname');
    expect(GA).toContain('const url = safeGa4Path(window.location.pathname, window.location.search)');
    expect(GA).toContain('safe.page_location = window.location.origin + url;');
    // Raw, unsanitized URL is never handed to GA4 any more.
    expect(GA).not.toContain('window.location.href');
    expect(GA).not.toContain('`${pathname}${qs ? `?${qs}` : \'\'}`');
  });

  it('5.8 every emitted GA4 event is on the non-sensitive allowlist', () => {
    const names = ['channel_submit_started', 'fast_verification_started', 'fast_verification_payment_completed',
      'owner_identity_completed', 'manual_verification_submitted', 'brand_pro_checkout_started',
      'brand_pro_activated', 'founding_lifetime_checkout_started'];
    for (const n of names) expect(GA).toContain(`'${n}'`);
    // Call sites only ever pass the public channel slug.
    for (const f of [
      'app/dashboard/channels/[id]/verify/VerifyClient.tsx',
      'app/dashboard/channels/[id]/verify/FastVerificationForm.tsx',
      'app/dashboard/channels/[id]/verify/ManualVerificationForm.tsx',
      'app/pricing/PricingClient.tsx',
      'components/commerce/BrandProReturn.tsx',
    ]) {
      const s = src(f);
      const calls = s.match(/ga4Track\([^)]*\)/g) || [];
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c).not.toMatch(/email|phone|whatsapp|legal_name|payout|paypal|capture|order_id|token|message|evidence/i);
      }
    }
  });
});

// ------------------------------------------------------------- 6. CONSENT COPY
describe('M18-GA4 §6 consent copy accuracy (no UI redesign)', () => {
  const COOKIES = src('app/cookies/page.tsx');
  const PRIVACY = src('app/privacy/page.tsx');

  it('6.1 copy states analytics is optional and off by default', () => {
    expect(COOKIES).toContain('Off by default');
    expect(COOKIES).toContain('only activated with your explicit consent');
    expect(PRIVACY).toContain('Optional analytics (off by default)');
    expect(BANNER).toContain('Off by default');
    expect(BANNER).toContain('with your permission');
  });

  it('6.2 copy discloses GA4 and that accepting enables analytics storage ONLY', () => {
    for (const s of [COOKIES, PRIVACY, BANNER]) expect(s).toContain('Google Analytics 4');
    expect(COOKIES).toContain('measurement only');
    expect(COOKIES).toContain('Nothing is loaded from');
    expect(COOKIES).toContain('enables analytics storage');
  });

  it('6.3 copy states the three advertising signals stay denied at all times', () => {
    for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
      expect(COOKIES).toContain(k);
      expect(PRIVACY).toContain(k);
    }
    expect(COOKIES).toContain('denied');
    expect(PRIVACY).toContain('remain denied at all times');
    expect(BANNER).toContain('advertising storage stays off');
    // Existing anti-tracking claims preserved and still true.
    expect(COOKIES).toContain('retargeting');
    expect(COOKIES).toContain('fingerprinting');
  });

  it('6.4 banner/preferences UI structure untouched (copy-only change)', () => {
    for (const t of ['consent-banner', 'consent-accept-all', 'consent-reject-non-essential',
      'consent-manage', 'consent-manager', 'consent-analytics-toggle', 'consent-manager-save']) {
      expect(BANNER).toContain(`data-testid="${t}"`);
    }
    expect(BANNER).toContain('const [analyticsPref, setAnalyticsPref] = useState(false)'); // not pre-checked
  });

  it('6.5 the toggle reflects the persisted decision in the same session', () => {
    // Accept All previously left the panel reading "Off" while consent was
    // granted — re-saving would then have silently revoked analytics.
    expect(BANNER).toContain('setAnalyticsPref(next ? !!next.analytics : analytics)');
    expect(BANNER).toContain('if (r.consent) setAnalyticsPref(!!r.consent.analytics)'); // restore on load
  });
});
