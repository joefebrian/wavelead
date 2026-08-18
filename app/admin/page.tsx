import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin');
  // Role is CURRENT DB role — revocation takes immediate effect.
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You need moderator access or higher to view this page.</p>
          <p className="text-xs text-muted-foreground mt-6">Signed in as {actor.user.email} · role {actor.user.role}</p>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="container py-14">
        <h1 className="text-3xl font-bold">Admin Console</h1>
        <p className="text-muted-foreground mt-2">Moderation, claims, campaigns — role scaffolding is live.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {['channels','claims','reports','campaigns','categories','users'].map((section) => (
            <div key={section} className="wh-card p-6">
              <div className="font-semibold capitalize">{section}</div>
              <div className="text-xs text-muted-foreground mt-1">Available in a later milestone.</div>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
