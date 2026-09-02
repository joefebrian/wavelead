import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { marketplaceService } from '@/lib/services/marketplaceService';
import { hasEntitlement } from '@/lib/entitlements';
import EarningsClient from './EarningsClient';
import RevenueIntelligencePanel from './RevenueIntelligencePanel';

export const metadata: Metadata = { title: 'Earnings — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function EarningsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/earnings');
  const data = await marketplaceService.ownerListEarnings(actor);

  // Phase 3 — Pro-only Revenue Intelligence. The panel is server-gated: for
  // Free users we skip the service call entirely and render the upgrade
  // state. Pro / Enterprise / admin receive the metrics inline (server
  // fetch prevents a client-side 403 flash). The API endpoint remains the
  // authoritative gate — server-side entitlement is re-checked there.
  const canSeeRi = hasEntitlement(actor, 'revenue_intelligence');
  const ri = canSeeRi ? await marketplaceService.ownerRevenueIntelligence(actor) : null;

  return (
    <>
      <Header />
      <main className="container py-10 max-w-5xl">
        <h1 className="text-2xl md:text-3xl font-bold">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your sponsorship earnings — pending, available for payout, and paid out. WaveLead holds each payment
          under Payment Protection during a settlement period after the brand accepts your delivery.
        </p>
        <EarningsClient initial={data} />
        <RevenueIntelligencePanel metrics={ri} gated={!canSeeRi} userEmail={actor.user.email} />
      </main>
      <Footer />
    </>
  );
}
