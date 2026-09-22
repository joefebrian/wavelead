// M19.2 — Refund Policy public page.
//
// Copy scope only: describes when refunds may apply and the fact that any
// refund is issued NET of applicable processing fees, provider fees and other
// non-recoverable costs. It never overrides the M08 marketplace / Payment
// Protection or the M19 Campaign Commitment Deposit financial semantics —
// those remain the sole source of truth and are unchanged.
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description:
    'How refunds work on WaveLead. Where a refund applies, it is returned net of applicable processing fees, provider fees and other non-recoverable costs.',
  alternates: { canonical: '/refund-policy' },
};

export default function RefundPolicyPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-4xl font-bold">Refund Policy</h1>
        <p className="text-muted-foreground mt-2">
          Last updated: 2026-09-22. This policy summarises how refunds work on WaveLead. It does not create rights beyond those already
          set out in the <Link href="/terms" className="underline">Terms of Service</Link> and the applicable product surface (marketplace booking, Brand Pro,
          Founding Lifetime, or Campaign Commitment Deposit).
        </p>

        <section className="mt-8 space-y-4 text-sm text-muted-foreground leading-relaxed">
          <div>
            <h2 className="text-foreground font-semibold text-base" data-testid="refund-principle-heading">1. General principle — refunds are issued net of applicable, documented, non-recoverable costs</h2>
            <p className="mt-2" data-testid="refund-principle-body">
              Where a refund is eligible, the refundable amount may be reduced by <strong>applicable, documented, non-recoverable
              third-party transaction costs</strong>. Deductions are limited to the categories below and are never used to make arbitrary
              reductions:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>payment processing / payment provider fees</li>
              <li>currency conversion costs where a conversion occurred</li>
              <li>chargeback or reversal costs where applicable</li>
              <li>taxes where legally applicable and non-recoverable</li>
              <li>other documented, non-recoverable third-party transaction costs</li>
            </ul>
            <p className="mt-2">
              WaveLead does not guarantee an automatic full refund in every case. The refundable amount is calculated server-side
              against the recorded transaction, is capped by the amount originally captured for the same purchase, and is never greater
              than what the payment provider actually settled to WaveLead.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">2. Marketplace bookings &amp; Payment Protection</h2>
            <p className="mt-2">
              Sponsorship bookings follow WaveLead&apos;s <strong>Payment Protection</strong> workflow. Payment, delivery, review, acceptance,
              cancellation and any eligible refund are handled according to the booking&apos;s recorded marketplace lifecycle. The 90% Channel
              Owner / 10% WaveLead split, the Payment Protection state machine and the payment provider&apos;s settlement rules remain the
              authoritative source of truth. Where a refund is eligible under the marketplace lifecycle, it is returned to the original
              payment method where the provider supports it, subject to the applicable non-recoverable costs described in section&nbsp;1.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">3. Brand Pro (Founding Beta — $15 / 30 days)</h2>
            <p className="mt-2">
              Brand Pro Founding Beta is sold as a single 30-day term with <strong>manual renewal</strong>: PayPal never charges you automatically, and
              nothing renews unless you pay again. Because each term is a one-time purchase for a fixed 30-day period, a term that has already
              started is generally non-refundable once access has been granted. If access could not be granted for a technical reason attributable
              to WaveLead, the paid amount is refundable, subject to the applicable non-recoverable costs described in section&nbsp;1.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">4. Founding Lifetime ($100 one-time — Public Beta offer)</h2>
            <p className="mt-2">
              Founding Lifetime is a one-time purchase offered during Public Beta. If the Founding Lifetime entitlement was not activated on your
              workspace because of a technical failure attributable to WaveLead, the purchase is refundable, subject to the applicable
              non-recoverable costs described in section&nbsp;1. Once the entitlement is active, Founding Lifetime is non-refundable except where
              required by applicable law.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">5. Campaign Commitment Deposit (5%)</h2>
            <p className="mt-2">
              The 5% Campaign Commitment Deposit that a Brand funds up front is <strong>campaign-linked funding, not WaveLead revenue</strong>, and it is
              separate from the 10% marketplace fee. Where a Campaign Commitment Deposit becomes eligible for refund (for example, a campaign
              that is cancelled with no marketplace bookings created against it), the refund is returned subject to the applicable
              non-recoverable costs described in section&nbsp;1. Deposits linked to campaigns that already carry committed marketplace bookings are
              subject to those bookings clearing under Payment Protection before any residual deposit balance can be refunded.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">6. Requests, timing and provider limits</h2>
            <p className="mt-2">
              Refunds are processed through the same payment provider that captured the original transaction. The provider&apos;s own timelines and
              limits apply — for example, some providers only support refunds within a fixed window after capture, and settlement to your original
              method can take several business days. Where deductions apply, WaveLead records the applicable refund and cost information against
              the relevant transaction. Available transaction details may be shown in the product or provided through Support.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">7. How to request a refund</h2>
            <p className="mt-2">
              Please use the in-app Support widget (bottom-right of the site) or <Link href="/contact" className="underline">contact us</Link>, including the transaction reference and a short description of what you are asking for.
              WaveLead never processes refund requests over email attachments containing card numbers or full account details — the payment provider always holds those.
            </p>
          </div>

          <div>
            <h2 className="text-foreground font-semibold text-base">8. Consumer law rights</h2>
            <p className="mt-2">
              Nothing in this policy limits any non-waivable rights you have under applicable consumer protection law. If a mandatory local law
              gives you a broader right to a refund than this policy, that right applies.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
