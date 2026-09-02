import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { ownerService } from '@/lib/services/ownerService';
import { claimService } from '@/lib/services/claimService';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { personaService } from '@/lib/services/personaService';
import PersonaOnboarding from './PersonaOnboarding';
import { KeyRound, ShieldCheck, Send, Megaphone, Wallet, Handshake, Compass, Shield, Users, Cog, Activity, Kanban } from 'lucide-react';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard');

  const isBusiness = actor.user.role === 'business';
  const isSuperAdmin = actor.user.role === 'super_admin';

  const [channels, claims, myLeads, personaState] = await Promise.all([
    ownerService.listMine(actor),
    claimService.listMine(actor),
    // Cheap requester_user_id filter — safe for any authenticated persona.
    sponsorshipLeadService.listMine(actor).catch(() => []),
    personaService.getState(actor),
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

        {isSuperAdmin && (
          <section
            data-testid="super-admin-entry"
            className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="inline-flex items-center gap-2 text-xs uppercase text-primary font-semibold tracking-wide">
                  <Shield className="h-4 w-4" /> Super Admin
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Operational surfaces are on the Admin Console. Quick links below.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin"><Button size="sm" className="gap-1.5"><Shield className="h-4 w-4" />Admin Console</Button></Link>
                <Link href="/admin/users"><Button size="sm" variant="outline" className="gap-1.5"><Users className="h-4 w-4" />Users</Button></Link>
                <Link href="/admin/settings/paypal"><Button size="sm" variant="outline" className="gap-1.5"><Cog className="h-4 w-4" />PayPal Settings</Button></Link>
                <Link href="/admin/payment-health"><Button size="sm" variant="outline" className="gap-1.5"><Activity className="h-4 w-4" />Payment Health</Button></Link>
              </div>
            </div>
          </section>
        )}

        {isBusiness && (
          <section className="mt-8 wh-card p-5 border-primary/30 bg-primary/5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="inline-flex items-center gap-2 text-xs uppercase text-primary font-semibold tracking-wide"><Handshake className="h-4 w-4" /> Brand opportunities</div>
                <h2 className="mt-1 text-lg font-semibold">Discover & sponsor WhatsApp Channels</h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-xl">Find channels that match your audience and request a sponsorship. WaveLead coordinates the partnership.</p>
              </div>
              <div className="flex gap-2">
                <Link href="/channels"><Button className="gap-1.5"><Compass className="h-4 w-4" /> Discover channels</Button></Link>
                <Link href="/for-brands"><Button variant="outline">Learn more</Button></Link>
              </div>
            </div>
          </section>
        )}

        <PersonaOnboarding initial={personaState} />

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Link href="/dashboard/channels" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> My channels</div>
            <div className="mt-2 text-3xl font-bold">{channels.length}</div>
            <div className="mt-3 text-xs text-muted-foreground">Manage the channels you own.</div>
          </Link>
          <Link href="/dashboard/promotions" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Megaphone className="h-4 w-4" /> Campaigns</div>
            <div className="mt-2 text-3xl font-bold">→</div>
            <div className="mt-3 text-xs text-muted-foreground">Grow your channel with a paid promotion.</div>
          </Link>
          <Link href="/dashboard/billing" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Billing</div>
            <div className="mt-2 text-3xl font-bold">→</div>
            <div className="mt-3 text-xs text-muted-foreground">Funding, receipts, and refunds.</div>
          </Link>
          <Link href="/dashboard/claims" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><KeyRound className="h-4 w-4" /> Active claims</div>
            <div className="mt-2 text-3xl font-bold">{activeClaims}</div>
            <div className="mt-3 text-xs text-muted-foreground">Track claim submissions & moderator requests.</div>
          </Link>
          <Link href="/dashboard/sponsorships" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Handshake className="h-4 w-4" /> My Sponsorships</div>
            <div className="mt-2 text-3xl font-bold">→</div>
            <div className="mt-3 text-xs text-muted-foreground">Sponsorship packages you&apos;ve requested from channels.</div>
          </Link>
          <Link
            href="/dashboard/sponsorships/pipeline"
            className="wh-card p-5 hover:border-primary/40 transition"
            data-testid="nav-pipeline-card"
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Kanban className="h-4 w-4" /> Pipeline
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Pro</span>
            </div>
            <div className="mt-2 text-3xl font-bold">→</div>
            <div className="mt-3 text-xs text-muted-foreground">Track active sponsorship opportunities across your channels — request to completion.</div>
          </Link>
          <Link href="/submit" className="wh-card p-5 hover:border-primary/40 transition">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Send className="h-4 w-4" /> Submit a channel</div>
            <div className="mt-2 text-3xl font-bold">+</div>
            <div className="mt-3 text-xs text-muted-foreground">Add a new WhatsApp Channel to WaveLead.</div>
          </Link>
          {myLeads.length > 0 && (
            <div className="wh-card p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Handshake className="h-4 w-4" /> My sponsorship requests</div>
              <div className="mt-2 text-3xl font-bold">{myLeads.length}</div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {myLeads.slice(0, 3).map((l) => (
                  <li key={l.id}><span className="font-medium text-foreground">{l.channel_name_snapshot}</span> · <span className="uppercase tracking-wide">{l.status}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/dashboard/channels"><Button variant="outline">My channels</Button></Link>
          <Link href="/dashboard/promotions"><Button variant="outline">Campaigns</Button></Link>
          <Link href="/dashboard/sponsorships"><Button variant="outline">My Sponsorships</Button></Link>
          <Link href="/dashboard/sponsorships/pipeline" data-testid="nav-pipeline-button">
            <Button variant="outline" className="gap-1.5">
              <Kanban className="h-4 w-4" />
              Pipeline
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Pro</span>
            </Button>
          </Link>
          <Link href="/dashboard/earnings"><Button variant="outline">Earnings</Button></Link>
          <Link href="/dashboard/billing"><Button variant="outline">Billing</Button></Link>
          <Link href="/dashboard/claims"><Button variant="outline">My claims</Button></Link>
          <Link href="/submit"><Button>Submit a channel</Button></Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
