import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL, BUDGET_LABEL } from '@/lib/validation/sponsorshipSchemas';
import SponsorshipLeadActions from './SponsorshipLeadActions';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = { title: 'Sponsorship Lead — WaveLead Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

export default async function AdminSponsorshipLeadDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/admin/sponsorship-leads/${id}`);
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) redirect('/admin');
  let lead;
  try { lead = await sponsorshipLeadService.getAdmin(actor, id); }
  catch { notFound(); }

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <AdminNav active="/admin/sponsorship-leads" />
        <Link href="/admin/sponsorship-leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to leads</Link>
        <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{lead.company_name}</h1>
            <div className="mt-1 text-sm text-muted-foreground">Wants to sponsor <Link className="font-medium text-foreground hover:underline" href={`/channel/${lead.channel_slug_snapshot}`}>{lead.channel_name_snapshot}</Link></div>
          </div>
          <Badge>{lead.status}</Badge>
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div className="wh-card p-5">
            <div className="text-sm font-semibold mb-3">Contact</div>
            <Field label="Company">{lead.company_name}</Field>
            <Field label="Contact name">{lead.contact_name}</Field>
            <Field label="Work email"><a className="text-primary hover:underline" href={`mailto:${lead.work_email}`}>{lead.work_email}</a></Field>
            <Field label="Requester role">{lead.requester_role || 'anonymous'}</Field>
          </div>
          <div className="wh-card p-5">
            <div className="text-sm font-semibold mb-3">Campaign</div>
            <Field label="Objective">{OBJECTIVE_LABEL[lead.objective]}</Field>
            <Field label="Budget">{BUDGET_LABEL[lead.budget_range]}</Field>
            <Field label="Target country">{lead.target_country || '—'}</Field>
            <Field label="Desired start">{lead.desired_start_at ? new Date(lead.desired_start_at).toLocaleDateString() : '—'}</Field>
            <Field label="Submitted">{new Date(lead.created_at).toLocaleString()}</Field>
          </div>
        </div>

        <div className="mt-6 wh-card p-5">
          <div className="text-sm font-semibold mb-2">Brief</div>
          <p className="text-sm whitespace-pre-wrap text-foreground/90">{lead.brief}</p>
        </div>

        <SponsorshipLeadActions id={lead.id} currentStatus={lead.status} currentNotes={lead.admin_notes || ''} />
      </main>
      <Footer />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 grid grid-cols-[110px_1fr] gap-2 text-sm">
      <div className="text-xs text-muted-foreground uppercase tracking-wide pt-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}
