import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = { title: 'Submit Channel' };

export default function SubmitPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-2xl">
        <h1 className="text-3xl font-bold">Submit your WhatsApp Channel</h1>
        <p className="text-muted-foreground mt-2">The submission form ships in Milestone 02. Sign up so we can invite you the moment it opens.</p>
        <div className="mt-8 wh-card p-6">
          <div className="font-semibold">What we&apos;ll ask for</div>
          <ul className="mt-3 text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Public WhatsApp Channel URL</li>
            <li>Name, short description, category, primary language and country</li>
            <li>Logo / cover image (optional)</li>
            <li>Ownership verification (later)</li>
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}
