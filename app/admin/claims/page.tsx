import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { claimModerationService } from '@/lib/services/claimModerationService';
import { LayoutGrid, KeyRound } from 'lucide-react';

export const metadata: Metadata = { title: 'Claim moderation — Admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_information', label: 'Needs info' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

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

export default async function AdminClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/claims');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You need moderator access or higher.</p>
        </main>
        <Footer />
      </>
    );
  }
  const sp = await searchParams;
  const status = STATUSES.find((s) => s.value === sp.status)?.value ?? 'pending';
  const items = await claimModerationService.listQueue(actor, { status });

  return (
    <>
      <Header />
      <main className="container py-8">
        <AdminNav active="/admin/claims" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><KeyRound className="h-6 w-6" /> Ownership claims</h1>
            <p className="text-sm text-muted-foreground mt-1">Approve, reject or request more information on channel claims.</p>
          </div>
          <Link href="/admin"><Button variant="outline" size="sm"><LayoutGrid className="h-4 w-4 mr-1.5" /> Admin home</Button></Link>
        </div>

        <div className="mt-6 flex gap-2 flex-wrap border-b border-border">
          {STATUSES.map((s) => (
            <Link
              key={s.value}
              href={`/admin/claims?status=${s.value}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${status === s.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >{s.label}</Link>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="mt-10 wh-card p-10 text-center">
            <div className="font-semibold">Nothing in this state</div>
            <p className="text-sm text-muted-foreground mt-1">New claims will land here.</p>
          </div>
        ) : (
          <div className="mt-6 wh-card divide-y divide-border/60">
            {items.map((c) => (
              <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{c.channel?.name || c.channel_id}</span>
                    {statusBadge(c.status)}
                    <Badge variant="outline">{c.verification_method}</Badge>
                    {c.domain_match && <Badge variant="secondary">domain match</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex items-center flex-wrap gap-x-2">
                    <span>Claimant: {c.claimant?.email || c.claimant_email}</span>
                    <span aria-hidden>·</span>
                    <span>Evidence: {(c.evidence_urls || []).length}</span>
                    <span aria-hidden>·</span>
                    <span>Submitted {new Date(c.submitted_at).toLocaleString()}</span>
                  </div>
                  {c.channel && (
                    <div className="mt-1 text-xs">
                      Channel already owned: <span className="font-semibold">{c.channel.owner_id ? 'yes (verified)' : 'no'}</span>
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  <Link href={`/admin/claims/${c.id}`}><Button size="sm">Review</Button></Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
