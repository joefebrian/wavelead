// M19.3 — GA4 product-analytics cleanup targeted tests.
//
// Verifies:
//   §1 The canonical helper is the ONLY place events go to gtag (source audit)
//   §2 Consent gate: zero events before consent, immediate revoke
//   §3 Event name allowlist
//   §4 Parameter allowlist + per-value vocabulary
//   §5 PII / provider-identifier shape rejection
//   §6 Support & payment identifiers are not in the caller sites
//   §7 Duplicate prevention (trackGa4EventOnce)
//   §8 M18 Consent Mode v2 semantics still enforced (BASIC mode, page_view
//      sanitisation, revoke-immediate, ad_* denied even when analytics granted)
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// jsdom-lite: provide `window` and `document` for the helper module.
// ---------------------------------------------------------------------------
type GtagCall = { command: string; args: unknown[] };
const gtagCalls: GtagCall[] = [];
const gtagFn = (...args: unknown[]): void => { const [cmd, ...rest] = args; gtagCalls.push({ command: String(cmd), args: rest }); };
type Loc = { origin: string; pathname: string; search: string };
type WinShape = { location: Loc; gtag?: typeof gtagFn; dataLayer?: unknown[] };
const win: WinShape = {
  location: { origin: 'https://wavelead.org', pathname: '/', search: '' },
  gtag: gtagFn,
  dataLayer: [],
};

// Attach onto globalThis BEFORE importing the module under test (client module
// gates on `typeof window === 'undefined'`).
(globalThis as unknown as { window: WinShape }).window = win;
(globalThis as unknown as { document: unknown }).document = { referrer: '' };

import {
  trackGa4Event,
  trackGa4EventOnce,
  setGa4ConsentGranted,
  isGa4ConsentGranted,
  GA4_EVENTS,
  _resetGa4EventsFiredForTest,
} from '@/lib/analytics/events';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');

beforeEach(() => {
  gtagCalls.length = 0;
  win.location = { origin: 'https://wavelead.org', pathname: '/', search: '' };
  setGa4ConsentGranted(false);
  _resetGa4EventsFiredForTest();
});

describe('M19.3 §1 — Source audit: direct gtag/dataLayer calls only in the loader + helper', () => {
  it('1.1 GoogleAnalytics.tsx is the ONLY module that calls window.gtag directly', () => {
    // Any file under app/ or components/ that touches window.gtag(...) OUTSIDE
    // components/analytics/GoogleAnalytics.tsx is a policy violation.
    const walk = (dir: string): string[] => {
      const fs = require('node:fs') as typeof import('node:fs');
      const out: string[] = [];
      for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          out.push(...walk(rel));
        } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
          out.push(rel);
        }
      }
      return out;
    };
    const files = [...walk('app'), ...walk('components'), ...walk('lib')];
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === 'components/analytics/GoogleAnalytics.tsx') continue;
      if (rel === 'lib/analytics/events.ts') continue; // canonical helper
      const s = readFileSync(path.join(REPO, rel), 'utf8');
      if (/\bwindow\s*\.\s*gtag\s*\(/.test(s)) offenders.push(rel);
      if (/\bdataLayer\s*\.\s*push\s*\(/.test(s)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
  it('1.2 the deprecated ga4Track re-export is only a thin wrapper', () => {
    const s = src('components/analytics/GoogleAnalytics.tsx');
    expect(s).toContain("export function ga4Track");
    expect(s).toContain('trackGa4Event(event, params)');
  });
});

describe('M19.3 §2 — Consent gate', () => {
  it('2.1 with consent NOT granted, no events reach gtag', () => {
    setGa4ConsentGranted(false);
    trackGa4Event('sign_up', { account_type: 'brand' });
    expect(gtagCalls).toHaveLength(0);
  });
  it('2.2 with consent granted, an allowed event reaches gtag', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('sign_up', { account_type: 'brand' });
    expect(gtagCalls).toHaveLength(1);
    expect(gtagCalls[0].command).toBe('event');
    expect(gtagCalls[0].args[0]).toBe('sign_up');
  });
  it('2.3 revoke stops events immediately (no reload)', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('sign_up', { account_type: 'brand' });
    setGa4ConsentGranted(false);
    trackGa4Event('login', { account_type: 'brand' });
    expect(gtagCalls).toHaveLength(1);
    expect(gtagCalls[0].args[0]).toBe('sign_up');
    expect(isGa4ConsentGranted()).toBe(false);
  });
});

