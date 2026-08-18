import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies, ROLES, rankOf } from '@/lib/auth/rbac';
import { promotionRateCardRepo } from '@/lib/repositories/promotionRepo';
import RateCardForm from './RateCardForm';

export const metadata: Metadata = { title: 'Admin · Promotion rates — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminRatesPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/promotion-rates');
  if (rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const cards = await promotionRateCardRepo.list();
  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-4xl">
        <h1 className="text-3xl font-bold tracking-tight">Admin · Promotion rates</h1>
        <p className="mt-1 text-muted-foreground">CPM pricing per sponsored placement. Country-specific rates override the global fallback.</p>

        <RateCardForm />

        <section className="mt-8">
          <h2 className="font-semibold">Current rate cards</h2>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground text-left border-b"><th className="py-1">Placement</th><th>Country</th><th>CPM (USD)</th><th>Active</th><th>Source</th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-1.5">{c.placement.replace('sponsored_', '')}</td>
                  <td>{c.country_code || <span className="text-muted-foreground">global</span>}</td>
                  <td>${(c.cpm_usd_minor / 100).toFixed(2)}</td>
                  <td>{c.active ? '✓' : '–'}</td>
                  <td className="text-xs text-muted-foreground">{c.is_fixture ? 'seed / default' : 'admin'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
      <Footer />
    </>
  );
}
