import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { ownerService } from '@/lib/services/ownerService';
import { countryByCode } from '@/lib/constants/countries';
import { ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: 'My channels — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardChannelsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/channels');
  const items = await ownerService.listMine(actor);
  return (
    <>
      <Header />
      <main className="container py-8 max-w-4xl">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">My channels</h1>
            <p className="text-sm text-muted-foreground mt-1">Channels you’re verified to own. Manage each one’s public profile here.</p>
          </div>
          <Link href="/dashboard/claims"><Button variant="outline" size="sm">My claims</Button></Link>
        </div>
        {items.length === 0 ? (
          <div className="mt-8 wh-card p-8 text-center">
            <div className="font-semibold">No owned channels yet</div>
            <p className="text-sm text-muted-foreground mt-1">Claim a channel to appear as its Verified Owner.</p>
            <div className="mt-3"><Link href="/channels"><Button>Browse channels</Button></Link></div>
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {items.map((c) => {
              const country = countryByCode(c.country_code);
              const completeness = [c.short_description, c.description, c.website_url, c.logo_url, c.category_id].filter(Boolean).length;
              const pct = Math.round((completeness / 5) * 100);
              return (
                <div key={c.id} className="wh-card p-4 flex items-start gap-4">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold shrink-0" aria-hidden>{c.name.charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{c.name}</span>
                      {c.is_verified && <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Verified</Badge>}
                      {c.is_official && <Badge className="gap-1">Official</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
                      {country && <span>{country.flag} {country.name}</span>}
                      <span aria-hidden>·</span>
                      <span>Status: {c.status}</span>
                      <span aria-hidden>·</span>
                      <span>Profile {pct}% complete</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <Link href={`/channel/${c.slug}`}><Button variant="outline" size="sm">Public profile</Button></Link>
                    <Link href={`/dashboard/channels/${c.id}`}><Button size="sm">Manage</Button></Link>
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
