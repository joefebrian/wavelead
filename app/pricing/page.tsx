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
          <h1 className="text-4xl md:text-5xl font-bold">Simple, creator-friendly pricing</h1>
          <p className="text-muted-foreground mt-4">Discovery is always free. Follow-intent analytics, verified profiles, and channel promotion (via PayPal) are already shipped. Pro subscription plans and local IDR checkout are coming soon.</p>
        </div>
        <PricingClient />
      </main>
      <Footer />
    </>
  );
}
