import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl prose prose-slate">
        <h1 className="text-4xl font-bold">Terms of Service</h1>
        <p className="text-muted-foreground mt-2">Effective placeholder — the full legal document ships before public launch.</p>
        <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <div><h2 className="text-foreground font-semibold">1. About WaveLead</h2><p className="mt-2">WaveLead is an independent directory and growth platform for public WhatsApp Channels. WaveLead is not owned by or affiliated with WhatsApp or Meta.</p></div>
          <div><h2 className="text-foreground font-semibold">2. Acceptable use</h2><p className="mt-2">You may not submit false ownership claims, spam, unlawful, harassing, or NSFW content unless properly classified.</p></div>
          <div><h2 className="text-foreground font-semibold">3. Channel data</h2><p className="mt-2">Public channel data comes from owner submissions, administrator entry or permitted public information. We never store WhatsApp user identities.</p></div>
          <div><h2 className="text-foreground font-semibold">4. Changes</h2><p className="mt-2">These terms will be updated with the final legal version before general availability. Continued use constitutes acceptance.</p></div>
        </div>
      </main>
      <Footer />
    </>
  );
}
