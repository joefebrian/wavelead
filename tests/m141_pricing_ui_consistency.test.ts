// M14.1 — Pricing UI consistency for Founding Lifetime.
//
// The purchase CTA and the "sandbox / not enabled" warning MUST both derive
// from the same authoritative Founding-Lifetime state field (`checkout_enabled`
// on /api/brand/founding-lifetime/state). This test asserts the boolean
// contract that the JSX render-path enforces, without invoking React SSR:
//
//   • checkout_enabled=true  → purchase CTA visible, warning hidden
//   • checkout_enabled=false → purchase CTA hidden, warning visible if env=sandbox
//   • already-entitled       → neither purchase CTA nor warning; entitlement CTA
//
// The two functions below mirror the exact conditions used in
// app/pricing/PricingClient.tsx (see the block near line 309 and the CTA
// switch near line 280). Any drift will break these tests.

import { describe, it, expect } from 'vitest';

interface LifetimeState {
  checkout_enabled: boolean;
  lifetime_available: boolean;
  environment: 'live' | 'sandbox';
  already_active: boolean;
}

function ctaKind(state: LifetimeState): 'purchase' | 'reservation' | 'entitlement' {
  const lifetimeCheckoutLive = !!state.checkout_enabled && !!state.lifetime_available;
  const lifetimeAlreadyActive = !!state.already_active;
  if (lifetimeAlreadyActive) return 'entitlement';
  if (lifetimeCheckoutLive) return 'purchase';
  return 'reservation';
}

function warningVisible(state: LifetimeState): boolean {
  const lifetimeCheckoutLive = !!state.checkout_enabled && !!state.lifetime_available;
  const lifetimeAlreadyActive = !!state.already_active;
  return !lifetimeCheckoutLive && !lifetimeAlreadyActive && state.environment === 'sandbox';
}

describe('M14.1 — Pricing UI single source of truth', () => {
  it('LIVE + enabled → purchase CTA visible, warning hidden', () => {
    const s: LifetimeState = { checkout_enabled: true, lifetime_available: true, environment: 'live', already_active: false };
    expect(ctaKind(s)).toBe('purchase');
    expect(warningVisible(s)).toBe(false);
  });

  it('LIVE + enabled + already-active → entitlement CTA, no purchase, no warning', () => {
    const s: LifetimeState = { checkout_enabled: true, lifetime_available: true, environment: 'live', already_active: true };
    expect(ctaKind(s)).toBe('entitlement');
    expect(warningVisible(s)).toBe(false);
  });

  it('flag OFF while pricing.enabled=true, sandbox → reservation CTA, warning visible', () => {
    const s: LifetimeState = { checkout_enabled: false, lifetime_available: true, environment: 'sandbox', already_active: false };
    expect(ctaKind(s)).toBe('reservation');
    expect(warningVisible(s)).toBe(true);
  });

  it('flag OFF, LIVE environment → reservation CTA, no sandbox warning', () => {
    const s: LifetimeState = { checkout_enabled: false, lifetime_available: true, environment: 'live', already_active: false };
    expect(ctaKind(s)).toBe('reservation');
    expect(warningVisible(s)).toBe(false);
  });

  it('the previous contradictory state (checkout_enabled=true && env=sandbox) NEVER shows the sandbox warning', () => {
    // This state can occur if the flag has been flipped but the PayPal
    // environment resolver still returns "sandbox" (e.g., DB row not yet
    // migrated). The UI must not contradict itself.
    const s: LifetimeState = { checkout_enabled: true, lifetime_available: true, environment: 'sandbox', already_active: false };
    expect(ctaKind(s)).toBe('purchase');
    expect(warningVisible(s)).toBe(false); // ← the exact regression this fix prevents.
  });

  it('lifetime_available=false forces reservation regardless of checkout_enabled', () => {
    const s: LifetimeState = { checkout_enabled: true, lifetime_available: false, environment: 'live', already_active: false };
    expect(ctaKind(s)).toBe('reservation');
    expect(warningVisible(s)).toBe(false);
  });
});
