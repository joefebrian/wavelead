import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { moderationService } from '@/lib/services/moderationService';
import { countryByCode } from '@/lib/constants/countries';
import { ExternalLink, LayoutGrid } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Moderation Queue — Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SP { status?: string; }

const STATUSES: { value: string; label: string }[] = [
  { value: 'pending_review', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending_review: { label: 'Pending', variant: 'secondary' },
    approved: { label: 'Approved', variant: 'default' },
    rejected: { label: 'Rejected', variant: 'destructive' },
    suspended: { label: 'Suspended', variant: 'outline' },
    draft: { label: 'Draft', variant: 'outline' },
    archived: { label: 'Archived', variant: 'outline' },
  };
  const m = map[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export default async function AdminChannelsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/channels');
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
  const status = STATUSES.find((s) => s.value === sp.status)?.value ?? 'pending_review';
  const items = await moderationService.listQueue(actor, { status, limit: 100 });

  return (
    <>
      <Header />
      <main className="container py-8">
        <AdminNav active="/admin/channels" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Moderation Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">Review, edit, approve or reject submitted WhatsApp Channels.</p>
          </div>
          <Link href="/admin"><Button variant="outline" size="sm"><LayoutGrid className="h-4 w-4 mr-1.5" /> Admin home</Button></Link>
        </div>

        <div className="mt-6 flex gap-2 flex-wrap border-b border-border">
          {STATUSES.map((s) => (
            <Link
              key={s.value}
              href={`/admin/channels?status=${s.value}`}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${status === s.value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >{s.label}</Link>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="mt-10 text-center wh-card p-10">
            <div className="text-lg font-semibold">No channels in this state</div>
            <p className="text-sm text-muted-foreground mt-1">When users submit new channels they&apos;ll appear here.</p>
          </div>
        ) : (
          <div className="mt-6 wh-card divide-y divide-border/60">
            {items.map((c) => {
              const country = countryByCode(c.country_code);
              const submitted = new Date(c.created_at).toLocaleString();
              return (
                <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold" aria-hidden>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{c.name}</span>
                      {statusBadge(c.status)}
                      {c.is_featured && <Badge variant="outline">Featured</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                      {country && <span>{country.flag} {country.name}</span>}
                      {c.primary_language && <span aria-hidden>·</span>}
                      {c.primary_language && <span>{c.primary_language}</span>}
                      {c.category_name && <span aria-hidden>·</span>}
                      {c.category_name && <span>{c.category_name}</span>}
                      <span aria-hidden>·</span>
                      <span>submitted {submitted}</span>
                    </div>
                    <a href={c.whatsapp_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-primary inline-flex items-center gap-1 truncate max-w-full">
                      <span className="truncate">{c.whatsapp_url}</span> <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.short_description}</p>
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <Link href={`/admin/channels/${c.id}`}><Button size="sm">Review</Button></Link>
                  </div>
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
