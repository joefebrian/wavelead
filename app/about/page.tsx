import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'About WaveLead — a product by P2P Labs',
  description: 'WaveLead is the growth and monetization infrastructure for WhatsApp Channels. A product by P2P Labs — independent from WhatsApp and Meta.',
};

export default function AboutPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl" data-testid="about-page">
        <div className="text-xs uppercase tracking-widest text-primary font-semibold" data-testid="about-p2p-attribution">A product by P2P Labs</div>
        <h1 className="text-4xl font-bold mt-2">About WaveLead</h1>
        <p className="text-lg text-muted-foreground mt-4">
          WaveLead is a product by P2P Labs. We are building the growth and monetization infrastructure for
          WhatsApp Channels — helping channel owners understand performance, grow audiences, manage sponsorships and
          turn attention into revenue.
        </p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed">
          <p>
            For brands and agencies, WaveLead provides a discovery and sponsorship layer to find relevant channels,
            book opportunities and manage campaign delivery.
          </p>
          <p>
            Our public directory is free for readers. Channel owners can grow their audiences using WaveLead&apos;s
            follow-intent analytics, verified profiles, and channel promotion. Sponsorship revenue on the marketplace
            splits 90/10 to the owner after actual payment gateway fees.
          </p>
        </div>
        <section
          className="mt-10 wh-card p-6 border-primary/30 bg-primary/5"
          data-testid="about-independence-disclosure"
        >
          <div className="font-semibold">Independence disclosure</div>
          <p className="text-sm text-muted-foreground mt-2">
            WaveLead is independently developed by P2P Labs and is <strong>not affiliated with, endorsed by, or an
            official product of WhatsApp or Meta</strong>. WhatsApp is a trademark of Meta Platforms, Inc.
          </p>
        </section>
        <div className="mt-10 wh-card p-6">
          <div className="font-semibold">Contact P2P Labs</div>
          <p className="text-sm text-muted-foreground mt-2">
            For publishers, brands, sports organizations, agencies and creator networks:
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="mailto:hello@p2plabs.asia"><Button>Contact us</Button></a>
            <Link href="/pricing"><Button variant="outline">View pricing</Button></Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
