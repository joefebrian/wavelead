import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { channelRateCardRepo, marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';
import MonetizationClient from './MonetizationClient';

export const metadata: Metadata = { title: 'Channel · Monetization — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function OwnerMonetizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/channels/${id}/monetization`);
  const channel = await channelRepo.findById(id);
  if (!channel || channel.owner_id !== actor.user.id) redirect('/dashboard/channels');
  const vs = (channel as unknown as { verification_status?: string }).verification_status;
  const isVerified = vs === 'verified' || vs === 'official';
  const [card, orders] = await Promise.all([
    channelRateCardRepo.findByChannel(id),
    marketplaceOrderRepo.listByOwner(actor.user.id).then((rs) => rs.filter((o) => o.channel_id === id)),
  ]);
  return (
    <>
      <Header />
      <main className="container py-10 max-w-5xl">
        <div className="text-xs text-muted-foreground">Channel monetization</div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your sponsorship rate card and incoming sponsorship requests.</p>
        <MonetizationClient channelId={id} channelName={channel.name} isVerified={isVerified} initialCard={card} initialOrders={orders} />
      </main>
      <Footer />
    </>
  );
}
