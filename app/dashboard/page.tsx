import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard');

  return (
    <>
      <Header />
      <main className="container py-14">
        <h1 className="text-3xl font-bold">Owner Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Signed in as <span className="font-medium text-foreground">{actor.user.display_name}</span> · role: <span className="font-mono text-primary">{actor.user.role}</span>
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="wh-card p-6">
            <div className="text-sm text-muted-foreground">Your channels</div>
            <div className="mt-2 text-2xl font-bold">0</div>
            <div className="mt-4 text-xs text-muted-foreground">Submit or claim a channel to see it here.</div>
          </div>
          <div className="wh-card p-6">
            <div className="text-sm text-muted-foreground">Follow Intent (30d)</div>
            <div className="mt-2 text-2xl font-bold">—</div>
            <div className="mt-4 text-xs text-muted-foreground">Analytics unlock in Milestone 04.</div>
          </div>
          <div className="wh-card p-6">
            <div className="text-sm text-muted-foreground">Plan</div>
            <div className="mt-2 text-2xl font-bold">Free</div>
            <div className="mt-4 text-xs text-muted-foreground">WaveLead Pro launches in a future milestone.</div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