describe('M19.3 §3 — Event name allowlist', () => {
  it('3.1 unknown event names are silently dropped', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('button_clicked' as unknown as (typeof GA4_EVENTS)[number]);
    trackGa4Event('modal_opened'   as unknown as (typeof GA4_EVENTS)[number]);
    trackGa4Event('purchase'       as unknown as (typeof GA4_EVENTS)[number]);
    expect(gtagCalls).toHaveLength(0);
  });
  it('3.2 every declared event fires when allowlisted', () => {
    setGa4ConsentGranted(true);
    for (const e of GA4_EVENTS) {
      gtagCalls.length = 0;
      trackGa4Event(e);
      expect(gtagCalls).toHaveLength(1);
      expect(gtagCalls[0].args[0]).toBe(e);
    }
  });
  it('3.3 no revenue "purchase" event is declared (financial reconciliation stays in Reports)', () => {
    expect((GA4_EVENTS as readonly string[]).includes('purchase')).toBe(false);
    expect((GA4_EVENTS as readonly string[]).includes('checkout_completed')).toBe(false);
    expect((GA4_EVENTS as readonly string[]).includes('booking_paid')).toBe(false);
  });
});

describe('M19.3 §4 — Parameter allowlist + per-value vocabulary', () => {
  it('4.1 unknown params are dropped', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('sign_up', { account_type: 'brand', channel_id: 'must-be-dropped', campaign_id: 'must-be-dropped' });
    const params = gtagCalls[0].args[1] as Record<string, unknown>;
    expect(params.account_type).toBe('brand');
    expect(params.channel_id).toBeUndefined();
    expect(params.campaign_id).toBeUndefined();
  });
  it('4.2 param values outside the vocabulary are dropped', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('sign_up', { account_type: 'weird-value' as unknown as 'brand' });
    const params = gtagCalls[0].args[1] as Record<string, unknown>;
    expect(params.account_type).toBeUndefined();
  });
  it('4.3 per-value vocabularies are enforced', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('verification_started', { verification_method: 'not_a_method' as unknown as 'fast' });
    let params = gtagCalls[0].args[1] as Record<string, unknown>;
    expect(params.verification_method).toBeUndefined();
    gtagCalls.length = 0;
    trackGa4Event('verification_started', { verification_method: 'fast' });
    params = gtagCalls[0].args[1] as Record<string, unknown>;
    expect(params.verification_method).toBe('fast');
  });
  it('4.4 product_name vocabulary matches the pricing spec', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('brand_pro_checkout_started',       { product_name: 'brand_pro_30_day', currency: 'USD' });
    trackGa4Event('founding_lifetime_checkout_started', { product_name: 'founding_lifetime', currency: 'USD' });
    trackGa4Event('owner_activation_checkout_started', { product_name: 'owner_activation', currency: 'USD' });
    expect(gtagCalls).toHaveLength(3);
    for (const c of gtagCalls) {
      const p = c.args[1] as Record<string, unknown>;
      expect(['brand_pro_30_day', 'founding_lifetime', 'owner_activation']).toContain(p.product_name);
      expect(p.currency).toBe('USD');
    }
  });
});

