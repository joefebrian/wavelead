import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { channelService } from '@/lib/services/channelService';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { claimService } from '@/lib/services/claimService';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import ClaimForm from './ClaimForm';
import { ShieldCheck, AlertTriangle, Info, Mail } from 'lucide-react';
import { OWNERSHIP_SUPPORT_EMAIL, type OwnershipState } from '@/lib/services/ownershipState';

// P0A — support path for ownership concerns. Deliberately an email to the
// real support inbox: there is NO formal dispute workflow yet, so we never
// imply one. Never exposes the current owner's identity.
const SupportPath = ({ channelName, channelSlug, intro }: { channelName: string; channelSlug: string; intro: string }) => {
  const subject = encodeURIComponent(`Ownership review: ${channelName}`);
  const body = encodeURIComponent(`Channel: ${channelName}\nWaveLead page: /channel/${channelSlug}\n\nWhy I believe I run this channel:\n\nEvidence links (official website, socials, etc.):\n`);
  return (
    <div className="mt-4" data-testid="ownership-support-path">
      <p className="text-sm text-muted-foreground">{intro}</p>
      <div className="mt-3 flex gap-2 flex-wrap">
        <a href={`mailto:${OWNERSHIP_SUPPORT_EMAIL}?subject=${subject}&body=${body}`}>
          <Button variant="secondary" className="gap-2"><Mail className="h-4 w-4" /> Contact {OWNERSHIP_SUPPORT_EMAIL}</Button>
        </a>
        <Link href={`/channel/${channelSlug}`}><Button variant="outline">Back to channel</Button></Link>
      </div>
    </div>
  );
};

export const metadata: Metadata = {
  title: 'Claim this channel — WaveLead',
  description: 'Verify ownership of a WhatsApp channel on WaveLead.',
};

export const dynamic = 'force-dynamic';

interface Params { slug: string; }

