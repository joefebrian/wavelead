import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import AdminNav from '@/components/layout/AdminNav';
import { resolveActorFromCookies, hasAtLeastRole, ROLES } from '@/lib/auth/rbac';
import { curationService } from '@/lib/services/curationService';
import { channelRepo } from '@/lib/repositories/channelRepo';
import CurationClient from './CurationClient';

export const metadata: Metadata = {
  title: 'Homepage Curation — Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function HomepageCurationPage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/homepage');
  if (!hasAtLeastRole(actor.user, ROLES.MODERATOR)) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You need moderator access or higher.</p>
        </main>
        <Footer />
      </>
    );
  }

  const [slots, approvedList] = await Promise.all([
    curationService.listAll(actor),
    channelRepo.list({ filter: { status: 'approved' }, sort: { follower_count: -1 }, limit: 200 }),
  ]);

  const approvedOpts = approvedList.map((c) => ({
    id: c.id, name: c.name, slug: c.slug, country_code: c.country_code,
    follower_count: c.follower_count,
  }));

  return (
    <>
      <Header />
      <main className="container py-8 max-w-5xl">
        <AdminNav active="/admin/homepage" />
        <h1 className="text-2xl md:text-3xl font-bold">Homepage Curation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curate the <span className="font-semibold">Popular</span>, <span className="font-semibold">New &amp; Noteworthy</span> and <span className="font-semibold">Featured</span> homepage sections. Curated slots render first (in priority order), with algorithmic fallback filling remaining positions. <span className="font-semibold">Trending</span> stays algorithmic.
        </p>

        <CurationClient
          initialSlots={slots.map((s) => ({
            id: s.id,
            section: s.section,
            channel_id: s.channel_id,
            priority: s.priority,
            active: s.active,
            channel_name: s.channel?.name ?? null,
            channel_slug: s.channel?.slug ?? null,
            channel_country_code: s.channel?.country_code ?? null,
          }))}
          approved={approvedOpts}
        />
      </main>
      <Footer />
    </>
  );
}
