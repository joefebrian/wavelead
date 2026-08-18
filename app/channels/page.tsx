import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = { title: 'Channels' };

export default function ChannelsPage() {
  return (
    <>
      <Header />
      <main className="container py-16">
        <h1 className="text-3xl font-bold">Discover Channels</h1>
        <p className="text-muted-foreground mt-2">The full discovery experience launches in Milestone 01.</p>
        <div className="mt-8 wh-card p-8 text-center"><p className="text-muted-foreground">Discovery UI coming next.</p></div>
      </main>
      <Footer />
    </>
  );
}
