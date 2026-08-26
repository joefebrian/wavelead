// Moderator canonical landing.
//
// Redirects to the moderation queue that AdminNav already exposes. This page
// exists so that `defaultLandingForRole('moderator')` can point at a stable
// URL (`/admin/moderation`) instead of the query-string form.
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';

export const metadata: Metadata = { title: 'Moderation', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminModerationPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/moderation');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) redirect('/dashboard');
  redirect('/admin/channels?status=pending_review');
}
