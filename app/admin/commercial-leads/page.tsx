import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { commercialLeadService } from '@/lib/services/commercialLeadService';
import CommercialLeadsClient from './CommercialLeadsClient';

export const metadata: Metadata = { title: 'Admin · Commercial Leads — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminCommercialLeadsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/commercial-leads');
  if (!hasAtLeastRole(actor.user, ROLES.ADMIN)) {
    return (
      <>
        <section className="w-full">
          <h1 className="text-3xl font-bold">403 — Admin only</h1>
          <p className="text-muted-foreground mt-2">Commercial Leads are restricted to Admins.</p>
        </section>
      </>
    );
  }
  const [items, counts] = await Promise.all([
    commercialLeadService.listAdmin(actor, {}),
    commercialLeadService.adminCounts(actor),
  ]);
  return (
    <>
      <section className="w-full">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Commercial Leads</h1>
        <p className="mt-1 text-muted-foreground">Pro-plan waitlist entries and Enterprise sales inquiries from the pricing page.</p>
        <CommercialLeadsClient initialItems={items} initialCounts={counts} />
      </section>
    </>
  );
}
