import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { ArrowLeft } from 'lucide-react';
import AnalyticsClient from './AnalyticsClient';

export const metadata: Metadata = { title: 'Channel Analytics — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

export default async function ChannelAnalyticsPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/channels/${id}/analytics`);

  const channel = await channelRepo.findById(id);
  const isAdmin = actor.user.role === 'admin' || actor.user.role === 'super_admin';
  if (!channel) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">404 — Not found</h1>
          <p className="text-muted-foreground mt-2">This channel does not exist.</p>
          <div className="mt-6"><Link href="/dashboard/channels"><Button variant="outline">Back to my channels</Button></Link></div>
        </main>
        <Footer />
      </>
    );
  }
  const isOwner = channel.owner_id === actor.user.id;
  if (!isOwner && !isAdmin) {
    return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You do not have access to this channel&apos;s analytics.</p>
          <div className="mt-6"><Link href="/dashboard/channels"><Button variant="outline">Back to my channels</Button></Link></div>
        </main>
        <Footer />
      </>
    );
  }

  // Multi-channel switcher: only channels this user actually owns.
  const myChannels = await channelRepo.list({ filter: { owner_id: actor.user.id }, sort: { updated_at: -1 }, limit: 50 });

  return (
    <>
      <Header />
      <main className="container py-6 md:py-8">
        <Link href={`/dashboard/channels/${channel.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Manage channel
        </Link>
        <div className="mt-3 flex flex-col md:flex-row md:items-end gap-4 justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Analytics · {channel.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              How people discover your channel on WaveLead. This is WaveLead visitor context — not WhatsApp follower demographics.
            </p>
          </div>
        </div>
        <AnalyticsClient
          channelId={channel.id}
          channelSlug={channel.slug}
          myChannels={myChannels.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
          isAdminViewingOtherChannel={!isOwner && isAdmin}
        />
      </main>
      <Footer />
    </>
  );
}
