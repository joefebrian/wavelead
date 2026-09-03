import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import PricingClient from './PricingClient';
import { pricingConfigService } from '@/lib/services/pricingConfigService';

export const metadata: Metadata = { title: 'Pricing' };
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const pricing = await pricingConfigService.getPublicPricing();
  return (
    <>
      <Header />
      <main className="container py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold">Pricing for brands and channel owners</h1>
          <p className="text-muted-foreground mt-4">
            Brand Free covers marketplace participation. Brand Pro adds campaign intelligence &amp; sponsorship
            operations. Channel Owners list, publish packages and earn for free.
          </p>
        </div>
        <PricingClient pricing={pricing} />
      </main>
      <Footer />
    </>
  );
}
