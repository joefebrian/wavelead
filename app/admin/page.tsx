import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { Button } from '@/components/ui/button';
import { Inbox, LayoutList, Users, Shield, Trophy, ClipboardCheck, KeyRound, ShieldAlert, Megaphone, Wallet, DollarSign, Activity, TrendingUp, Handshake, Cog } from 'lucide-react';
import AdminNav from '@/components/layout/AdminNav';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You need moderator access or higher to view this page.</p>
          <p className="text-xs text-muted-foreground mt-6">Signed in as {actor.user.email} · role {actor.user.role}</p>
        </main>
        <Footer />
      </>
    );
  }

  const [pendingCount, approvedCount, rejectedCount, pendingClaims, pendingChanges, newLeads] = await Promise.all([
    channelRepo.count({ status: 'pending_review' }),
    channelRepo.count({ status: 'approved' }),
    channelRepo.count({ status: 'rejected' }),
    (await import('@/lib/db/mongo')).getCollection((await import('@/lib/db/collections')).COLLECTIONS.CHANNEL_CLAIMS).then((c) => c.countDocuments({ status: 'pending' })),
    (await import('@/lib/db/mongo')).getCollection((await import('@/lib/db/collections')).COLLECTIONS.CHANNEL_CHANGE_REQUESTS).then((c) => c.countDocuments({ status: 'pending' })),
    (await import('@/lib/db/mongo')).getCollection((await import('@/lib/db/collections')).COLLECTIONS.SPONSORSHIP_LEADS).then((c) => c.countDocuments({ status: 'new' })),
  ]);

  const cards: { title: string; href: string; blurb: string; icon: React.ReactNode; badge?: string }[] = [
    { title: 'Moderation Queue', href: '/admin/channels?status=pending_review', blurb: 'Review, approve or reject new channel submissions.', icon: <Inbox className="h-5 w-5" />, badge: pendingCount > 0 ? `${pendingCount} pending` : undefined },
    { title: 'Ownership Claims', href: '/admin/claims?status=pending', blurb: 'Approve, reject or request more info on claims.', icon: <KeyRound className="h-5 w-5" />, badge: pendingClaims > 0 ? `${pendingClaims} pending` : undefined },
    { title: 'Sensitive Changes', href: '/admin/channel-changes?status=pending', blurb: 'Approve identity/URL changes from verified owners.', icon: <ShieldAlert className="h-5 w-5" />, badge: pendingChanges > 0 ? `${pendingChanges} pending` : undefined },
    { title: 'Sponsorship Leads', href: '/admin/sponsorship-leads', blurb: 'Brand → channel sponsorship pipeline. Contact & close manually.', icon: <Handshake className="h-5 w-5" />, badge: newLeads > 0 ? `${newLeads} new` : undefined },
    { title: 'Promotions', href: '/admin/promotions', blurb: 'Approve and monitor owner-paid sponsored discovery campaigns.', icon: <Megaphone className="h-5 w-5" /> },
    { title: 'Promotion Rates', href: '/admin/promotion-rates', blurb: 'Set CPM rate cards for sponsored placements.', icon: <TrendingUp className="h-5 w-5" /> },
    { title: 'Payments', href: '/admin/payments', blurb: 'Funding orders, captures, and refund oversight.', icon: <Wallet className="h-5 w-5" /> },
    { title: 'Ledger', href: '/admin/ledger', blurb: 'Immutable financial history for campaigns and refunds.', icon: <DollarSign className="h-5 w-5" /> },
    { title: 'Payment Health', href: '/admin/payment-health', blurb: 'Provider configuration, reconciliation health, alerts.', icon: <Activity className="h-5 w-5" /> },
    { title: 'FX Rates', href: '/admin/fx-rates', blurb: 'Manage USD ↔ IDR (and future) reference rates.', icon: <DollarSign className="h-5 w-5" /> },
    { title: 'Users', href: '/admin/users', blurb: 'Super-Admin: search users, reset passwords, disable accounts.', icon: <Users className="h-5 w-5" /> },
    { title: 'PayPal Settings', href: '/admin/settings/paypal', blurb: 'Super-Admin: manage encrypted PayPal credentials & mode.', icon: <Cog className="h-5 w-5" /> },
    { title: 'Homepage Curation', href: '/admin/homepage', blurb: 'Manage Popular / New & Noteworthy / Featured slots.', icon: <LayoutList className="h-5 w-5" /> },
    { title: 'Approved channels', href: '/admin/channels?status=approved', blurb: 'Browse the current public catalogue.', icon: <ClipboardCheck className="h-5 w-5" />, badge: `${approvedCount} live` },
    { title: 'Rejected channels', href: '/admin/channels?status=rejected', blurb: 'Audit past rejection decisions.', icon: <Shield className="h-5 w-5" />, badge: rejectedCount > 0 ? `${rejectedCount}` : undefined },
  ];

  return (
    <>
      <Header />
      <main className="container py-10">
        <AdminNav active="/admin" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Admin Console</h1>
            <p className="text-muted-foreground mt-1">Signed in as {actor.user.email} · role <span className="font-semibold">{actor.user.role}</span></p>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.title} href={c.href} className="wh-card p-5 hover:border-primary/40 transition">
              <div className="flex items-center gap-3">
                <span className="h-10 w-10 grid place-items-center rounded-lg bg-primary/10 text-primary">{c.icon}</span>
                <div className="font-semibold">{c.title}</div>
                {c.badge && <span className="ml-auto text-xs bg-secondary text-secondary-foreground rounded-full px-2 py-0.5">{c.badge}</span>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{c.blurb}</p>
            </Link>
          ))}
        </div>
        <div className="mt-10 flex gap-2">
          <Link href="/admin/channels?status=pending_review"><Button>Open moderation queue</Button></Link>
          <Link href="/admin/homepage"><Button variant="outline">Manage homepage</Button></Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
