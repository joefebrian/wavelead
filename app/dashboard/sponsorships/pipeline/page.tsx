import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { hasEntitlement } from '@/lib/entitlements';
import { marketplaceService, PIPELINE_STAGES } from '@/lib/services/marketplaceService';
import PipelineClient from './PipelineClient';
import PipelineUpgrade from './PipelineUpgrade';

export const metadata: Metadata = { title: 'Sponsorship Pipeline — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/dashboard/sponsorships/pipeline');

  const canSee = hasEntitlement(actor, 'sponsorship_pipeline_intelligence');
  if (!canSee) {
    return (
      <>
        <Header />
        <main className="container py-10 max-w-5xl">
          <h1 className="text-2xl md:text-3xl font-bold">Sponsorship Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage active sponsorship opportunities from request to completion in one workflow.</p>
          <PipelineUpgrade userEmail={actor.user.email} />
        </main>
        <Footer />
      </>
    );
  }

  const data = await marketplaceService.ownerSponsorshipPipeline(actor);

  return (
    <>
      <Header />
      <main className="container py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Sponsorship Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every active sponsorship request across your channels — from request to completion. Actions link to the existing workflow pages so nothing is duplicated.
        </p>
        <PipelineClient initial={data} stages={PIPELINE_STAGES} />
      </main>
      <Footer />
    </>
  );
}
