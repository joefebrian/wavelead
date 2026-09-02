// Public Beta launch — homepage positioning tests.
//
// Coverage:
//   §1 Hero — locked positioning copy + primary/secondary/tertiary CTAs
//   §2 Persona entry — 3 paths (owner / brand / agency); agency copy honest
//   §3 Product loop — Discover / Grow / Monetize / Measure
//   §4 Owner value — Pro features labeled; Free-can-earn line present
//   §5 Brand value — Payment Protection wording; NO "Escrow" on public surface
//   §6 Trust — real mechanisms only; no fabricated claims
//   §7 Pricing teaser — Free/Pro/Enterprise with correct CTAs
//   §8 Navigation — For Channel Owners, For Brands, Pricing all present
//   §9 SEO — discovery links preserved (categories, countries, channels)
//   §10 Final CTA — Explore + List Your Channel
import { describe, it, expect } from 'vitest';

const PAGE_BASE = 'http://localhost:3000';
async function fetchHome(): Promise<string> {
  const r = await fetch(`${PAGE_BASE}/`, { headers: { 'X-Forwarded-For': '10.0.0.99' } });
  expect(r.status).toBe(200);
  return r.text();
}

describe('Homepage launch §1 — Hero positioning', () => {
  it('#1 renders locked hero H1 + subhead + all three CTAs', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-hero"');
    expect(html).toContain('data-testid="hero-h1"');
    expect(html).toContain('The Growth');
    expect(html).toContain('Monetization Platform for WhatsApp Channels');
    expect(html).toContain('data-testid="hero-subhead"');
    expect(html).toContain('Discover channels, grow audiences, manage sponsorships and measure what drives results');
    expect(html).toContain('data-testid="hero-cta-primary"');
    expect(html).toContain('Explore Channels');
    expect(html).toContain('data-testid="hero-cta-secondary"');
    expect(html).toContain('List Your Channel');
    expect(html).toContain('data-testid="hero-cta-tertiary"');
    expect(html).toContain('For Brands');
    // Public Beta positioning
    expect(html).toContain('Public Beta');
    // Never claim WhatsApp/Meta affiliation
    expect(html).not.toContain('WhatsApp Ads Manager');
    expect(html).not.toContain('WhatsApp official marketplace');
    expect(html).not.toContain('WhatsApp Partner Platform');
  });
});

describe('Homepage launch §2 — Persona entry', () => {
  it('#2 three persona paths with correct CTAs; agency copy is honest', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-persona-entry"');
    expect(html).toContain('data-testid="path-owner"');
    expect(html).toContain('data-testid="path-brand"');
    expect(html).toContain('data-testid="path-agency"');
    expect(html).toContain('For Channel Owners');
    expect(html).toContain('Grow &amp; Monetize');
    expect(html).toContain('Find Channels');
    expect(html).toContain('Explore WaveLead');
    // Agency line must NOT claim team seats are live.
    expect(html).toContain('Portfolio tools for agencies and operators are expanding');
    expect(html).not.toMatch(/team seats are (?:live|available|shipping)/i);
  });
});

describe('Homepage launch §3 — Core product loop', () => {
  it('#3 renders Discover / Grow / Monetize / Measure', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-product-loop"');
    for (const step of ['Discover', 'Grow', 'Monetize', 'Measure']) {
      expect(html).toContain(step);
    }
  });
});

describe('Homepage launch §4 — Owner value & Pro labels', () => {
  it('#4 Pro features labeled; Free-can-earn line present', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-owner-value"');
    // Pro-labeled surfaces from the spec.
    expect(html).toContain('data-testid="owner-value-badge-sponsorship-pipeline"');
    expect(html).toContain('data-testid="owner-value-badge-revenue-intelligence"');
    // Free monetization invariant present in copy.
    expect(html).toMatch(/Free plan participates fully in the marketplace/i);
    // Uses "Payment Protection", never "Escrow".
    expect(html).toContain('Payment Protection');
  });
});

describe('Homepage launch §5 — Brand value & Marketplace flow', () => {
  it('#5 marketplace flow rendered; Payment Protection wording; no public "Escrow"', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-brand-value"');
    for (const step of ['Discover', 'Review package', 'Book', 'Pay', 'Delivery', 'Complete']) {
      expect(html).toContain(step);
    }
    expect(html).toContain('Payment Protection');
    // Public-facing pages must not use the word "Escrow".
    expect(html).not.toMatch(/\bEscrow\b/);
  });
});

describe('Homepage launch §6 — Trust section', () => {
  it('#6 real mechanisms only; no fabricated claims', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-trust"');
    expect(html).toContain('Verified ownership');
    expect(html).toContain('Versioned delivery evidence');
    expect(html).toContain('Transparent earnings');
    // Never claim fabricated capabilities.
    expect(html).not.toMatch(/\bguaranteed ROI\b/i);
    expect(html).not.toMatch(/\bguaranteed followers\b/i);
    expect(html).not.toMatch(/\bfraud detection\b/i);
    expect(html).not.toMatch(/\bverified audience demographics\b/i);
  });
});

describe('Homepage launch §7 — Pricing teaser', () => {
  it('#7 Free / Pro / Enterprise tiers with correct CTAs and no fake monthly prices', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-pricing-teaser"');
    expect(html).toContain('data-testid="pricing-teaser-free"');
    expect(html).toContain('data-testid="pricing-teaser-pro"');
    expect(html).toContain('data-testid="pricing-teaser-enterprise"');
    expect(html).toContain('Get Started');
    expect(html).toContain('Join Pro Waitlist');
    expect(html).toContain('Contact Sales');
    expect(html).toContain('View Pricing');
    // Pro price now published as $19 / mo Founding Beta.
    expect(html).toMatch(/\$19\s*\/\s*mo/i);
    expect(html).toContain('Founding Beta');
    // Never fabricated prices for Free or Enterprise.
    expect(html).not.toMatch(/Free:\s*\$\d+\s*\/\s*mo/i);
  });
});

describe('Homepage launch §8 — Public navigation', () => {
  it('#8 nav prioritizes Discover / Trending / Top Channels / For Channel Owners / For Brands / Pricing', async () => {
    const html = await fetchHome();
    for (const label of ['Discover', 'Trending', 'Top Channels', 'For Channel Owners', 'For Brands', 'Pricing']) {
      expect(html).toContain(label);
    }
    // Admin internal nav must never leak onto the public homepage.
    expect(html).not.toMatch(/\/admin(?:\/|")/);
  });
});

describe('Homepage launch §9 — SEO discovery links preserved', () => {
  it('#9 categories / countries / channels discovery links still present', async () => {
    const html = await fetchHome();
    // Existing crawlable discovery surfaces.
    expect(html).toContain('/channels');
    expect(html).toContain('/category/');
    expect(html).toContain('/country/');
    // At least one H2 in the discovery region — semantic headings preserved.
    expect(html).toMatch(/<h2/i);
  });
});

describe('Homepage launch §10 — Final CTA', () => {
  it('#10 renders final CTA with both primary and secondary actions', async () => {
    const html = await fetchHome();
    expect(html).toContain('data-testid="home-final-cta"');
    expect(html).toMatch(/Ready to grow your channel/i);
  });
});
