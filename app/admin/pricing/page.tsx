import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { pricingConfigService } from '@/lib/services/pricingConfigService';
import PricingConfigClient from './PricingConfigClient';

export const metadata: Metadata = { title: 'Pricing — Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPricingPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/pricing');
  if (!hasAtLeastRole(actor.user, ROLES.ADMIN)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center"><h1 className="text-3xl font-bold">403 — Admin access required</h1></main>
        <Footer />
      </>
    );
  }
  const cfg = await pricingConfigService.getAdminPricing();
  return (
    <>
      <Header />
      <main className="container py-8">
        <AdminNav active="/admin/pricing" />
        <h1 className="text-2xl md:text-3xl font-bold">Commercial Pricing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edit publicly-displayed pricing. Amounts are in <strong>minor USD units</strong> (100 = $1.00). Changes take
          effect on the next page render — no code deploy required.
        </p>
        <PricingConfigClient initial={cfg} />
      </main>
      <Footer />
    </>
  );
}
