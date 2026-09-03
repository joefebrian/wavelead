// M11-Batch4 — Footer redesign.
//
// Clean 4-column desktop layout (WaveLead / Discover / Channel Owners /
// Brands & Agencies). Tablet 2×2. Mobile stacked. No horizontal overflow,
// no nested Company block. Bottom legal row keeps P2P Labs attribution +
// consent trigger.
import Link from 'next/link';
import { Radio } from 'lucide-react';
import CookiePreferencesTrigger from '@/components/consent/CookiePreferencesTrigger';

const DISCOVER = [
  { href: '/channels', label: 'All Channels' },
  { href: '/channels?sort=trending', label: 'Trending' },
  { href: '/channels?sort=top', label: 'Top Channels' },
  { href: '/categories', label: 'Categories' },
  { href: '/countries', label: 'Countries' },
];

const OWNERS = [
  { href: '/submit', label: 'Submit Channel' },
  { href: '/dashboard', label: 'Owner Dashboard' },
  { href: '/dashboard/monetization', label: 'Monetization' },
  { href: '/pricing', label: 'Pricing' },
];

const BRANDS = [
  { href: '/brand', label: 'For Brands' },
  { href: '/channels', label: 'Discover Channels' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login?next=/brand', label: 'Sign In' },
];

const LEGAL = [
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/cookies', label: 'Cookie Policy' },
  { href: '/contact', label: 'Contact' },
];

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-background" data-testid="footer">
      <div className="container py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {/* COL 1 — WaveLead brand */}
        <div>
          <Link href="/" className="inline-flex items-center gap-2 font-semibold">
            <Radio className="h-5 w-5 text-primary" />
            <span>WaveLead</span>
          </Link>
          <p className="mt-2 text-xs font-medium text-muted-foreground" data-testid="footer-attribution">A product by P2P Labs</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Helping WhatsApp Channels grow, monetize and connect with brands.
          </p>
        </div>

        {/* COL 2 — Discover */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Discover</div>
          <ul className="mt-3 space-y-2 text-sm">
            {DISCOVER.map((l) => (
              <li key={l.href}><Link href={l.href} className="hover:text-foreground text-muted-foreground">{l.label}</Link></li>
            ))}
          </ul>
        </div>

        {/* COL 3 — Channel Owners */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channel Owners</div>
          <ul className="mt-3 space-y-2 text-sm">
            {OWNERS.map((l) => (
              <li key={l.href}><Link href={l.href} className="hover:text-foreground text-muted-foreground">{l.label}</Link></li>
            ))}
          </ul>
        </div>

        {/* COL 4 — Brands & Agencies */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Brands &amp; Agencies</div>
          <ul className="mt-3 space-y-2 text-sm">
            {BRANDS.map((l) => (
              <li key={l.href}><Link href={l.href} className="hover:text-foreground text-muted-foreground">{l.label}</Link></li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom legal row */}
      <div className="border-t border-border/60">
        <div className="container py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>© {new Date().getFullYear()} P2P Labs. WaveLead is a product by P2P Labs.</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legal">
            {LEGAL.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-foreground" data-testid={`footer-legal-${l.label.toLowerCase().replace(/\s+/g, '-')}`}>{l.label}</Link>
            ))}
            <CookiePreferencesTrigger />
          </nav>
        </div>
        <div className="container pb-4 text-[11px] text-muted-foreground/80">
          WaveLead is independently developed by P2P Labs and is not affiliated with, endorsed by, or an official product of WhatsApp or Meta.
        </div>
      </div>
    </footer>
  );
}