describe('M19.3 §5 — PII / provider-identifier shape rejection', () => {
  const cases: Array<{ label: string; value: string }> = [
    { label: 'email',          value: 'someone@example.com' },
    { label: 'phone',          value: '+1 (415) 555-1234' },
    { label: 'uuid',           value: '302a3aab-e4db-4eb6-b03a-f392b674d37e' },
    { label: 'PayPal PAYID',   value: 'PAYID-ABCDEFGHIJKLMNOP' },
    { label: 'PayPal PayerID', value: 'PayerID=ABCDEF12345' },
    { label: 'JWT',            value: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.abcdefghijkl' },
    { label: 'long token',     value: 'x'.repeat(80) },
  ];
  for (const { label, value } of cases) {
    it(`5.${label} an event carrying a ${label}-shaped value is hard-aborted (no gtag call)`, () => {
      setGa4ConsentGranted(true);
      trackGa4Event('sign_up', { account_type: value as unknown as 'brand' });
      expect(gtagCalls).toHaveLength(0);
    });
  }
});

describe('M19.3 §6 — Callers never pass private identifiers to the helper', () => {
  const callers = [
    'app/pricing/PricingClient.tsx',
    'app/dashboard/channels/[id]/verify/FastVerificationForm.tsx',
    'app/dashboard/channels/[id]/verify/ManualVerificationForm.tsx',
    'app/dashboard/channels/[id]/verify/VerifyClient.tsx',
    'app/dashboard/campaigns/CampaignsClient.tsx',
    'app/dashboard/opportunities/OpportunitiesClient.tsx',
    'app/signup/page.tsx',
    'app/login/page.tsx',
    'components/support/SupportWidget.tsx',
  ];
  it('6.1 no caller passes channel:/channel_id:/campaign_id:/order_id:/email:/user_id:/token: to a track call', () => {
    for (const c of callers) {
      const s = src(c);
      const inTrackCall = (needle: RegExp) => {
        // Match anywhere inside the argument list of a trackGa4Event call.
        const re = new RegExp(`trackGa4Event(?:Once)?\\([^)]*${needle.source}[^)]*\\)`, 's');
        return re.test(s);
      };
      expect({ file: c, has_channel_id: inTrackCall(/channel_id\s*:/)     }).toEqual({ file: c, has_channel_id: false });
      expect({ file: c, has_channel:    inTrackCall(/(?<!\w)channel\s*:/) }).toEqual({ file: c, has_channel: false });
      expect({ file: c, has_campaign_id: inTrackCall(/campaign_id\s*:/)   }).toEqual({ file: c, has_campaign_id: false });
      expect({ file: c, has_application_id: inTrackCall(/application_id\s*:/) }).toEqual({ file: c, has_application_id: false });
      expect({ file: c, has_order_id:   inTrackCall(/order_id\s*:/)       }).toEqual({ file: c, has_order_id: false });
      expect({ file: c, has_email:      inTrackCall(/email\s*:/)          }).toEqual({ file: c, has_email: false });
      expect({ file: c, has_user_id:    inTrackCall(/user_id\s*:/)        }).toEqual({ file: c, has_user_id: false });
      expect({ file: c, has_token:      inTrackCall(/token\s*:/)          }).toEqual({ file: c, has_token: false });
      expect({ file: c, has_ticket_id:  inTrackCall(/ticket_id\s*:/)      }).toEqual({ file: c, has_ticket_id: false });
    }
  });
  it('6.2 no caller invokes the legacy ga4Track import path', () => {
    for (const c of callers) {
      const s = src(c);
      expect(s).not.toContain("from '@/components/analytics/GoogleAnalytics'");
      expect(s).not.toMatch(/\bga4Track\s*\(/);
    }
  });
  it('6.3 no raw search text or arbitrary URL query is forwarded through the helper', () => {
    const events = src('lib/analytics/events.ts');
    // The helper does not read window.location.search into event params.
    // page_path and page_location go through safeGa4Path.
    expect(events).toContain('safeGa4Path(window.location.pathname, window.location.search)');
    expect(events).not.toMatch(/params\[[^\]]+\]\s*=\s*window\.location\.search/);
  });
});

describe('M19.3 §7 — Duplicate-event prevention', () => {
  it('7.1 trackGa4EventOnce fires the same key exactly once', () => {
    setGa4ConsentGranted(true);
    trackGa4EventOnce('channel_verified:c1:o1', 'channel_verified', { verification_method: 'fast' });
    trackGa4EventOnce('channel_verified:c1:o1', 'channel_verified', { verification_method: 'fast' });
    trackGa4EventOnce('channel_verified:c1:o1', 'channel_verified', { verification_method: 'fast' });
    expect(gtagCalls).toHaveLength(1);
  });
  it('7.2 a different key fires again (per-item semantics)', () => {
    setGa4ConsentGranted(true);
    trackGa4EventOnce('channel_verified:c1:o1', 'channel_verified', { verification_method: 'fast' });
    trackGa4EventOnce('channel_verified:c2:o2', 'channel_verified', { verification_method: 'fast' });
    expect(gtagCalls).toHaveLength(2);
  });
});

describe('M19.3 §8 — M18 Consent Mode v2 regression', () => {
  const ga = () => src('components/analytics/GoogleAnalytics.tsx');
  it('8.1 GA4 loader mounts NOTHING until consent is granted', () => {
    expect(ga()).toContain('if (!granted) return null');
  });
  it('8.2 Consent Mode default = denied for BOTH ad_* and analytics_storage', () => {
    const s = ga();
    // BASIC Consent Mode: ad_storage, ad_user_data, ad_personalization AND
    // analytics_storage all default to 'denied'.
    expect(s).toContain("gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});");
    // Ad storage never gets flipped to granted by us — only analytics_storage.
    expect(s).not.toMatch(/ad_storage:\s*'granted'/);
    expect(s).not.toMatch(/ad_user_data:\s*'granted'/);
    expect(s).not.toMatch(/ad_personalization:\s*'granted'/);
  });
  it('8.3 send_page_view is off and IP anonymisation is on', () => {
    const s = ga();
    expect(s).toContain('send_page_view:false');
    expect(s).toContain('anonymize_ip:true');
  });
  it('8.4 revoke path flips the module-level gate immediately', () => {
    const s = ga();
    expect(s).toContain('setGa4ConsentGranted(granted)');
    expect(s).toContain("gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' })");
  });
  it('8.5 page_view / event location goes through safeGa4Path (no PayPal token / PayerID leaks)', () => {
    const s = ga();
    expect(s).toContain('safeGa4Path(pathname');
    const ev = src('lib/analytics/events.ts');
    expect(ev).toContain('safeGa4Path(window.location.pathname');
  });
});

describe('M19.3 §9 — Support widget analytics (aggregate-only)', () => {
  const w = () => src('components/support/SupportWidget.tsx');
  it('9.1 support_widget_opened is fired ONLY through the canonical helper, no params', () => {
    const s = w();
    expect(s).toContain("trackGa4Event('support_widget_opened')");
    // Called with no params — no email, no ticket id, no body.
    expect(s).not.toMatch(/trackGa4Event\(\s*'support_widget_opened'\s*,\s*\{/);
  });
  it('9.2 support_conversation_started is emitted on server-confirmed create, no params', () => {
    const s = w();
    expect(s).toContain("trackGa4Event('support_conversation_started')");
    expect(s).not.toMatch(/trackGa4Event\(\s*'support_conversation_started'\s*,\s*\{/);
  });
  it('9.3 the widget still stores no token / ticket in localStorage / URL', () => {
    const s = w();
    expect(s).not.toMatch(/localStorage/);
    expect(s).not.toMatch(/sessionStorage/);
    expect(s).not.toMatch(/access_token/);
    expect(s).not.toMatch(/history\.(push|replace)State/);
  });
});
