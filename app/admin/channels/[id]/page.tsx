import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { moderationService } from '@/lib/services/moderationService';
import { countryByCode } from '@/lib/constants/countries';
import { userRepo } from '@/lib/repositories/userRepo';
import { ArrowLeft, ExternalLink, Globe } from 'lucide-react';
import ModerationActions from './ActionsClient';

export const metadata: Metadata = {
  title: 'Review Channel — Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Params { id: string; }

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending_review: { label: 'Pending Review', variant: 'secondary' },
    approved: { label: 'Approved', variant: 'default' },
    rejected: { label: 'Rejected', variant: 'destructive' },
    suspended: { label: 'Suspended', variant: 'outline' },
  };
  const m = map[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export default async function ReviewChannelPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/admin/channels/${id}`);
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

  let channel;
  try {
    channel = await moderationService.getById(actor, id);
  } catch { notFound(); }
  if (!channel) notFound();

  const country = countryByCode(channel.country_code);
  const submitter = channel.owner_id ? await userRepo.findById(channel.owner_id) : null;
  const reviewer = channel.reviewed_by ? await userRepo.findById(channel.reviewed_by) : null;

  return (
    <>
      <Header />
      <main className="container py-8 max-w-4xl">
        <Link href="/admin/channels" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to queue</Link>

        <div className="mt-4 flex items-start gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground text-2xl font-extrabold shrink-0" aria-hidden>
            {channel.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold">{channel.name}</h1>
              {statusBadge(channel.status)}
              {channel.is_featured && <Badge variant="outline">Featured</Badge>}
              {channel.verification_status && channel.verification_status !== 'unclaimed' && (
                <Badge variant="outline">{channel.verification_status}</Badge>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
              {country && <span>{country.flag} {country.name}</span>}
              {channel.primary_language && <><span aria-hidden>·</span><span>{channel.primary_language}</span></>}
              {channel.category_name && <><span aria-hidden>·</span><span>{channel.category_name}</span></>}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 grid gap-4">
            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">WhatsApp URL</div>
              <a href={channel.whatsapp_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-primary inline-flex items-center gap-1 break-all">
                {channel.whatsapp_url} <ExternalLink className="h-4 w-4 shrink-0" />
              </a>
              <p className="mt-2 text-xs text-muted-foreground">This is the normalized URL WaveLead stored. Open it in a new tab to preview the channel before approving.</p>
            </div>

            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Short description</div>
              <p className="mt-1">{channel.short_description || <span className="text-muted-foreground">—</span>}</p>
              {channel.description && (
                <>
                  <div className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Full description</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{channel.description}</p>
                </>
              )}
            </div>

            {(channel.website_url || channel.logo_url) && (
              <div className="wh-card p-5 grid gap-3">
                {channel.website_url && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Website</div>
                    <a href={channel.website_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-primary inline-flex items-center gap-1 break-all"><Globe className="h-4 w-4 shrink-0" /> {channel.website_url}</a>
                  </div>
                )}
                {channel.logo_url && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Logo URL</div>
                    <a href={channel.logo_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-primary inline-flex items-center gap-1 break-all">{channel.logo_url}</a>
                  </div>
                )}
              </div>
            )}

            {channel.status === 'rejected' && (channel.rejection_reason || channel.rejection_notes) && (
              <div className="wh-card border-destructive/40 bg-destructive/5 p-5">
                <div className="text-xs uppercase tracking-wider text-destructive">Rejection</div>
                <div className="mt-1 text-sm"><span className="font-semibold">Reason:</span> {channel.rejection_reason || '—'}</div>
                {channel.rejection_notes && <div className="mt-1 text-sm"><span className="font-semibold">Notes:</span> {channel.rejection_notes}</div>}
              </div>
            )}
          </div>

          <aside className="grid gap-4">
            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Submission</div>
              <div className="mt-2 text-sm space-y-1">
                <div><span className="text-muted-foreground">Submitted:</span> {new Date(channel.created_at).toLocaleString()}</div>
                {submitter ? (
                  <div><span className="text-muted-foreground">By:</span> {submitter.display_name || submitter.email} <span className="text-xs text-muted-foreground">({submitter.email})</span></div>
                ) : (
                  <div className="text-muted-foreground">Seed / no owner recorded</div>
                )}
                <div><span className="text-muted-foreground">Slug:</span> <code className="text-xs">{channel.slug}</code></div>
              </div>
            </div>

            <div className="wh-card p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Moderation trail</div>
              <div className="mt-2 text-sm space-y-1">
                <div><span className="text-muted-foreground">Current status:</span> {channel.status}</div>
                {channel.reviewed_at && <div><span className="text-muted-foreground">Reviewed:</span> {new Date(channel.reviewed_at).toLocaleString()}</div>}
                {reviewer && <div><span className="text-muted-foreground">Reviewer:</span> {reviewer.display_name || reviewer.email}</div>}
                {channel.published_at && <div><span className="text-muted-foreground">Published:</span> {new Date(channel.published_at).toLocaleString()}</div>}
              </div>
            </div>

            {channel.status === 'approved' && (
              <Link href={`/channel/${channel.slug}`} className="text-sm text-primary inline-flex items-center gap-1 justify-center">View public listing <ExternalLink className="h-4 w-4" /></Link>
            )}
          </aside>
        </div>

        <div className="mt-8">
          <ModerationActions
            channelId={channel.id}
            currentStatus={channel.status}
            currentValues={{
              name: channel.name,
              short_description: channel.short_description ?? '',
              description: channel.description ?? '',
            }}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
