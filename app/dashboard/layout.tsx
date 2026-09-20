// M18 — Authenticated product shell for the whole /dashboard tree.
//
// Every dashboard page now inherits the same sidebar, utility bar, content
// max-width and vertical rhythm, so the User / Channel Owner / Brand surfaces
// stop looking like three different applications.
import { redirect } from 'next/navigation';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import AppShell from '@/components/layout/AppShell';
import { USER_NAV_GROUPS } from '@/lib/constants/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard');
  return (
    <AppShell
      context="product"
      groups={USER_NAV_GROUPS}
      user={{ email: actor.user.email, display_name: actor.user.display_name ?? null, role: actor.user.role }}
    >
      {children}
    </AppShell>
  );
}
