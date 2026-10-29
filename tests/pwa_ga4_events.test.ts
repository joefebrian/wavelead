// PWA GA4 delivery: consent gate, parameter vocabularies, de-duplication,
// sensitive-URL scrubbing — through the canonical trackGa4Event helper.
import { beforeEach, describe, it, expect } from 'vitest';

type GtagCall = { command: string; args: unknown[] };
const calls: GtagCall[] = [];
const gtagFn = (...a: unknown[]): void => { const [cmd, ...rest] = a; calls.push({ command: String(cmd), args: rest }); };
type Loc = { origin: string; pathname: string; search: string };
const win: { location: Loc; gtag?: typeof gtagFn } = { location: { origin: 'https://wavelead.org', pathname: '/channels', search: '' }, gtag: gtagFn };
(globalThis as unknown as { window: typeof win }).window = win;
(globalThis as unknown as { document: unknown }).document = { referrer: '' };

import { trackGa4Event, trackGa4EventOnce, setGa4ConsentGranted, canSendGa4, _resetGa4EventsFiredForTest } from '@/lib/analytics/events';

const P = (i = 0) => calls[i].args[1] as Record<string, unknown>;

beforeEach(() => {
  calls.length = 0;
  win.location = { origin: 'https://wavelead.org', pathname: '/channels', search: '' };
  win.gtag = gtagFn;
  setGa4ConsentGranted(false);
  _resetGa4EventsFiredForTest();
});

describe('PWA GA4 events', () => {
  it('nothing is sent without analytics consent', () => {
    expect(canSendGa4()).toBe(false);
    trackGa4Event('pwa_install_cta_viewed', { pwa_platform: 'android' });
    expect(calls).toHaveLength(0);
    setGa4ConsentGranted(true);
    expect(canSendGa4()).toBe(true);
    win.gtag = undefined;
    expect(canSendGa4()).toBe(false); // GA4 not loaded
  });

  it('all seven events are allowlisted and carry the documented parameters', () => {
    setGa4ConsentGranted(true);
    const base = { pwa_platform: 'android', pwa_browser: 'chrome', pwa_display_mode: 'browser' };
    trackGa4Event('pwa_install_cta_viewed', { ...base, pwa_entry_point: 'auto_prompt', pwa_trigger: 'time_engagement' });
    trackGa4Event('pwa_install_cta_clicked', { ...base, pwa_entry_point: 'mobile_menu', pwa_trigger: 'manual', pwa_install_method: 'native_prompt' });
    trackGa4Event('pwa_ios_instructions_viewed', { pwa_platform: 'ios', pwa_browser: 'safari', pwa_display_mode: 'browser', pwa_entry_point: 'footer', pwa_trigger: 'manual', pwa_install_method: 'manual_a2hs' });
    trackGa4Event('pwa_install_prompt_accepted', { ...base, pwa_entry_point: 'auto_prompt', pwa_trigger: 'second_page', pwa_install_method: 'native_prompt' });
    trackGa4Event('pwa_install_prompt_dismissed', { ...base, pwa_entry_point: 'auto_prompt', pwa_trigger: 'second_page', pwa_install_method: 'native_prompt' });
    trackGa4Event('pwa_app_installed', { pwa_platform: 'android', pwa_browser: 'samsung_internet', pwa_install_method: 'native_prompt' });
    trackGa4Event('pwa_standalone_launched', { pwa_platform: 'ios', pwa_display_mode: 'standalone' });
    expect(calls.map((c) => c.args[0])).toEqual([
      'pwa_install_cta_viewed', 'pwa_install_cta_clicked', 'pwa_ios_instructions_viewed',
      'pwa_install_prompt_accepted', 'pwa_install_prompt_dismissed', 'pwa_app_installed', 'pwa_standalone_launched',
    ]);
    expect(P(0)).toMatchObject({ pwa_platform: 'android', pwa_browser: 'chrome', pwa_entry_point: 'auto_prompt', pwa_trigger: 'time_engagement', pwa_display_mode: 'browser' });
    expect(P(1)).toMatchObject({ pwa_install_method: 'native_prompt', pwa_entry_point: 'mobile_menu', pwa_trigger: 'manual' });
    expect(P(2)).toMatchObject({ pwa_platform: 'ios', pwa_install_method: 'manual_a2hs' });
    expect(P(6)).toEqual(expect.objectContaining({ pwa_platform: 'ios', pwa_display_mode: 'standalone' }));
    expect(P(6)).not.toHaveProperty('pwa_browser');
  });

  it('omitted / off-vocabulary values are dropped, not sent', () => {
    setGa4ConsentGranted(true);
    trackGa4Event('pwa_app_installed', { pwa_platform: 'android_chromium', pwa_browser: 'netscape', pwa_install_method: undefined, pwa_trigger: 'auto' });
    expect(P()).not.toHaveProperty('pwa_platform');
    expect(P()).not.toHaveProperty('pwa_browser');
    expect(P()).not.toHaveProperty('pwa_install_method');
    expect(P()).not.toHaveProperty('pwa_trigger');
  });

  it('once-keys de-duplicate re-renders of the same sheet opening', () => {
    setGa4ConsentGranted(true);
    for (let i = 0; i < 3; i++) trackGa4EventOnce('pwa_viewed:open-1', 'pwa_install_cta_viewed', { pwa_platform: 'android' });
    trackGa4EventOnce('pwa_viewed:open-2', 'pwa_install_cta_viewed', { pwa_platform: 'android' });
    expect(calls).toHaveLength(2);
  });

  it('sensitive URLs are scrubbed from page_location', () => {
    setGa4ConsentGranted(true);
    win.location = { origin: 'https://wavelead.org', pathname: '/channels', search: '?token=EC-SECRET&PayerID=ABC' };
    trackGa4Event('pwa_install_cta_viewed', { pwa_platform: 'android' });
    expect(String(P().page_location)).not.toContain('EC-SECRET');
    expect(String(P().page_location)).not.toContain('PayerID');
  });
});
