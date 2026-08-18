import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TrendingUp } from 'lucide-react';

export const metadata: Metadata = { title: 'Trending' };

export default function TrendingPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary"><TrendingUp className="h-5 w-5" /></span>
          <h1 className="text-3xl font-bold">Trending on WaveLead</h1>
        </div>
        <p className="text-muted-foreground mt-4">
          The full trending ranking — based on recent follow-intent velocity and WaveScore — launches in Milestone 03 once the tracking layer is live.
        </p>
        <div className="mt-8 wh-card p-8">
          <div className="font-semibold">What&apos;s coming</div>
          <ul className="mt-3 text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Real-time trending across categories and countries</li>
            <li>WaveScore momentum ranking</li>
            <li>Featured slots and creator spotlights</li>
          </ul>
          <div className="mt-6 flex gap-3">
            <Link href="/channels"><Button>Browse all channels</Button></Link>
            <Link href="/submit"><Button variant="outline">Submit your channel</Button></Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
