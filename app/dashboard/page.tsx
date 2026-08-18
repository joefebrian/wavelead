import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { ownerService } from '@/lib/services/ownerService';
import { claimService } from '@/lib/services/claimService';
import { KeyRound, ShieldCheck, Send } from 'lucide-react';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard');

  const [channels, claims] = await Promise.all([
    ownerService.listMine(actor),
    claimService.listMine(actor),
  ]);
  const activeClaims = claims.filter((c) => c.status === 'pending' || c.status === 'needs_information').length;

  return (
    <>
      <Header />
      <main className="container py-10 max-w-5xl">
        <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Signed in as <span className="font-medium text-foreground">{actor.user.display_name || actor.user.email}</span> · role <span className="font-mono text-primary">{actor.user.role}</span>
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Link href="/dashboard/channels" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> My channels</div>
            <div className="mt-2 text-3xl font-bold">{channels.length}</div>
            <div className="mt-3 text-xs text-muted-foreground">Manage the channels you own.</div>
          </Link>
          <Link href="/dashboard/claims" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><KeyRound className="h-4 w-4" /> Active claims</div>
            <div className="mt-2 text-3xl font-bold">{activeClaims}</div>
            <div className="mt-3 text-xs text-muted-foreground">Track claim submissions & moderator requests.</div>
          </Link>
          <Link href="/submit" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Send className="h-4 w-4" /> Submit a channel</div>
            <div className="mt-2 text-3xl font-bold">+</div>
            <div className="mt-3 text-xs text-muted-foreground">Add a new WhatsApp Channel to WaveLead.</div>
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/dashboard/channels"><Button variant="outline">My channels</Button></Link>
          <Link href="/dashboard/claims"><Button variant="outline">My claims</Button></Link>
          <Link href="/submit"><Button>Submit a channel</Button></Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
