import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Trophy } from 'lucide-react';

export const metadata: Metadata = { title: 'Top Channels' };

export default function TopPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
          <h1 className="text-3xl font-bold">Top-ranked channels</h1>
        </div>
        <p className="text-muted-foreground mt-4">
          The all-time top leaderboard — ranked by WaveScore — launches with our discovery UI in Milestone 01.
        </p>
        <div className="mt-8 wh-card p-8">
          <div className="font-semibold">Preview</div>
          <p className="mt-3 text-sm text-muted-foreground">
            Rankings will be built from a combination of Follow Intent volume, follower count sources and profile engagement. Only approved channels are eligible.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/channels"><Button>Browse all channels</Button></Link>
            <Link href="/trending"><Button variant="outline">See trending</Button></Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
