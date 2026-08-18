import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

export const metadata: Metadata = { title: 'Pricing' };

interface Plan { name: string; price: string; blurb: string; features: string[]; cta: string; href: string; highlight?: boolean; }

const PLANS: Plan[] = [
  { name: 'Free', price: '$0', blurb: 'Discovery & basic ownership.', cta: 'Get started', href: '/signup', features: ['Public directory access', 'Claim one channel', 'Basic profile listing'] },
  { name: 'Pro', price: 'Coming soon', blurb: 'Analytics, growth & promotion.', cta: 'Notify me', href: '/signup', highlight: true, features: ['Follow-intent analytics', 'WaveScore insights', 'Promotion & featured slots', 'Verified badge'] },
  { name: 'Enterprise', price: 'Custom', blurb: 'For brands, publishers & networks.', cta: 'Contact sales', href: '/about', features: ['Bulk channel management', 'Custom growth partnership', 'API access (planned)', 'Dedicated support'] },
];

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="container py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold">Simple, creator-friendly pricing</h1>
          <p className="text-muted-foreground mt-4">Discovery is always free. Paid plans launch alongside analytics in a later milestone.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div key={plan.name} className={`wh-card p-6 flex flex-col ${plan.highlight ? 'ring-2 ring-primary/60' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">{plan.name}</div>
                {plan.highlight && <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded-full">Popular</span>}
              </div>
              <div className="mt-3 text-3xl font-bold">{plan.price}</div>
              <p className="text-sm text-muted-foreground mt-1">{plan.blurb}</p>
              <ul className="mt-5 space-y-2 text-sm flex-1">
                {plan.features.map((f) => (<li key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary mt-0.5" /><span>{f}</span></li>))}
              </ul>
              <Link href={plan.href} className="mt-6"><Button className="w-full" variant={plan.highlight ? 'default' : 'outline'}>{plan.cta}</Button></Link>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-xs text-muted-foreground">Pricing shown is directional. Live billing and Pro features arrive in a future milestone.</p>
      </main>
      <Footer />
    </>
  );
}
