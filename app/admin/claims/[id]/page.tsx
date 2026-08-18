import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import ClaimActionsClient from './ClaimActionsClient';

export const metadata: Metadata = { title: 'Claim detail — Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

function statusBadge(s: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: 'Pending', variant: 'secondary' },
    needs_information: { label: 'Needs info', variant: 'destructive' },
    approved: { label: 'Approved', variant: 'default' },
    rejected: { label: 'Rejected', variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'outline' },
  };
  const m = map[s] ?? { label: s, variant: 'outline' as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export default async function AdminClaimDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/admin/claims/${id}`);
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center"><h1 className="text-3xl font-bold">403</h1></main>
        <Footer />
      </>
    );
  }
  let data;
  try { data = await claimModerationService.getDetail(actor, id); }
  catch { notFound(); }
  const { claim, channel, claimant, prior_claims } = data;

  return (
    <>
      <Header />
      <main className="container py-8 max-w-5xl">
        <Link href="/admin/claims" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to queue</Link>

        <div className="mt-4 flex items-start gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Ownership claim</div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">{channel?.name || claim.channel_id} {statusBadge(claim.status)}</h1>
            <div className="mt-1 text-sm text-muted-foreground">Submitted {new Date(claim.submitted_at).toLocaleString()}</div>
          </div>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 grid gap-4">
            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Verification method</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{claim.verification_method}</Badge>
                {claim.domain_match && <Badge>Domain match · {claim.email_domain}</Badge>}
              </div>
              {claim.claimant_note && (
                <>
                  <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Claimant note</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{claim.claimant_note}</p>
                </>
              )}
            </div>

            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Evidence ({claim.evidence_urls.length})</div>
              {claim.evidence_urls.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No evidence URLs provided.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {claim.evidence_urls.map((e, i) => (
                    <li key={i} className="border border-border rounded-md p-2 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{e.evidence_type}</Badge>
                        <a href={e.evidence_url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all inline-flex items-center gap-1">{e.evidence_url} <ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                      {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {claim.status === 'needs_information' && claim.request_more_info_message && (
              <div className="wh-card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-semibold">Info requested from claimant</div>
                <p className="mt-1 whitespace-pre-wrap">{claim.request_more_info_message}</p>
              </div>
            )}

            {claim.status === 'rejected' && (
              <div className="wh-card border-destructive/40 bg-destructive/5 p-4 text-sm">
                <div className="font-semibold text-destructive">Rejection</div>
                <div className="mt-1">Reason: <span className="font-semibold">{claim.reject_reason?.replace(/_/g, ' ')}</span></div>
                {claim.moderator_notes && <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">Moderator notes: {claim.moderator_notes}</div>}
              </div>
            )}
          </div>

          <aside className="grid gap-4">
            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Channel</div>
              <div className="mt-2 text-sm space-y-1">
                <div><span className="text-muted-foreground">Slug:</span> <code className="text-xs">{channel?.slug || '—'}</code></div>
                {channel?.website_url && <div><span className="text-muted-foreground">Website:</span> <a href={channel.website_url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{channel.website_url}</a></div>}
                {channel?.whatsapp_url && <div><span className="text-muted-foreground">WhatsApp:</span> <a href={channel.whatsapp_url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{channel.whatsapp_url}</a></div>}
                <div><span className="text-muted-foreground">Verified owner exists:</span> {channel?.owner_id ? 'yes' : 'no'}</div>
                {channel?.slug && <div className="mt-2"><Link href={`/channel/${channel.slug}`} className="text-xs text-primary underline">Public profile →</Link></div>}
              </div>
            </div>

            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Claimant</div>
              <div className="mt-2 text-sm space-y-1">
                <div>{claimant?.display_name || '—'}</div>
                <div className="text-xs text-muted-foreground">{claim.claimant_email}</div>
                <div className="text-xs">Email domain: <code>{claim.email_domain || '—'}</code></div>
                <div className="text-xs">Website domain: <code>{claim.website_domain || '—'}</code></div>
              </div>
            </div>

            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Prior claims ({prior_claims.length})</div>
              {prior_claims.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">None.</p>
              ) : (
                <ul className="mt-2 text-xs space-y-1">
                  {prior_claims.map((p) => {
                    const q = p as unknown as { id: string; status: string; submitted_at: Date; verification_method: string };
                    return (
                      <li key={q.id}><Badge variant="outline">{q.status}</Badge> <span className="text-muted-foreground">· {new Date(q.submitted_at).toLocaleDateString()} · {q.verification_method}</span></li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>

        <div className="mt-8">
          <ClaimActionsClient claimId={claim.id} currentStatus={claim.status} />
        </div>
      </main>
      <Footer />
    </>
  );
}
