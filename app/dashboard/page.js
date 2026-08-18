import { redirect } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { getSessionFromCookies } from '@/lib/auth/session';
import { authService } from '@/lib/services/authService';

export const metadata = { title: 'Dashboard', robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const session = await getSessionFromCookies();
  if (!session?.userId) redirect('/login?next=/dashboard');
  const user = await authService.me(session);

  return (
    <>
      <Header />
      <main className="container py-14">
        <h1 className="text-3xl font-bold">Owner Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Signed in as <span className="font-medium text-foreground">{user?.display_name}</span> · role: <span className="font-mono text-primary">{user?.role}</span>
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
            <div className="mt-4 text-xs text-muted-foreground">WaveHub Pro launches in a future milestone.</div>
          </div>
        </div>

        <div className="mt-10 wh-card p-6">
          <div className="font-semibold">Coming soon on your dashboard</div>
          <ul className="mt-3 text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Channel management &amp; verification</li>
            <li>Follow-click analytics &amp; acquisition sources</li>
            <li>Promotion campaigns &amp; billing</li>
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}
