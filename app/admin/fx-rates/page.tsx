import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { redirect } from 'next/navigation';
import { fxAdminService } from '@/lib/services/fx/fxAdminService';
import { formatIdr } from '@/lib/utils/idrFormat';
import AdminFxCreateForm from './AdminFxCreateForm';

export const metadata = { title: 'FX Rates — Admin' };
export const dynamic = 'force-dynamic';

function formatRate(rate_scaled: number, rate_scale: number): string {
  if (rate_scale === 0) return rate_scaled.toLocaleString('en-US');
  const s = rate_scaled.toString().padStart(rate_scale + 1, '0');
  const whole = s.slice(0, -rate_scale) || '0';
  const frac = s.slice(-rate_scale).replace(/0+$/, '');
  return frac ? `${Number(whole).toLocaleString('en-US')}.${frac}` : Number(whole).toLocaleString('en-US');
}

export default async function AdminFxRatesPage() {
  const actor = await resolveActorFromCookies();
  if (!actor || rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/');
  const rows = await fxAdminService.list();
  const active = rows.find((r) => r.active) ?? null;
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-4xl flex-1">
        <AdminNav active="/admin/fx-rates" />
        <h1 className="text-2xl font-bold mb-1">FX Rates</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Admin-managed USD → IDR conversion rate used for the Indonesian rupiah <em>equivalent display</em>. This rate does not perform any payment and does not affect campaign USD accounting. Existing locked quotes are never re-priced when a new rate becomes active.
        </p>

        <section className="wh-card p-5 mb-6">
          <h2 className="font-semibold mb-2">Current USD → IDR checkout rate</h2>
          {active ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <div className="text-2xl font-bold">1 USD = {formatIdr(active.rate_scaled / Math.pow(10, active.rate_scale))}</div>
              <div className="text-sm text-muted-foreground">rate_scaled=<code>{active.rate_scaled}</code> rate_scale=<code>{active.rate_scale}</code></div>
              <div className="text-sm text-muted-foreground">effective from {active.effective_from ? new Date(active.effective_from).toISOString().slice(0, 19) + 'Z' : '—'}</div>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">Active</span>
            </div>
          ) : (
            <div className="text-sm text-red-700">No active USD → IDR rate configured. Owner IDR-equivalent displays will be hidden until a rate is set.</div>
          )}
        </section>

        <section className="wh-card p-5 mb-6">
          <h2 className="font-semibold mb-3">Add new rate</h2>
          <AdminFxCreateForm />
          <p className="text-xs text-muted-foreground mt-3">Enter a positive integer scaled by <code>rate_scale</code> decimal places. Example: 1 USD = Rp16.500 → <code>rate_scaled=16500, rate_scale=0</code>. Example: 1 USD = Rp16.523,45 → <code>rate_scaled=1652345, rate_scale=2</code>.</p>
        </section>

        <section className="wh-card p-5">
          <h2 className="font-semibold mb-3">Rate history</h2>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No rates yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Rate (1 USD = Rp)</th>
                    <th className="py-2 pr-4">Scaled</th>
                    <th className="py-2 pr-4">Effective from</th>
                    <th className="py-2 pr-4">Effective until</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 pr-4 font-medium">{formatRate(r.rate_scaled, r.rate_scale)}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{r.rate_scaled}/10^{r.rate_scale}</td>
                      <td className="py-2 pr-4 text-xs">{r.effective_from ? new Date(r.effective_from).toISOString().slice(0, 10) : '—'}</td>
                      <td className="py-2 pr-4 text-xs">{r.effective_until ? new Date(r.effective_until).toISOString().slice(0, 10) : '—'}</td>
                      <td className="py-2 pr-4">
                        {r.active
                          ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">Active</span>
                          : <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">Retired</span>}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{r.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