export default async function ClaimPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const actor = await resolveActorFromCookies();
  const publicChannel = await channelService.getPublicBySlug(slug);
  // M12 combined onboarding: if the listing isn't public yet, still let the
  // ORIGINAL submitter / linked owner reach the ownership-verification form
  // while it's pending_review. Everyone else keeps getting a 404 (privacy).
  const internal = publicChannel ? null : await channelRepo.findBySlug(slug);
  const isPendingOwner = !!(internal && actor && internal.owner_id === actor.user.id && internal.status === 'pending_review');
  if (!publicChannel && !isPendingOwner) notFound();
  const src = publicChannel ?? internal!;
  const channel = { id: src.id, slug: src.slug, name: src.name, website_url: src.website_url ?? null };
  const eligibility = await claimService.getEligibility(slug, actor);
  const ownerVerificationMode = (eligibility as { ownerVerificationMode?: boolean }).ownerVerificationMode === true;
  const pendingListing = (eligibility as { pendingListing?: boolean }).pendingListing === true;
  const state: OwnershipState = eligibility.ownershipState;

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
              {ownerVerificationMode ? 'Ownership verification' : state === 'unclaimed' ? 'Claim ownership' : 'Ownership status'}
            </div>
            <h1 className="text-2xl md:text-3xl font-bold">{channel.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingListing
                ? 'Verify you own or manage this channel. Your channel listing and ownership evidence will be reviewed together.'
                : ownerVerificationMode
                ? 'This channel is already linked to your WaveLead account. Submit ownership evidence to complete verification so you can publish a sponsorship rate card.'
                : state === 'unclaimed' || state === 'pending_claim'
                ? 'Verify that you run this WhatsApp Channel to appear as its Verified Owner on WaveLead.'
                : 'Current ownership status of this WhatsApp Channel listing on WaveLead.'}
            </p>
          </div>
        </div>

        {/* P0A — every block below is keyed on the canonical, server-side
            ownership state. Only a GENUINELY verified owner may be described
            as a "Verified Owner". No owner identity is ever rendered. */}
        {(state === 'verified_owner' || state === 'verified_activation_incomplete') && (
          <div className="mt-8 wh-card p-6" data-testid="claim-state-verified-owner">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              {state === 'verified_owner' ? 'This channel already has a Verified Owner' : 'Ownership already verified'}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {state === 'verified_owner'
                ? 'WaveLead has verified the owner of this channel, so it cannot be claimed by another account.'
                : 'WaveLead has already verified the owner of this channel. Their public owner profile is not active yet, but the channel cannot be claimed by another account.'}
            </p>
            <SupportPath channelName={channel.name} channelSlug={channel.slug} intro="If you believe this is incorrect, contact our support team with the channel link and your evidence. Ownership is never transferred automatically." />
          </div>
        )}

        {state === 'self_verified' && (
          <div className="mt-8 wh-card p-6" data-testid="claim-state-self-verified">
            <div className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-600" /> You are the verified owner of this channel</div>
            <p className="text-sm text-muted-foreground mt-1">There is nothing to claim. Manage your listing, rate card and sponsorships from your dashboard.</p>
            <div className="mt-4 flex gap-2 flex-wrap">
              <Link href={`/dashboard/channels/${channel.id}`}><Button>Manage this channel</Button></Link>
              <Link href={`/channel/${channel.slug}`}><Button variant="outline">Back to channel</Button></Link>
            </div>
          </div>
        )}

        {state === 'linked_unverified' && (
          <div className="mt-8 wh-card p-6 border-amber-200" data-testid="claim-state-linked-unverified">
            <div className="flex items-center gap-2 text-lg font-semibold"><Info className="h-5 w-5 text-amber-600" /> Ownership not yet verified</div>
            <p className="text-sm text-muted-foreground mt-1">
              This listing is linked to {actor ? 'another' : 'a'} WaveLead account, but WaveLead has <span className="font-medium text-foreground">not verified</span> its ownership.
              {actor ? ' A new claim can\u2019t be filed while it is linked.' : ' If it is your account, sign in to complete verification.'}
            </p>
            {!actor && (
              <div className="mt-4 flex gap-2 flex-wrap">
                <Link href={`/login?next=/claim/${channel.slug}`}><Button>Log in</Button></Link>
              </div>
            )}
            <SupportPath channelName={channel.name} channelSlug={channel.slug} intro="If you run this channel, contact our support team with the channel link and evidence that you manage it. Our team will review it manually." />
          </div>
        )}

        {state === 'ownership_issue' && (
          <div className="mt-8 wh-card p-6 border-amber-200" data-testid="claim-state-ownership-issue">
            <div className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="h-5 w-5 text-amber-600" /> Ownership needs review</div>
            <p className="text-sm text-muted-foreground mt-1">The ownership record for this channel needs review by WaveLead support before it can be claimed.</p>
            <SupportPath channelName={channel.name} channelSlug={channel.slug} intro="If you run this channel, contact our support team with the channel link and evidence that you manage it." />
          </div>
        )}

        {state === 'pending_claim' && eligibility.existingClaim && (
          <div className="mt-8 wh-card p-6" data-testid="claim-state-pending">
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

        {(state === 'unclaimed' || state === 'self_linked_unverified') && eligibility.canClaim && !actor && (
          <div className="mt-8 wh-card p-6" data-testid="claim-state-unclaimed-signin">
            <div className="font-semibold">Sign in to submit your claim</div>
            <p className="text-sm text-muted-foreground mt-1">We ask you to sign in so we can contact you about verification. Any evidence you provide is private and only visible to WaveLead moderators.</p>
            <div className="mt-4 flex gap-2">
              <Link href={`/login?next=/claim/${channel.slug}`}><Button>Log in</Button></Link>
              <Link href={`/signup?next=/claim/${channel.slug}`}><Button variant="outline">Create an account</Button></Link>
            </div>
          </div>
        )}

        {(state === 'unclaimed' || state === 'self_linked_unverified') && eligibility.canClaim && actor && (
          <ClaimForm
            channel={{ id: channel.id, slug: channel.slug, name: channel.name, website_url: channel.website_url ?? null }}
            claimantEmail={actor.user.email}
          />
        )}

        {state === 'not_claimable' && (
          <div className="mt-8 wh-card p-6" data-testid="claim-state-not-claimable">
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
