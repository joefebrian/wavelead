import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { ownerVerificationService } from '@/lib/services/ownerVerificationService';
import VerifyClient from './VerifyClient';

// M17 — Owner verification hub: Fast ($1) and Manual (free) paths.
// Private surface — never indexed.
export const metadata: Metadata = { title: 'Verify Channel Ownership — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function OwnerVerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/channels/${id}/verify`);
  const channel = await channelRepo.findById(id);
  if (!channel) return notFound();
  const submittedBy = (channel as unknown as { submitted_by?: string | null }).submitted_by || null;
  if (channel.owner_id !== actor.user.id && submittedBy !== actor.user.id) redirect('/dashboard/channels');

  const state = await ownerVerificationService.getState(actor, id).catch(() => null);
  const identity = await ownerVerificationService.getIdentity(actor, id).catch(() => null);

  return (
    <>
      <Header />
      <main className="container py-10 max-w-3xl">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Owner verification</div>
        <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
        {state?.listing_approved ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Your channel listing is live. Complete owner verification to manage monetization and payouts.
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-700" data-testid="listing-not-approved">
            Owner verification opens once your channel listing has been approved by WaveLead.
          </p>
        )}
        <VerifyClient
          channelId={id}
          initialState={state}
          initialIdentity={identity}
          declarationText={ownerVerificationService.OWNER_DECLARATION_TEXT}
          channelSlug={channel.slug}
        />
      </main>
      <Footer />
    </>
  );
}
