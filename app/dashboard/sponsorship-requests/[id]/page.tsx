import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL, BUDGET_LABEL } from '@/lib/validation/sponsorshipSchemas';
import { HttpError } from '@/lib/auth/rbac';
import { sponsorshipMessageRepo } from '@/lib/repositories/sponsorshipMessageRepo';
import RespondButtons from './RespondButtons';
import ConversationThread from './ConversationThread';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';

// M16.1 — existing marketplace statuses only. No new payment states.
const ORDER_PAID_STATUSES = ['paid', 'in_progress', 'revision_requested', 'submitted_for_review', 'completed'];

// M17 — private owner surface: never indexed by search engines or AI crawlers.
export const metadata: Metadata = { title: 'Sponsorship Request — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ id: string }>; }

export default async function OwnerSponsorshipRequestDetail({ params }: Props) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/sponsorship-requests/${id}`);
  let lead;
  let viewer;
  let linkedOrder = null;
  try {
    const r = await sponsorshipLeadService.getBookingLink(actor, id);
    lead = r.lead; viewer = r.viewer; linkedOrder = r.order;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return notFound();
    if (e instanceof HttpError && e.status === 403) redirect('/dashboard');
    throw e;
  }

  const isOwner = viewer === 'owner';
  const isRequester = viewer === 'requester';
  const canRespond = isOwner && lead.status === 'new';
  const canPostMessage = isOwner || isRequester;
  const materialsUrl = lead.materials_url && /^https:\/\/(drive|docs)\.google\.com\//.test(lead.materials_url) ? lead.materials_url : null;
  const messages = await sponsorshipMessageRepo.listByLead(lead.id).catch(() => []);
  // M16 — canonical naming. Owner side = "Incoming Request".
  // Brand side = "Sent Request". Confirmed bookings = "Active Sponsorships".
  const backHref = isRequester ? '/dashboard/sent-requests' : '/dashboard/sponsorship-requests';
  const backLabel = isRequester ? 'Back to Sent Requests' : 'Back to Incoming Requests';
  const kicker = isRequester ? 'Sent Request' : isOwner ? 'Incoming Request' : 'Sponsorship Request (admin view)';
  const statusLabel =
    lead.status === 'new' ? (isOwner ? 'Awaiting your response' : 'Awaiting owner response')
      : lead.status === 'accepted_by_owner' ? (isOwner ? 'Accepted — awaiting brand payment' : 'Accepted by Channel Owner')
      : lead.status === 'declined_by_owner' ? (isOwner ? 'Declined by you' : 'Declined')
      : lead.status === 'won' ? 'Booked'
      : lead.status === 'lost' ? 'Closed'
      : 'In discussion';

  return (
    <>
      <section className="w-full">
        <section className="container py-8">
          <Link href={backHref} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" /> {backLabel}</Link>
          <div className="mt-3 flex flex-wrap gap-3 items-start justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{kicker}</div>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold">{lead.company_name}</h1>
              <div className="mt-1 text-sm text-muted-foreground">
                {isRequester ? 'Sent to ' : 'To your channel '}<Link href={`/channel/${lead.channel_slug_snapshot}`} className="text-primary hover:underline">{lead.channel_name_snapshot}</Link> · {isRequester ? 'sent' : 'received'} {new Date(lead.created_at).toLocaleString()}
              </div>
            </div>
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-sky-100 text-sky-800" data-testid="request-status">
              {statusLabel}
            </span>
          </div>

          {lead.status === 'accepted_by_owner' && (
            <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4" data-testid="accepted-next-step">
              <div className="text-sm font-semibold text-emerald-900">
                {isOwner
                  ? (linkedOrder
                      ? (ORDER_PAID_STATUSES.includes(linkedOrder.status) ? 'Booked — sponsorship is active' : 'Accepted — awaiting brand payment')
                      : 'Accepted — awaiting brand booking/payment')
                  : 'Accepted by Channel Owner'}
              </div>
              <p className="mt-1 text-xs text-emerald-900/80">
                {isOwner
                  ? 'The brand books and pays through WaveLead. WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed — you receive 90% of the applicable net, WaveLead retains 10%. Delivery stays in your existing sponsorship workflow.'
                  : 'Continue on WaveLead to complete the booking and payment — never off-platform. WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed.'}
              </p>
              {isRequester && (
                <div className="mt-3">
                  {!linkedOrder ? (
                    <Link href={`/sponsor/${lead.channel_slug_snapshot}?lead=${encodeURIComponent(lead.id)}`} data-testid="continue-to-booking-cta">
                      <Button size="sm" className="gap-1.5">Continue to Booking <ArrowRight className="h-4 w-4" /></Button>
                    </Link>
                  ) : (
                    <Link href="/dashboard/sponsorships" data-testid="continue-booking-cta">
                      <Button size="sm" className="gap-1.5">
                        {linkedOrder.status === 'completed'
                          ? 'View Sponsorship'
                          : ORDER_PAID_STATUSES.includes(linkedOrder.status)
                            ? 'View Active Sponsorship'
                            : linkedOrder.status === 'requested'
                              ? 'View Booking'
                              : 'Continue Payment'}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                  <p className="mt-2 text-xs text-emerald-900/70">
                    {linkedOrder
                      ? 'You already have a booking for this request — this opens the existing booking. No duplicate order is created.'
                      : 'You choose the sponsorship package on the next step. No payment is taken until you confirm.'}
                  </p>
                </div>
              )}
              {isOwner && (
                <p className="mt-2 text-xs text-emerald-900/70">
                  {linkedOrder
                    ? <>The brand has started the booking. Manage delivery under <Link href={`/dashboard/channels/${lead.channel_id}/monetization`} className="underline">Active Sponsorships</Link>.</>
                    : 'Use the conversation below to confirm scope and timing with the brand.'}
                </p>
              )}
            </div>
          )}

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
                WaveLead is the platform of record. WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed — <span className="font-semibold">the channel owner receives 90% of the applicable net, WaveLead retains 10%</span>. Payments always stay on WaveLead.
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

          <ConversationThread
            leadId={lead.id}
            viewer={viewer}
            canPost={canPostMessage}
            initialMessages={messages}
          />
        </section>
      </section>
    </>
  );
}
