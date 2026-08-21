import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Radio, Target, Compass, HandshakeIcon, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'For Brands — WaveLead',
  description: 'Reach real audiences through WhatsApp Channels. Discover relevant creators and request a sponsorship — WaveLead helps coordinate the partnership.',
  alternates: { canonical: '/for-brands' },
};

export default function ForBrandsPage() {
  return (
    <>
      <Header />
      <main>
        <section className="container py-14 md:py-20 max-w-5xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs">
            <Radio className="h-3.5 w-3.5" /> For Brands & Agencies
          </div>
          <h1 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight">Reach real audiences through WhatsApp Channels.</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            WaveLead is the independent growth infrastructure for WhatsApp Channels. Discover relevant channels, request a sponsorship, and our team helps coordinate the partnership.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/channels"><Button size="lg">Explore channels</Button></Link>
            <Link href="/top"><Button size="lg" variant="outline">See top channels</Button></Link>
          </div>
        </section>

        <section className="container pb-12 md:pb-20 max-w-5xl">
          <div className="grid md:grid-cols-3 gap-4">
            <Tile icon={<Compass className="h-5 w-5" />} title="1. Discover relevant channels" body="Browse verified WhatsApp Channels by category, country, and language. Pick the ones that match your audience." />
            <Tile icon={<Target className="h-5 w-5" />} title="2. Request sponsorship" body="Send a short brief — objective, budget range, and start date. No payment is collected at this stage." />
            <Tile icon={<HandshakeIcon className="h-5 w-5" />} title="3. We coordinate the partnership" body="WaveLead follows up manually, coordinates with the channel owner, and helps you close the deal." />
          </div>
        </section>

        <section className="border-t border-border/60 bg-secondary/20">
          <div className="container py-12 max-w-5xl grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-primary font-semibold"><ShieldCheck className="h-4 w-4" /> Straightforward and honest</div>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold">What this is — and what it isn&apos;t.</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Sponsorship on WaveLead is sales-assisted, not an automated marketplace. We&apos;re transparent about what&apos;s live today and what&apos;s coming.
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              <li><span className="text-emerald-600 font-semibold">Live today:</span> Discover verified channels. Request sponsorships. Analytics for owners. Paid promotion for owners (USD via PayPal).</li>
              <li><span className="text-amber-600 font-semibold">Coming later:</span> Automated matching, campaign delivery guarantees, and creator payouts. Full sponsorship marketplace.</li>
              <li><span className="text-muted-foreground">Not claimed:</span> Guaranteed reach, confirmed conversions, or automated payouts.</li>
            </ul>
          </div>
        </section>

        <section className="container py-14 max-w-5xl text-center">
          <h2 className="text-2xl md:text-3xl font-bold">Ready to find your first channel?</h2>
          <p className="mt-2 text-muted-foreground">Start by exploring who&apos;s on WaveLead.</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/channels"><Button size="lg">Explore Channels</Button></Link>
            <Link href="/categories"><Button size="lg" variant="outline">Browse Categories</Button></Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Tile({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="wh-card p-5">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <div className="mt-3 text-base font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
