import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-4xl font-bold">About WaveLead</h1>
        <p className="text-lg text-muted-foreground mt-4">
          WaveLead is the growth infrastructure for WhatsApp Channels. We help people discover public channels
          and help creators grow, measure and eventually monetize their audience.
        </p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <p>WaveLead is an <strong>independent</strong> platform. We are not owned by, endorsed by or affiliated with WhatsApp or Meta.</p>
          <p>Our public directory is free for readers forever. Channel owners can eventually access analytics, promotion and verified profiles through WaveLead Pro.</p>
          <p>We take a strict privacy stance: we never store WhatsApp user identities and never use unofficial APIs.</p>
        </div>
        <div className="mt-10 wh-card p-6">
          <div className="font-semibold">Enterprise & partnerships</div>
          <p className="text-sm text-muted-foreground mt-2">For publishers, brands, sports organizations, agencies and creator networks:</p>
          <div className="mt-4 flex gap-3">
            <a href="mailto:hello@wavelead.dev"><Button>Contact us</Button></a>
            <Link href="/pricing"><Button variant="outline">View pricing</Button></Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
