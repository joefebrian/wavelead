import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL, BUDGET_LABEL } from '@/lib/validation/sponsorshipSchemas';
import type { SponsorshipLeadStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Sponsorship Requests — WaveLead' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<SponsorshipLeadStatus, string> = {
  new: 'Awaiting your response',
  contacted: 'In discussion',
  qualified: 'In discussion',
  won: 'Booked',
  lost: 'Closed',
  accepted_by_owner: 'Accepted',
  declined_by_owner: 'Declined',
};

const STATUS_TONE: Record<SponsorshipLeadStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-amber-100 text-amber-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-slate-100 text-slate-700',
  accepted_by_owner: 'bg-emerald-100 text-emerald-800',
  declined_by_owner: 'bg-rose-100 text-rose-800',
};

export default async function OwnerSponsorshipRequestsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/sponsorship-requests');
  const items = await sponsorshipLeadService.listForOwnedChannels(actor);

  return (
    <>
      <Header />
      <main>
        <section className="wh-gradient-hero border-b border-border/60">
          <div className="container py-8">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Owner</div>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold">Sponsorship Requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">Requests brands have sent to channels you own. WaveLead handles the commercial transaction if you accept.</p>
          </div>
        </section>

        <section className="container py-8">
          {items.length === 0 ? (
            <div className="wh-card p-8 text-center text-muted-foreground">
              No sponsorship requests yet. Brands who discover your channel on WaveLead can send you sponsorship offers directly here.
            </div>
          ) : (
            <ul className="grid gap-3">
              {items.map((lead) => (
                <li key={lead.id} data-testid={`owner-request-card-${lead.id}`}>
                  <Link href={`/dashboard/sponsorship-requests/${lead.id}`} className="wh-card p-5 hover:border-primary/50 block">
                    <div className="flex flex-wrap gap-3 items-start justify-between">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{lead.channel_name_snapshot}</div>
                        <div className="mt-0.5 font-semibold">{lead.company_name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{OBJECTIVE_LABEL[lead.objective] || lead.objective} · Budget {BUDGET_LABEL[lead.budget_range] || lead.budget_range}</div>
                      </div>
                      <div className="text-right">
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TONE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
                        <div className="mt-1 text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}
