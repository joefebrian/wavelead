import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { paypalAdminService } from '@/lib/services/security/paypalAdminService';
import PayPalSettingsClient from './PayPalSettingsClient';

export const metadata: Metadata = { title: 'Admin · PayPal Settings — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPayPalSettingsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/settings/paypal');
  if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Super Admin only</h1>
          <p className="text-muted-foreground mt-2">PayPal configuration is restricted to Super Administrators.</p>
        </main>
        <Footer />
      </>
    );
  }
  const status = await paypalAdminService.currentStatus(actor);
  return (
    <>
      <Header />
      <main className="container py-10 max-w-5xl">
        <AdminNav active="/admin/settings/paypal" />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">PayPal Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage PayPal provider credentials. Secrets are encrypted with AES-256-GCM and never returned by the API.</p>
        <PayPalSettingsClient initialStatus={status} />
      </main>
      <Footer />
    </>
  );
}
