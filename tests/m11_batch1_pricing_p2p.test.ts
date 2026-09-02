// Commercial Launch — Batch 1 (Pricing update + P2P Labs attribution).
//
// Verifies:
//   §1 Free = $0 / Forever, Pro = $19 / month Founding Beta, Enterprise = Custom
//   §2 Pro CTA remains "Join Pro Waitlist" (no recurring billing added)
//   §3 P2P Labs footer attribution
//   §4 About page — P2P Labs positioning + independence disclosure
//   §5 Public copy invariants — no "affiliated with WhatsApp/Meta" claims
import { describe, it, expect } from 'vitest';

const PAGE = 'http://localhost:3000';
async function html(path: string): Promise<string> {
  const r = await fetch(`${PAGE}${path}`, { headers: { 'X-Forwarded-For': '10.0.0.55' } });
  expect(r.status).toBe(200);
  return r.text();
}

describe('Commercial launch B1 §1 — Pricing update', () => {
  it('#1 /pricing publishes Free $0 Forever, Pro $19/month Founding Beta, Enterprise Custom', async () => {
    const h = await html('/pricing');
    expect(h).toMatch(/\$0/);
    expect(h).toMatch(/Forever/i);
    expect(h).toMatch(/\$19\s*\/\s*month/i);
    expect(h).toContain('Founding Beta');
    expect(h).toMatch(/Custom/);
    // CTAs unchanged — no recurring billing surface.
    expect(h).toContain('Get Started');
    expect(h).toContain('Join Pro Waitlist');
    expect(h).toContain('Contact Sales');
    // No recurring billing / Stripe / PayPal-subscription verbiage introduced.
    expect(h).not.toMatch(/\bStart Subscription\b/i);
    expect(h).not.toMatch(/\bStart Free Trial\b/i);
    expect(h).not.toMatch(/\bCheckout\b/i);
  });

  it('#2 homepage teaser shows Free/Pro/Enterprise + $19 real price + Founding Beta status', async () => {
    const h = await html('/');
    expect(h).toContain('data-testid="pricing-teaser-free"');
    expect(h).toContain('data-testid="pricing-teaser-pro"');
    expect(h).toContain('data-testid="pricing-teaser-enterprise"');
    expect(h).toContain('Founding Beta');
    expect(h).toMatch(/\$19\s*\/\s*mo/i);
    expect(h).toContain('$0 Forever');
  });
});

describe('Commercial launch B1 §2 — P2P Labs attribution', () => {
  it('#3 Footer shows P2P Labs attribution and full company nav (Privacy/Terms/Cookies)', async () => {
    const h = await html('/');
    expect(h).toContain('data-testid="footer-attribution"');
    expect(h).toContain('P2P Labs');
    // Company column now includes Cookie Policy + Cookie Preferences (Batch 3 will make preferences interactive).
    expect(h).toContain('/privacy');
    expect(h).toContain('/terms');
    expect(h).toContain('/cookies');
    expect(h).toContain('Cookie Preferences');
    expect(h).toContain('mailto:hello@p2plabs.asia');
  });

  it('#4 Footer includes explicit independence disclosure', async () => {
    const h = await html('/');
    expect(h).toMatch(/Not affiliated with, endorsed by, or an official product of WhatsApp or Meta/i);
  });
});

describe('Commercial launch B1 §3 — About WaveLead', () => {
  it('#5 /about renders with P2P Labs positioning + independence disclosure block', async () => {
    const h = await html('/about');
    expect(h).toContain('data-testid="about-page"');
    expect(h).toContain('data-testid="about-p2p-attribution"');
    expect(h).toContain('A product by P2P Labs');
    expect(h).toContain('data-testid="about-independence-disclosure"');
    expect(h).toMatch(/not affiliated with, endorsed by, or an official product of WhatsApp or Meta/i);
    // Core positioning present.
    expect(h).toMatch(/growth and monetization infrastructure for\s+WhatsApp Channels/i);
    expect(h).toMatch(/manage sponsorships/i);
    expect(h).toMatch(/discovery and sponsorship layer/i);
  });
});

describe('Commercial launch B1 §4 — No false affiliation anywhere public', () => {
  it('#6 homepage / pricing / about all avoid banned affiliation claims', async () => {
    for (const path of ['/', '/pricing', '/about']) {
      const h = await html(path);
      expect(h).not.toContain('WhatsApp Ads Manager');
      expect(h).not.toContain('WhatsApp official marketplace');
      expect(h).not.toContain('WhatsApp Partner Platform');
      expect(h).not.toMatch(/official\s+(?:WhatsApp|Meta)\s+product/i);
    }
  });
});
