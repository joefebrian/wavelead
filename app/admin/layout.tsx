// M18 — Admin console shell.
//
// Same design language as the product shell (admin is a privileged context,
// not a separate visual product). The overcrowded horizontal multi-row admin
// menu is replaced by the grouped sidebar.
//
// RBAC: items are filtered with the SAME rbac helper the pages use, so the
// navigation never advertises a route the current role cannot open. The
// per-page/server guards are unchanged and remain authoritative.
import { redirect } from 'next/navigation';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import AppShell from '@/components/layout/AppShell';
import { ADMIN_NAV_GROUPS } from '@/lib/constants/navigation';
import type { Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin');

  const groups = ADMIN_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAtLeastRole(actor.user, (i.min_role || ROLES.MODERATOR) as Role)) }))
    .filter((g) => g.items.length > 0);

  return (
    <AppShell
      context="admin"
      groups={groups}
      user={{ email: actor.user.email, display_name: actor.user.display_name ?? null, role: actor.user.role }}
    >
      {children}
    </AppShell>
  );
}
