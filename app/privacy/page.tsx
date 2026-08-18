import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-4xl font-bold">Privacy</h1>
        <p className="text-muted-foreground mt-2">Effective placeholder — the full privacy policy ships before public launch.</p>
        <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <div><h2 className="text-foreground font-semibold">What we collect</h2><p className="mt-2">Account email, display name, session cookie, and anonymous analytics events used to power discovery. We do not sell your data.</p></div>
          <div><h2 className="text-foreground font-semibold">What we don&apos;t collect</h2><p className="mt-2">We do not store WhatsApp user identities, phone numbers, or private WhatsApp data. We do not use unofficial WhatsApp APIs.</p></div>
          <div><h2 className="text-foreground font-semibold">Cookies</h2><p className="mt-2">We use a first-party session cookie (`wl_session`) so you can stay logged in. No third-party ad tracking.</p></div>
          <div><h2 className="text-foreground font-semibold">Contact</h2><p className="mt-2">Questions: privacy@wavelead.dev</p></div>
        </div>
      </main>
      <Footer />
    </>
  );
}
