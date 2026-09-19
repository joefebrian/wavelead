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
import PendingIntentCard from '@/components/commerce/PendingIntentCard';
import { KeyRound, ShieldCheck, Send, Megaphone, Wallet, Handshake, Compass, Shield, Users, Cog, Activity, Kanban, BarChart3 } from 'lucide-react';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard');

  const isBusiness = actor.user.role === 'business';
  const isSuperAdmin = actor.user.role === 'super_admin';

  const [channels, claims, myLeads, ownerRequests, personaState] = await Promise.all([
    ownerService.listMine(actor),
    claimService.listMine(actor),
    // Cheap requester_user_id filter — safe for any authenticated persona.
    sponsorshipLeadService.listMine(actor).catch(() => []),
    // M15 — sponsorship requests received on channels this user owns.
    sponsorshipLeadService.listForOwnedChannels(actor).catch(() => []),
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

        {/* M17 — fallback for a paid intent started while logged out. Never creates a payment. */}
        <PendingIntentCard />

        <PersonaOnboarding initial={personaState} />

        {(() => {
          // Persona-aware nav emphasis. Same links, single account, single
          // session — only the grouping/ordering changes. Persona=null keeps
          // the existing behavior so pre-persona users are not disrupted.
          const p = personaState.persona;
          const OwnerCards = (
            <>
              <Link href="/dashboard/channels" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-channels">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> My channels</div>
                <div className="mt-2 text-3xl font-bold">{channels.length}</div>
                <div className="mt-3 text-xs text-muted-foreground">Manage the channels you own.</div>
              </Link>
              <Link href="/dashboard/promotions" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-promote">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Megaphone className="h-4 w-4" /> Promote</div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Grow your channel with a paid campaign.</div>
              </Link>
              <Link href="/dashboard/sponsorships/pipeline" className="wh-card p-5 hover:border-primary/40 transition" data-testid="nav-pipeline-card">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Kanban className="h-4 w-4" /> Pipeline
                  <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Pro</span>
                </div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Track active sponsorship opportunities across your channels.</div>
              </Link>
              <Link href="/dashboard/earnings" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-earnings">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><BarChart3 className="h-4 w-4" /> Earnings</div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Pending, available, and paid-out sponsorship earnings.</div>
              </Link>
              <Link href="/dashboard/claims" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-claims">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><KeyRound className="h-4 w-4" /> Active claims</div>
                <div className="mt-2 text-3xl font-bold">{activeClaims}</div>
                <div className="mt-3 text-xs text-muted-foreground">Track claim submissions & moderator requests.</div>
              </Link>
              <Link href="/dashboard/sponsorship-requests" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-sponsorship-requests">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Handshake className="h-4 w-4" /> Incoming Requests</div>
                <div className="mt-2 text-3xl font-bold" data-testid="owner-sponsorship-request-count">{ownerRequests.length}</div>
                <div className="mt-3 text-xs text-muted-foreground">Brands who&apos;ve reached out to your channels. Open to Accept, Decline, or message the brand.</div>
              </Link>
              <Link href="/submit" className="wh-card p-5 hover:border-primary/40 transition" data-testid="owner-card-submit">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Send className="h-4 w-4" /> Submit a channel</div>
                <div className="mt-2 text-3xl font-bold">+</div>
                <div className="mt-3 text-xs text-muted-foreground">Add a new WhatsApp Channel to WaveLead.</div>
              </Link>
            </>
          );
          const BrandCards = (
            <>
              <Link href="/channels" className="wh-card p-5 hover:border-primary/40 transition" data-testid="brand-card-discover">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Compass className="h-4 w-4" /> Discover channels</div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Browse WhatsApp Channels and their sponsorship packages.</div>
              </Link>
              <Link href="/dashboard/sponsorships" className="wh-card p-5 hover:border-primary/40 transition" data-testid="brand-card-sponsorships">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Handshake className="h-4 w-4" /> Active Sponsorships</div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Confirmed sponsorship bookings in the WaveLead payment and delivery workflow.</div>
              </Link>
              <Link href="/dashboard/billing" className="wh-card p-5 hover:border-primary/40 transition" data-testid="brand-card-billing">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Billing & Payments</div>
                <div className="mt-2 text-3xl font-bold">→</div>
                <div className="mt-3 text-xs text-muted-foreground">Payment history, receipts, and refunds.</div>
              </Link>
              <Link href="/dashboard/sent-requests" className="wh-card p-5 hover:border-primary/40 transition" data-testid="brand-card-my-leads">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Handshake className="h-4 w-4" /> Sent Requests</div>
                <div className="mt-2 text-3xl font-bold" data-testid="brand-sent-request-count">{myLeads.length}</div>
                {myLeads.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">Sponsorship requests you send to channel owners appear here.</div>
                ) : (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {myLeads.slice(0, 3).map((l) => (
                      <li key={l.id}>
                        <span className="font-medium text-foreground">{l.channel_name_snapshot}</span> · <span className="uppercase tracking-wide">
                          {l.status === 'new' ? 'Awaiting owner response' :
                            l.status === 'accepted_by_owner' ? 'Accepted by channel owner' :
                            l.status === 'declined_by_owner' ? 'Declined' :
                            l.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Link>
            </>
          );

          if (p === 'owner') {
            return (
              <section className="mt-8" data-testid="owner-nav-section">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Channel Owner</h2>
                <div className="grid gap-4 md:grid-cols-3">{OwnerCards}</div>
              </section>
            );
          }
          if (p === 'brand') {
            return (
              <section className="mt-8" data-testid="brand-nav-section">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Brand / Sponsor</h2>
                <div className="grid gap-4 md:grid-cols-3">{BrandCards}</div>
              </section>
            );
          }
          if (p === 'both') {
            return (
              <>
                <section className="mt-8" data-testid="owner-nav-section">
                  <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Channel Owner</h2>
                  <div className="grid gap-4 md:grid-cols-3">{OwnerCards}</div>
                </section>
                <section className="mt-8" data-testid="brand-nav-section">
                  <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Brand / Sponsor</h2>
                  <div className="grid gap-4 md:grid-cols-3">{BrandCards}</div>
                </section>
              </>
            );
          }
          // Persona is null — keep the un-grouped view exactly as pre-persona users saw it.
          return (
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {OwnerCards}
              {BrandCards}
            </div>
          );
        })()}

        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/dashboard/channels"><Button variant="outline">My channels</Button></Link>
          <Link href="/dashboard/promotions"><Button variant="outline">Campaigns</Button></Link>
          <Link href="/dashboard/sponsorships"><Button variant="outline">Active Sponsorships</Button></Link>
          <Link href="/dashboard/sponsorship-requests"><Button variant="outline">Incoming Requests</Button></Link>
          <Link href="/dashboard/sent-requests"><Button variant="outline">Sent Requests</Button></Link>
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
