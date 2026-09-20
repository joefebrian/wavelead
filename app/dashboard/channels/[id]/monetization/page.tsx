import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { channelRateCardRepo, marketplaceOrderRepo } from '@/lib/repositories/marketplaceRepo';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import MonetizationClient from './MonetizationClient';
import OwnerOnboardingPanel from '@/components/owner/OwnerOnboardingPanel';

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
  const [card, orders, leads] = await Promise.all([
    channelRateCardRepo.findByChannel(id),
    marketplaceOrderRepo.listByOwner(actor.user.id).then((rs) => rs.filter((o) => o.channel_id === id)),
    // M16 — M15 sponsorship_leads addressed to THIS channel. These are
    // incoming requests, NOT bookings — the two lists are never merged.
    sponsorshipLeadService.listForChannel(actor, id).catch(() => []),
  ]);
  return (
    <>
      <section className="w-full">
        <div className="text-xs text-muted-foreground">Channel monetization</div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your rate card, incoming sponsorship requests, and active sponsorships.</p>
        <MonetizationClient channelId={id} channelName={channel.name} channelSlug={channel.slug} isVerified={isVerified} verificationStatus={vs || null} initialCard={card} initialOrders={orders} initialLeads={leads} />
        {/* M18.1 Phase G/H — onboarding checklist (rate card CTA) + sample work. */}
        <OwnerOnboardingPanel channelId={id} />
      </section>
    </>
  );
}
