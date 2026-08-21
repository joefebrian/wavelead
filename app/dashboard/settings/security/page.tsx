import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import ChangeOwnPasswordForm from './ChangeOwnPasswordForm';

export const metadata: Metadata = { title: 'Security — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/settings/security');
  return (
    <>
      <Header />
      <main className="container py-10 max-w-2xl">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Account security</h1>
        <p className="mt-1 text-muted-foreground">Change your password. This will sign you out of every device.</p>
        <div className="mt-6"><ChangeOwnPasswordForm /></div>
        <div className="mt-8 wh-card p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Signed in as</div>
          <div className="mt-1">{actor.user.display_name || actor.user.email}</div>
          <div className="text-xs">role <span className="font-mono text-primary">{actor.user.role}</span></div>
        </div>
      </main>
      <Footer />
    </>
  );
}
