// M11-Batch4 — Pre-Public-Beta commercial repositioning.
//
// Verifies live surfaces / static copy only. No new payments, no billing
// implementation, no owner data mutation. Covers §20 validation matrix
// items that can be verified from HTML output + already-passing regression
// suites.
import { describe, it, expect } from 'vitest';

const PAGE = 'http://localhost:3000';

async function pageGet(path: string): Promise<{ status: number; html: string }> {
  const r = await fetch(`${PAGE}${path}`);
  // Strip React SSR text-boundary comments (<!-- -->) that get inserted
  // between adjacent JSX text/expression nodes. They make assertions on
  // human-readable copy brittle without changing what the user sees.
  const html = (await r.text()).replace(/<!--\s*-->/g, '');
  return { status: r.status, html };
}

describe('M11-Batch4 — Brand-first pricing', () => {
  it('renders BRAND FREE / BRAND PRO $15 / FOUNDING LIFETIME $100 / ENTERPRISE tiles', async () => {
    const r = await pageGet('/pricing');
    expect(r.status).toBe(200);
    // Brand tiers exist as testids.
    for (const t of ['pricing-card-brand_free', 'pricing-card-brand_pro', 'pricing-card-brand_founding_lifetime', 'pricing-card-enterprise']) {
      expect(r.html).toContain(`data-testid="${t}"`);
    }
    // Prices are truthful and visible.
    expect(r.html).toContain('$0');
    expect(r.html).toContain('$15 / month');
    expect(r.html).toContain('Founding Beta');
    expect(r.html).toContain('$25 / month');   // post-beta rate quoted honestly
    expect(r.html).toContain('$100');
    expect(r.html).toContain('Public Beta Offer');
    expect(r.html).toContain('Custom');
  });

  it('Founding Lifetime carries honest limitation copy (no unlimited promises)', async () => {
    const r = await pageGet('/pricing');
    expect(r.html).toMatch(/does NOT include future Enterprise capabilities/);
    expect(r.html).toMatch(/does NOT include unlimited API/);
    expect(r.html).toMatch(/Priority product support/);
    // Never promise "Unlimited lifetime support".
    expect(r.html).not.toMatch(/Unlimited lifetime support/i);
  });

  it('Brand Pro surfaces AI Campaign Brief + Recommended Channels as Coming Soon (not shipping claims)', async () => {
    const r = await pageGet('/pricing');
    expect(r.html).toMatch(/AI Campaign Brief/);
    expect(r.html).toMatch(/Recommended Channels for This Campaign/);
    expect(r.html).toContain('data-testid="feature-badge-coming-soon"');
    // No fake shipping claims.
    expect(r.html).not.toMatch(/AI Campaign Brief[^<]*Available now/i);
  });

  it('renders separate Channel Owner section: List Free, Marketplace Free, $1 Activation, Promote pay-as-you-go', async () => {
    const r = await pageGet('/pricing');
    expect(r.html).toContain('data-testid="channel-owner-pricing"');
    expect(r.html).toContain('data-testid="owner-tile-list"');
    expect(r.html).toContain('data-testid="owner-tile-marketplace"');
    expect(r.html).toContain('data-testid="owner-tile-activation"');
    expect(r.html).toContain('data-testid="owner-tile-promote"');
    expect(r.html).toMatch(/\$1 per channel/);
    expect(r.html).toMatch(/one-time activation transaction/i);
    // Never call activation a subscription.
    expect(r.html).not.toMatch(/\$1[^<]*subscription/i);
    // Activation rollout is honestly labeled coming-soon (production flag OFF).
    expect(r.html).toContain('data-testid="activation-rollout-pill"');
    expect(r.html).toMatch(/Rollout Coming Soon/);
  });

  it('brand billing note discloses 3-month Beta price + then $25 + Founding Lifetime one-time nature', async () => {
    const r = await pageGet('/pricing');
    expect(r.html).toContain('data-testid="brand-billing-note"');
    expect(r.html).toMatch(/first 3 months/);
    expect(r.html).toMatch(/\$25\s*\/\s*month/);
    expect(r.html).toMatch(/one-time \$100/);
    expect(r.html).toMatch(/Public Beta/);
  });
});

describe('M11-Batch4 — Footer redesign', () => {
  it('renders 4-column structure (WaveLead, Discover, Channel Owners, Brands & Agencies)', async () => {
    const r = await pageGet('/');
    expect(r.status).toBe(200);
    expect(r.html).toContain('data-testid="footer"');
    // Attribution present.
    expect(r.html).toContain('data-testid="footer-attribution"');
    expect(r.html).toMatch(/A product by P2P Labs/);
    // Column headers visible.
    for (const label of ['Discover', 'Channel Owners', 'Brands &amp; Agencies']) {
      expect(r.html).toContain(label);
    }
    // Legal row links.
    for (const key of ['about', 'privacy', 'terms', 'cookie-policy', 'contact']) {
      expect(r.html).toContain(`data-testid="footer-legal-${key}"`);
    }
    // Cookie preferences trigger preserved.
    expect(r.html).toContain('data-testid="footer-cookie-preferences"');
    // Independence disclosure.
    expect(r.html).toMatch(/independently developed by P2P Labs/);
    expect(r.html).toMatch(/not affiliated with, endorsed by, or an official product of WhatsApp or Meta/);
  });

  it('legacy nested Company block is gone', async () => {
    const r = await pageGet('/');
    // Old footer had a "Company" subsection nested awkwardly under the brand
    // column. That is removed in the redesign.
    expect(r.html).not.toMatch(/>\s*Company\s*</);
  });
});

describe('M11-Batch4 — Homepage dual-audience emphasis', () => {
  it('hero surfaces both audiences and a prominent Brand CTA', async () => {
    const r = await pageGet('/');
    expect(r.html).toContain('data-testid="hero-h1"');
    expect(r.html).toMatch(/The Growth &amp; Monetization Platform for WhatsApp Channels/);
    expect(r.html).toMatch(/For Channel Owners/);
    expect(r.html).toMatch(/For Brands/);
    // Primary CTA is Brand-focused now.
    expect(r.html).toMatch(/Start a Campaign/i);
  });
});

describe('M11-Batch4 — Consent + P2P attribution unchanged', () => {
  it('consent banner + cookie preferences trigger unchanged on homepage', async () => {
    const r = await pageGet('/');
    // Cookie preferences trigger still surfaced in footer.
    expect(r.html).toContain('data-testid="footer-cookie-preferences"');
    // P2P Labs attribution still present.
    expect(r.html).toMatch(/P2P Labs/);
  });
});
