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

export default async function OwnerVerifyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { id } = await params;
  const { path } = await searchParams;
  const initialView = path === 'fast' || path === 'manual' ? path : 'choice';
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
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Ownership verification</div>
        <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="verification-choice-subtitle">
          Choose how you&apos;d like to verify and activate ownership.
        </p>
        {!state?.listing_approved && (
          <p className="mt-2 text-sm text-amber-700" data-testid="listing-not-approved">
            Your channel listing is still being reviewed. Fast Verification opens once the listing is approved — Manual Verification is available now.
          </p>
        )}
        <VerifyClient
          channelId={id}
          channelSlug={channel.slug}
          initialState={state}
          initialIdentity={identity}
          declarationText={ownerVerificationService.OWNER_DECLARATION_TEXT}
          initialView={initialView}
        />
      </main>
      <Footer />
    </>
  );
}
