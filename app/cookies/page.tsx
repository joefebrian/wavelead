import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import CookiePreferencesTrigger from '@/components/consent/CookiePreferencesTrigger';

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

        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-base">What are cookies?</h2>
            <p className="mt-2 text-muted-foreground">
              Cookies are small text files a website places on your device to make it work, keep you signed in,
              remember your preferences and — with your permission — understand how the site is used.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base">Categories we use</h2>
            <ul className="mt-2 space-y-2 text-muted-foreground list-disc list-inside">
              <li>
                <strong className="text-foreground">Necessary</strong> — session, security, and to remember your
                cookie choice. Always on; the site cannot function without them. This includes
                <code className="mx-1 rounded bg-muted px-1 text-xs">wl_session</code> (only when signed in),
                <code className="mx-1 rounded bg-muted px-1 text-xs">wl_visitor_id</code> (first-party anonymous
                visitor identifier), and
                <code className="mx-1 rounded bg-muted px-1 text-xs">wl_consent</code> (your saved preference).
              </li>
              <li>
                <strong className="text-foreground">Analytics</strong> — first-party, aggregated understanding of
                how people discover and use WaveLead. Off by default; only activated with your explicit consent.
              </li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              We do <strong>not</strong> use marketing / retargeting cookies, browser fingerprinting, session replay,
              third-party advertising trackers, canvas fingerprinting, font fingerprinting, hardware fingerprinting,
              cross-site tracking, or precise-location tracking.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base">First-party analytics — what we collect (only if you consent)</h2>
            <p className="mt-2 text-muted-foreground">
              When you turn Analytics on, WaveLead records a compact set of product-usage events tied to your
              anonymous <code className="mx-1 rounded bg-muted px-1 text-xs">wl_visitor_id</code>. Events include:
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
              <li><code className="rounded bg-muted px-1 text-xs">page_view</code></li>
              <li><code className="rounded bg-muted px-1 text-xs">channel_profile_view</code>, <code className="rounded bg-muted px-1 text-xs">channel_search</code> (count only, not free-text)</li>
              <li><code className="rounded bg-muted px-1 text-xs">category_view</code>, <code className="rounded bg-muted px-1 text-xs">country_view</code></li>
              <li><code className="rounded bg-muted px-1 text-xs">follow_intent_click</code>, <code className="rounded bg-muted px-1 text-xs">sponsor_channel_click</code>, <code className="rounded bg-muted px-1 text-xs">sponsorship_package_view</code></li>
              <li><code className="rounded bg-muted px-1 text-xs">pricing_view</code>, <code className="rounded bg-muted px-1 text-xs">pro_waitlist_click</code>, <code className="rounded bg-muted px-1 text-xs">enterprise_contact_click</code></li>
              <li><code className="rounded bg-muted px-1 text-xs">signup_started</code>, <code className="rounded bg-muted px-1 text-xs">signup_completed</code></li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              We do <strong>not</strong> store passwords, form contents, payment credentials, PayPal data, sponsorship
              private messages, delivery notes, uploaded screenshots, keystrokes, form drafts, raw request headers, or
              raw cookies inside analytics events. We do not permanently store your raw IP address as an analytics
              identity.
            </p>
          </section>

          <section
            className="wh-card p-4 border-primary/30 bg-primary/5"
            data-testid="cookies-preferences-manager"
          >
            <div className="font-semibold">Manage your preferences</div>
            <p className="text-sm text-muted-foreground mt-1">
              You can change or withdraw your Analytics consent at any time. Necessary cookies will remain active
              because the site cannot function without them.
            </p>
            <div className="mt-3">
              <CookiePreferencesTrigger />
            </div>
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
