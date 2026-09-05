import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'FAQ — WaveLead',
  description: 'Frequently asked questions about WaveLead, WhatsApp Channel discovery, ownership verification, activation, sponsorships and follower information.',
  alternates: { canonical: '/faq' },
};

interface QA { q: string; a: React.ReactNode; }

const QAS: QA[] = [
  {
    q: 'What is WaveLead?',
    a: (
      <>WaveLead is a discovery, ownership-verification and sponsorship marketplace for public WhatsApp Channels. Channel owners can list their channel, verify ownership, and (optionally) monetize through brand sponsorships. Discovery is free for everyone.</>
    ),
  },
  {
    q: 'Is WaveLead affiliated with WhatsApp or Meta?',
    a: (
      <>No. <strong>WaveLead is independently developed by P2P Labs and is not affiliated with, endorsed by, or an official product of WhatsApp or Meta.</strong></>
    ),
  },
  {
    q: 'How do I submit a WhatsApp Channel?',
    a: (
      <>Sign in and open <Link className="text-primary underline" href="/submit">Submit a Channel</Link>. Paste your public WhatsApp Channel URL — WaveLead pulls public metadata (title, avatar, bio) automatically so you only need to confirm the details. A moderator reviews every submission before it appears publicly.</>
    ),
  },
  {
    q: 'How does channel ownership verification work?',
    a: (
      <>When you submit a channel you can check &ldquo;I own or manage this channel&rdquo; and provide ownership evidence. A WaveLead moderator reviews your listing and your ownership claim together in one step. Declaring ownership does not prove it — an admin still verifies your evidence before the channel is marked as owner verified.</>
    ),
  },
  {
    q: 'What is Verified Owner Activation?',
    a: (
      <>Verified Owner Activation is a one-time <strong>$1</strong> transaction that unlocks the public &ldquo;Owner Verified&rdquo; state for an approved channel. It only appears after a moderator has approved your ownership claim.</>
    ),
  },
  {
    q: 'Why is there a one-time $1 activation?',
    a: (
      <>The $1 activation is an anti-abuse and identity signal — it confirms a real, payment-capable owner is behind the channel and helps deter impersonation. After PayPal processing fees, the remaining amount is returned to your account as WaveLead Credit, usable toward eligible WaveLead services.</>
    ),
  },
  {
    q: 'Is the $1 activation a subscription?',
    a: (
      <><strong>No.</strong> It is a one-time charge — there is no recurring billing.</>
    ),
  },
  {
    q: 'Where does follower count come from?',
    a: (
      <>WaveLead may display follower information detected from publicly available WhatsApp Channel metadata. This is a public/observed number, not an official WhatsApp API follower count. Where an owner has separately provided admin-verified evidence, that verified figure takes precedence.</>
    ),
  },
  {
    q: 'How often is public channel data refreshed?',
    a: (
      <>Approved public channels are periodically refreshed from their existing public WhatsApp Channel URL — currently on a weekly cadence. Refreshed fields include the profile image, public bio and public follower count. Refresh never overwrites owner-verified evidence.</>
    ),
  },
  {
    q: 'How do sponsorships work?',
    a: (
      <>Owners publish fixed-price sponsorship packages on their channel profile. Brands can book them directly through the WaveLead marketplace. WaveLead coordinates delivery and payout, and the owner keeps the majority of the sponsorship fee.</>
    ),
  },
  {
    q: 'What is Payment Protection?',
    a: (
      <>Payment Protection means: (a) sponsorship funds sit with WaveLead until the delivery is confirmed; (b) the $1 owner activation is processed through PayPal, so buyers benefit from PayPal&apos;s standard buyer protection; (c) WaveLead never asks you to send payment outside the platform.</>
    ),
  },
  {
    q: 'How do I contact WaveLead?',
    a: (
      <>Use the <Link className="text-primary underline" href="/contact">Contact page</Link> — every message is triaged by the WaveLead team. For commercial or Enterprise conversations, choose &ldquo;Enterprise&rdquo; as the topic.</>
    ),
  },
];

export default function FaqPage() {
  return (
    <>
      <Header />
      <main>
        <section className="wh-gradient-hero border-b border-border/60">
          <div className="container py-10 md:py-14 max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">FAQ</div>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold">Frequently asked questions</h1>
            <p className="mt-2 text-muted-foreground">Everything you might want to know before submitting a channel, verifying ownership or working with brands on WaveLead.</p>
          </div>
        </section>

        <section className="container py-10 max-w-3xl grid gap-4">
          {QAS.map((qa, i) => (
            <details key={i} className="wh-card p-5 group" data-testid={`faq-item-${i}`}>
              <summary className="cursor-pointer list-none flex items-start justify-between gap-3">
                <span className="font-semibold">{qa.q}</span>
                <span aria-hidden className="text-muted-foreground text-lg leading-none mt-0.5 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <div className="mt-3 text-sm text-muted-foreground leading-relaxed">{qa.a}</div>
            </details>
          ))}

          <div className="mt-6 text-xs text-muted-foreground border-t border-border/60 pt-6" data-testid="faq-disclaimer">
            WaveLead is independently developed by P2P Labs and is not affiliated with, endorsed by, or an official product of WhatsApp or Meta.
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
