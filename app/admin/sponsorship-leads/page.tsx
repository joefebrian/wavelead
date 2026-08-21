import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL, BUDGET_LABEL, BUDGET_MID_USD_MINOR, LEAD_STATUSES } from '@/lib/validation/sponsorshipSchemas';
import type { SponsorshipLeadStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Admin · Sponsorship Leads — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<SponsorshipLeadStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  contacted: 'bg-amber-100 text-amber-800',
  qualified: 'bg-primary/10 text-primary',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-slate-100 text-slate-700',
};

export default async function AdminSponsorshipLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/sponsorship-leads');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) return <ForbiddenShell email={actor.user.email} role={actor.user.role} />;
  const sp = await searchParams;
  const status = (sp?.status as SponsorshipLeadStatus | undefined);
  const items = await sponsorshipLeadService.listAdmin(actor, { status });
  const counts = await sponsorshipLeadService.adminStatusCounts(actor);
  const potentialMinor = items.filter((l) => l.status === 'new' || l.status === 'contacted' || l.status === 'qualified').reduce((s, l) => s + (BUDGET_MID_USD_MINOR[l.budget_range] || 0), 0);

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-6xl">
        <AdminNav active="/admin/sponsorship-leads" />
        <h1 className="text-3xl font-bold tracking-tight">Sponsorship Leads</h1>
        <p className="mt-1 text-muted-foreground">Sales-assisted brand → channel sponsorship funnel. Reach out to brands, coordinate manually.</p>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="New" value={counts.new} tone="sky" />
          <Kpi label="Qualified" value={counts.qualified} tone="primary" />
          <Kpi label="Won" value={counts.won} tone="emerald" />
          <Kpi label="Potential (directional)" value={`~$${(potentialMinor / 100).toLocaleString()}`} tone="muted" hint="Sum of budget-range midpoints for open leads. Directional only." />
        </div>

        <div className="mt-6 flex gap-2 flex-wrap">
          <Link href="/admin/sponsorship-leads" className={pill(!status)}>All</Link>
          {LEAD_STATUSES.map((s) => (
            <Link key={s} href={`/admin/sponsorship-leads?status=${s}`} className={pill(status === s)}>
              {s} <span className="ml-1 opacity-70">({counts[s]})</span>
            </Link>
          ))}
        </div>

        <div className="mt-6 wh-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Budget</th>
                <th className="px-3 py-2">Objective</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No sponsorship leads {status ? `in status "${status}"` : 'yet'}.</td></tr>}
              {items.map((l) => (
                <tr key={l.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2"><div className="font-medium">{l.company_name}</div><div className="text-xs text-muted-foreground">{l.contact_name}</div></td>
                  <td className="px-3 py-2"><Link href={`/channel/${l.channel_slug_snapshot}`} className="hover:underline">{l.channel_name_snapshot}</Link></td>
                  <td className="px-3 py-2 whitespace-nowrap">{BUDGET_LABEL[l.budget_range]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{OBJECTIVE_LABEL[l.objective]}</td>
                  <td className="px-3 py-2"><Badge className={STATUS_BADGE[l.status]}>{l.status}</Badge></td>
                  <td className="px-3 py-2 text-right"><Link href={`/admin/sponsorship-leads/${l.id}`} className="text-sm text-primary hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <Footer />
    </>
  );
}

function pill(active: boolean): string { return `rounded-full px-3 py-1 text-xs font-medium ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`; }

function Kpi({ label, value, tone, hint }: { label: string; value: number | string; tone: 'sky'|'primary'|'emerald'|'muted'; hint?: string }) {
  const t = tone === 'primary' ? 'text-primary' : tone === 'emerald' ? 'text-emerald-600' : tone === 'sky' ? 'text-sky-600' : 'text-muted-foreground';
  return (
    <div className="wh-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${t}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ForbiddenShell({ email, role }: { email: string; role: string }) {
  return (
    <>
      <Header />
      <main className="container py-20 text-center">
        <h1 className="text-3xl font-bold">403 — Forbidden</h1>
        <p className="text-muted-foreground mt-2">You need moderator access or higher to view sponsorship leads.</p>
        <p className="text-xs text-muted-foreground mt-6">Signed in as {email} · role {role}</p>
      </main>
      <Footer />
    </>
  );
}
