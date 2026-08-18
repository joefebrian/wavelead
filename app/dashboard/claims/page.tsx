import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { claimService } from '@/lib/services/claimService';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { AlertTriangle } from 'lucide-react';
import ClaimResubmitClient from './ClaimResubmitClient';

export const metadata: Metadata = { title: 'My claims — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function statusBadge(s: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending:            { label: 'Pending review',  variant: 'secondary' },
    needs_information:  { label: 'Info requested',  variant: 'destructive' },
    approved:           { label: 'Approved',        variant: 'default' },
    rejected:           { label: 'Rejected',        variant: 'destructive' },
    cancelled:          { label: 'Cancelled',       variant: 'outline' },
    draft:              { label: 'Draft',           variant: 'outline' },
  };
  const m = map[s] ?? { label: s, variant: 'outline' as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export default async function DashboardClaimsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/claims');

  const claims = await claimService.listMine(actor);
  // Load channel names in one batch (moderator-safe fields only).
  const channelIds = Array.from(new Set(claims.map((c) => c.channel_id)));
  const channels = await Promise.all(channelIds.map((id) => channelRepo.findById(id)));
  const channelById = new Map(channels.filter(Boolean).map((c) => [c!.id, c!]));

  return (
    <>
      <Header />
      <main className="container py-8 max-w-4xl">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">My claims</h1>
            <p className="text-sm text-muted-foreground mt-1">Track ownership claims you submitted. When a moderator requests more info you can resubmit here.</p>
          </div>
          <Link href="/channels"><Button variant="outline" size="sm">Browse channels</Button></Link>
        </div>

        {claims.length === 0 ? (
          <div className="mt-8 wh-card p-8 text-center">
            <div className="font-semibold">No claims yet</div>
            <p className="text-sm text-muted-foreground mt-1">Find a channel you run and click “Claim this channel” to get your Verified badge.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {claims.map((c) => {
              const ch = channelById.get(c.channel_id);
              return (
                <div key={c.id} className="wh-card p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={ch ? `/channel/${ch.slug}` : '#'} className="font-semibold hover:underline">{ch?.name || c.channel_id}</Link>
                        {statusBadge(c.status)}
                        <Badge variant="outline">{c.verification_method}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Submitted {new Date(c.submitted_at).toLocaleString()}{c.approved_at && <> · Approved {new Date(c.approved_at).toLocaleString()}</>}{c.rejected_at && <> · Rejected {new Date(c.rejected_at).toLocaleString()}</>}</div>
                    </div>
                    {c.status === 'approved' && ch && (
                      <Link href={`/dashboard/channels/${ch.id}`}><Button size="sm">Manage channel</Button></Link>
                    )}
                  </div>

                  {c.status === 'needs_information' && c.request_more_info_message && (
                    <div className="mt-3 border border-amber-300 bg-amber-50 rounded-md p-3 text-sm text-amber-900">
                      <div className="font-semibold flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Moderator needs more info</div>
                      <p className="mt-0.5 whitespace-pre-wrap">{c.request_more_info_message}</p>
                    </div>
                  )}
                  {c.status === 'needs_information' && (
                    <ClaimResubmitClient claimId={c.id} initialNote={c.claimant_note || ''} initialMethod={c.verification_method} initialEvidence={c.evidence_urls.map((e) => ({ evidence_type: e.evidence_type, evidence_url: e.evidence_url, note: e.note ?? null }))} />
                  )}
                  {c.status === 'rejected' && c.reject_reason && (
                    <div className="mt-3 text-xs text-muted-foreground">Reason: <span className="font-semibold text-foreground">{c.reject_reason.replace(/_/g, ' ')}</span></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
