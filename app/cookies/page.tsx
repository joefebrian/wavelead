import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Cookie Policy — WaveLead',
  description: 'How WaveLead uses cookies. A product by P2P Labs.',
};

export default function CookiesPage() {
  return (
    <>
      <Header />
      <main className="container py-14 max-w-3xl" data-testid="cookies-page">
        <h1 className="text-3xl font-bold">Cookie Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">WaveLead is a product by P2P Labs.</p>
        <div className="mt-6 space-y-5 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-base">What are cookies?</h2>
            <p className="mt-2 text-muted-foreground">
              Cookies are small text files that a website places on your device to make it work, keep you signed in,
              remember your preferences and — with your permission — understand how the site is used.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-base">Categories we plan to use</h2>
            <ul className="mt-2 space-y-2 text-muted-foreground list-disc list-inside">
              <li><strong className="text-foreground">Necessary</strong> — session, security, and to remember your cookie choice. Always on; the site cannot function without them.</li>
              <li><strong className="text-foreground">Analytics</strong> — first-party, aggregated understanding of how people discover and use WaveLead. Off by default; only activated with your explicit consent.</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              We do <strong>not</strong> use marketing / retargeting cookies, browser fingerprinting, session replay,
              or third-party advertising trackers.
            </p>
          </section>
          <section
            className="wh-card p-4 border-primary/30 bg-primary/5"
            data-testid="cookies-preferences-status"
          >
            <div className="font-semibold">Cookie Preferences</div>
            <p className="text-sm text-muted-foreground mt-1">
              A cookie preferences manager and analytics consent flow are being finalized ahead of enabling optional
              analytics. Until then, no optional analytics cookies are set — only the strictly necessary session
              and security cookies described above.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-base">Contact</h2>
            <p className="mt-2 text-muted-foreground">
              Questions about cookies? Contact P2P Labs at <a className="text-primary underline" href="mailto:hello@p2plabs.asia">hello@p2plabs.asia</a>.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
