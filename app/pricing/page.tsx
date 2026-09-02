import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import PricingClient from './PricingClient';

export const metadata: Metadata = { title: 'Pricing' };

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="container py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold">Pricing built for creators who monetize</h1>
          <p className="text-muted-foreground mt-4">Free covers the full sponsorship money loop — claim your channel, receive brand requests, deliver work, and get paid. Paid tiers add growth &amp; revenue intelligence and multi-channel operations when you&apos;re ready.</p>
        </div>
        <PricingClient />
      </main>
      <Footer />
    </>
  );
}
