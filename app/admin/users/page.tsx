import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { adminUserService } from '@/lib/services/security/adminUserService';
import AdminUsersTable from './AdminUsersTable';

export const metadata: Metadata = { title: 'Admin · Users — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/users');
  if (!hasAtLeastRole(actor.user, ROLES.SUPER_ADMIN)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Super Admin only</h1>
          <p className="text-muted-foreground mt-2">User management is restricted to Super Administrators.</p>
        </main>
        <Footer />
      </>
    );
  }
  const sp = await searchParams;
  const q = (sp?.q || '').trim();
  const items = await adminUserService.search(actor, q);

  return (
    <>
      <Header />
      <main className="container py-10 max-w-6xl">
        <AdminNav active="/admin/users" />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Users</h1>
        <p className="mt-1 text-muted-foreground">Super-Admin-only user management. Password material is never returned by the API.</p>
        <AdminUsersTable initialQuery={q} initialItems={items} />
      </main>
      <Footer />
    </>
  );
}
