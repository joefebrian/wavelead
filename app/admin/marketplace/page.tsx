import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { marketplaceService } from '@/lib/services/marketplaceService';
import AdminMarketplaceClient from './AdminMarketplaceClient';

export const metadata: Metadata = { title: 'Admin · Marketplace — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminMarketplacePage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/marketplace');
  if (!hasAtLeastRole(actor.user, ROLES.ADMIN)) {
    return (<><Header /><main className="container py-20 text-center"><h1 className="text-3xl font-bold">403</h1></main><Footer /></>);
  }
  const [items, kpis] = await Promise.all([
    marketplaceService.listOrdersAdmin(actor, {}),
    marketplaceService.adminKpis(actor),
  ]);
  return (
    <>
      <Header />
      <main className="container py-10 max-w-6xl">
        <AdminNav active="/admin/marketplace" />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="mt-1 text-muted-foreground">Sponsorship marketplace orders, payments and economics. Buyer PayPal Checkout and admin manual / off-platform payment confirmation both supported. Owner payouts remain manual (external).</p>
        <AdminMarketplaceClient initialItems={items} initialKpis={kpis} />
      </main>
      <Footer />
    </>
  );
}
