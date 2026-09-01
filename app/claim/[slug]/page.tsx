import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { channelService } from '@/lib/services/channelService';
import { claimService } from '@/lib/services/claimService';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import ClaimForm from './ClaimForm';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Claim this channel — WaveLead',
  description: 'Verify ownership of a WhatsApp channel on WaveLead.',
};

export const dynamic = 'force-dynamic';

interface Params { slug: string; }

export default async function ClaimPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const channel = await channelService.getPublicBySlug(slug);
  if (!channel) notFound();
  const actor = await resolveActorFromCookies();
  const eligibility = await claimService.getEligibility(slug, actor);
  const ownerVerificationMode = (eligibility as { ownerVerificationMode?: boolean }).ownerVerificationMode === true;

  return (
    <>
      <Header />
      <main className="container py-10 max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold shrink-0" aria-hidden>
            {channel.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {ownerVerificationMode ? 'Ownership verification' : 'Claim ownership'}
            </div>
            <h1 className="text-2xl md:text-3xl font-bold">{channel.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {ownerVerificationMode
                ? 'This channel is already linked to your WaveLead account. Submit ownership evidence to complete verification so you can publish a sponsorship rate card.'
                : 'Verify that you run this WhatsApp Channel to appear as its Verified Owner on WaveLead.'}
            </p>
          </div>
        </div>

        {eligibility.alreadyOwned && (
          <div className="mt-8 wh-card p-6">
            <div className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-600" /> This channel already has a Verified Owner</div>
            <p className="text-sm text-muted-foreground mt-1">If you believe this listing is incorrect you can flag it to our moderators.</p>
            <div className="mt-4 flex gap-2">
              <Link href={`/report/channel/${channel.slug}`}><Button>Report ownership issue</Button></Link>
              <Link href={`/channel/${channel.slug}`}><Button variant="outline">Back to channel</Button></Link>
            </div>
          </div>
        )}

        {!eligibility.alreadyOwned && eligibility.canClaim === false && eligibility.existingClaim && (
          <div className="mt-8 wh-card p-6">
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-primary" /> Claim under review</div>
            <p className="text-sm text-muted-foreground mt-1">Your claim was submitted on {new Date(eligibility.existingClaim.submitted_at).toLocaleString()} and is currently <span className="font-semibold">{eligibility.existingClaim.status === 'needs_information' ? 'awaiting your response' : 'pending review'}</span>.</p>
            {eligibility.existingClaim.request_more_info_message && (
              <div className="mt-3 border border-amber-200 bg-amber-50 rounded-md p-3 text-sm text-amber-900">
                <div className="font-semibold">Moderator requested more information</div>
                <p className="mt-0.5 whitespace-pre-wrap">{eligibility.existingClaim.request_more_info_message}</p>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Link href="/dashboard/claims"><Button>Open my claims</Button></Link>
              <Link href={`/channel/${channel.slug}`}><Button variant="outline">Back to channel</Button></Link>
            </div>
          </div>
        )}

        {!eligibility.alreadyOwned && !eligibility.existingClaim && eligibility.canClaim && !actor && (
          <div className="mt-8 wh-card p-6">
            <div className="font-semibold">Sign in to submit your claim</div>
            <p className="text-sm text-muted-foreground mt-1">We ask you to sign in so we can contact you about verification. Any evidence you provide is private and only visible to WaveLead moderators.</p>
            <div className="mt-4 flex gap-2">
              <Link href={`/login?next=/claim/${channel.slug}`}><Button>Log in</Button></Link>
              <Link href={`/signup?next=/claim/${channel.slug}`}><Button variant="outline">Create an account</Button></Link>
            </div>
          </div>
        )}

        {!eligibility.alreadyOwned && !eligibility.existingClaim && eligibility.canClaim && actor && (
          <ClaimForm
            channel={{ id: channel.id, slug: channel.slug, name: channel.name, website_url: channel.website_url ?? null }}
            claimantEmail={actor.user.email}
          />
        )}

        {!eligibility.canClaim && !eligibility.alreadyOwned && !eligibility.existingClaim && (
          <div className="mt-8 wh-card p-6">
            <div className="flex items-center gap-2 text-destructive font-semibold"><AlertTriangle className="h-4 w-4" /> Not claimable</div>
            <p className="text-sm text-muted-foreground mt-1">{eligibility.reason || 'This channel cannot be claimed at this time.'}</p>
            <div className="mt-4"><Link href={`/channel/${channel.slug}`}><Button variant="outline">Back to channel</Button></Link></div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
