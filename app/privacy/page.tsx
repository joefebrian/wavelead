import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = { title: 'Privacy', description: 'WaveLead privacy notice — a product by P2P Labs.' };

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl" data-testid="privacy-page">
        <h1 className="text-4xl font-bold">Privacy</h1>
        <p className="text-muted-foreground mt-2">
          WaveLead is a product by P2P Labs. This notice reflects what WaveLead actually collects and how consent
          is enforced today. It is not legal advice.
        </p>
        <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <div>
            <h2 className="text-foreground font-semibold">Account data</h2>
            <p className="mt-2">Account email, display name, and a first-party session cookie (<code className="mx-1 rounded bg-muted px-1 text-xs">wl_session</code>) so you can stay signed in.</p>
          </div>
          <div>
            <h2 className="text-foreground font-semibold">First-party visitor identifier</h2>
            <p className="mt-2">
              We set a random anonymous identifier <code className="mx-1 rounded bg-muted px-1 text-xs">wl_visitor_id</code>
              the first time you interact with an analytics-consent decision or the analytics endpoint. It is used
              only by WaveLead, is never shared with third-party advertisers, and is not derived from any
              fingerprinting technique.
            </p>
          </div>
          <div>
            <h2 className="text-foreground font-semibold">Optional analytics (off by default)</h2>
            <p className="mt-2">
              If, and only if, you turn Analytics on in <Link href="/cookies" className="text-primary underline">Cookie Preferences</Link>,
              WaveLead records a small allow-listed set of product-usage events (page views, searches by count,
              category and country views, sponsor click intent, pricing views, sign-up funnel). Consent is enforced
              server-side — the analytics endpoint drops any event when your saved preference is Off. You can
              withdraw consent at any time in Cookie Preferences.
            </p>
          </div>
          <div>
            <h2 className="text-foreground font-semibold">What we do not collect</h2>
            <p className="mt-2">
              We do not store WhatsApp user identities, phone numbers, or private WhatsApp data. We do not use
              unofficial WhatsApp APIs. We do not run marketing / retargeting cookies, session replay, browser
              fingerprinting, canvas / font / hardware fingerprinting, cross-site tracking, or precise-location
              tracking. We do not permanently store raw IP addresses as analytics identity.
            </p>
          </div>
          <div>
            <h2 className="text-foreground font-semibold">Independence</h2>
            <p className="mt-2">
              WaveLead is independently developed by P2P Labs. It is not affiliated with, endorsed by, or an
              official product of WhatsApp or Meta.
            </p>
          </div>
          <div>
            <h2 className="text-foreground font-semibold">Contact</h2>
            <p className="mt-2">Questions: <a className="text-primary underline" href="mailto:hello@p2plabs.asia">hello@p2plabs.asia</a></p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
