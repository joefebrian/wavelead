import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL, BUDGET_LABEL } from '@/lib/validation/sponsorshipSchemas';
import { HttpError } from '@/lib/auth/rbac';
import RespondButtons from './RespondButtons';
import { ArrowLeft, ExternalLink } from 'lucide-react';

export const metadata: Metadata = { title: 'Sponsorship Request — WaveLead' };
export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ id: string }>; }

export default async function OwnerSponsorshipRequestDetail({ params }: Props) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/sponsorship-requests/${id}`);
  let lead;
  let viewer;
  try {
    const r = await sponsorshipLeadService.getForViewer(actor, id);
    lead = r.lead; viewer = r.viewer;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return notFound();
    if (e instanceof HttpError && e.status === 403) redirect('/dashboard');
    throw e;
  }

  const isOwner = viewer === 'owner';
  const canRespond = isOwner && lead.status === 'new';
  const materialsUrl = lead.materials_url && /^https:\/\/(drive|docs)\.google\.com\//.test(lead.materials_url) ? lead.materials_url : null;

  return (
    <>
      <Header />
      <main>
        <section className="container py-8">
          <Link href="/dashboard/sponsorship-requests" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" /> Back to requests</Link>
          <div className="mt-3 flex flex-wrap gap-3 items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Sponsorship Request</div>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold">{lead.company_name}</h1>
              <div className="mt-1 text-sm text-muted-foreground">
                To your channel <Link href={`/channel/${lead.channel_slug_snapshot}`} className="text-primary hover:underline">{lead.channel_name_snapshot}</Link> · received {new Date(lead.created_at).toLocaleString()}
              </div>
            </div>
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-sky-100 text-sky-800" data-testid="request-status">
              {lead.status === 'new' ? 'Awaiting your response' :
                lead.status === 'accepted_by_owner' ? 'Accepted by you' :
                lead.status === 'declined_by_owner' ? 'Declined by you' :
                lead.status}
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="wh-card p-5 md:col-span-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Campaign brief</div>
              <p className="mt-2 text-sm whitespace-pre-wrap" data-testid="request-brief">{lead.brief}</p>

              {materialsUrl && (
                <div className="mt-4 pt-4 border-t border-border/60" data-testid="materials-block">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Materials</div>
                  <a href={materialsUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" data-testid="materials-link">
                    Open Google Drive Materials <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">Opens in a new tab. Make sure the brand has granted you access.</p>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border/60 text-xs text-muted-foreground">
                WaveLead is the platform of record. If you accept, WaveLead coordinates the booking, escrows the payment, and processes payout — <span className="font-semibold">90% goes to you, 10% to WaveLead</span>. Payment Protection applies.
              </div>
            </div>

            <div className="wh-card p-5 grid gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Brand contact</div>
                <div className="mt-0.5">{lead.contact_name}</div>
                <div className="text-xs text-muted-foreground break-all">{lead.work_email}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Objective</div>
                <div className="mt-0.5">{OBJECTIVE_LABEL[lead.objective] || lead.objective}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Budget range</div>
                <div className="mt-0.5">{BUDGET_LABEL[lead.budget_range] || lead.budget_range}</div>
              </div>
              {lead.target_country && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Target country</div>
                  <div className="mt-0.5">{lead.target_country}</div>
                </div>
              )}
              {lead.desired_start_at && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Desired start</div>
                  <div className="mt-0.5">{new Date(lead.desired_start_at).toLocaleDateString()}</div>
                </div>
              )}
            </div>
          </div>

          {canRespond && <RespondButtons requestId={lead.id} />}
        </section>
      </main>
      <Footer />
    </>
  );
}
