import { redirect, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { ownerService } from '@/lib/services/ownerService';
import { countryByCode } from '@/lib/constants/countries';
import OwnerEditForm from './OwnerEditForm';
import SensitiveChangeForm from './SensitiveChangeForm';
import FollowerEvidenceCard from './FollowerEvidenceCard';
import ChannelActivationCard from './ChannelActivationCard';
import { audienceSnapshotService } from '@/lib/services/audienceSnapshotService';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { categoryRepo } from '@/lib/repositories/categoryRepo';

export const metadata: Metadata = { title: 'Manage channel — WaveLead', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Params { id: string; }

export default async function OwnerChannelPage({ params, searchParams }: { params: Promise<Params>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const actor = await resolveActorFromCookies();
  if (!actor) redirect(`/login?next=/dashboard/channels/${id}`);

  let data;
  try { data = await ownerService.getMine(actor, id); }
  catch (e) {
    const msg = (e as { statusCode?: number; message?: string })?.message || '';
    const code = (e as { statusCode?: number })?.statusCode;
    if (code === 403) return (
      <>
        <Header />
        <main className="container py-20 text-center">
          <h1 className="text-3xl font-bold">403 — Forbidden</h1>
          <p className="text-muted-foreground mt-2">You do not own this channel.</p>
          <div className="mt-6"><Link href="/dashboard/channels"><Button variant="outline">Back to my channels</Button></Link></div>
        </main>
        <Footer />
      </>
    );
    if (code === 404) notFound();
    throw new Error(msg);
  }

  const { channel, pending_change_request, category_name } = data;
  const country = countryByCode(channel.country_code);
  const categories = await categoryRepo.listActive();

  // Follower-evidence history for this owner+channel.
  let audienceHistory: Awaited<ReturnType<typeof audienceSnapshotService.listMine>>['items'] = [];
  try {
    const r = await audienceSnapshotService.listMine(actor, channel.id);
    audienceHistory = r.items;
  } catch { /* if 403 (edge race) or 404, keep empty */ }

  return (
    <>
      <Header />
      <main className="container py-8 max-w-4xl">
        <Link href="/dashboard/channels" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All my channels</Link>

        <div className="mt-4 flex items-start gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground text-2xl font-extrabold shrink-0" aria-hidden>{channel.name.charAt(0).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold">{channel.name}</h1>
              {channel.is_verified && <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Owner Verified</Badge>}
              {channel.is_official && <Badge>Official</Badge>}
              {channel.is_featured && <Badge variant="secondary">Featured</Badge>}
            </div>
            <div className="mt-1 text-sm text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
              {country && <span>{country.flag} {country.name}</span>}
              {channel.primary_language && <><span aria-hidden>·</span><span>{channel.primary_language}</span></>}
              {category_name && <><span aria-hidden>·</span><span>{category_name}</span></>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Link href={`/channel/${channel.slug}`} className="text-primary underline">View public profile</Link>
              <span aria-hidden className="text-muted-foreground">·</span>
              <Link href={`/dashboard/channels/${channel.id}/analytics`} className="text-primary underline">Open analytics</Link>
              <span aria-hidden className="text-muted-foreground">·</span>
              <Link href={`/dashboard/channels/${channel.id}/promote`} className="text-primary underline">Promote channel</Link>
              <span aria-hidden className="text-muted-foreground">·</span>
              <Link href={`/dashboard/channels/${channel.id}/monetization`} className="text-primary underline">Monetization</Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/dashboard/channels/${channel.id}/promote`}><Button size="sm" className="gap-1.5">Grow with Promotion</Button></Link>
              <Link href={`/dashboard/channels/${channel.id}/analytics`}><Button size="sm" variant="outline">Open Analytics</Button></Link>
              <Link href={`/dashboard/channels/${channel.id}/monetization`}><Button size="sm" variant="outline">Monetization</Button></Link>
            </div>
          </div>
        </div>

        {pending_change_request && (
          <div className="mt-6 wh-card border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold">A sensitive change request is pending moderator review</div>
            <p className="mt-1 text-xs">Submitted {new Date(pending_change_request.submitted_at).toLocaleString()}. Your public listing stays unchanged until it&apos;s approved.</p>
          </div>
        )}

        <div className="mt-6 grid gap-6">
          <ChannelActivationCard
            channelId={channel.id}
            returnActivationId={typeof sp.activation === 'string' ? sp.activation : null}
            returnStatus={typeof sp.status === 'string' ? sp.status : null}
          />
          <OwnerEditForm
            channelId={channel.id}
            initial={{
              short_description: channel.short_description ?? '',
              description: channel.description ?? '',
              website_url: channel.website_url ?? '',
              logo_url: channel.logo_url ?? '',
              cover_url: channel.cover_url ?? '',
              primary_language: channel.primary_language ?? '',
            }}
          />
          <FollowerEvidenceCard
            channelId={channel.id}
            initialHistory={audienceHistory.map((s) => ({
              id: s.id,
              followers: s.followers,
              status: s.status,
              reported_at: (s.reported_at as unknown as Date).toISOString?.() ?? (s.reported_at as unknown as string),
              evidence_date: s.evidence_date ? ((s.evidence_date as unknown as Date).toISOString?.() ?? (s.evidence_date as unknown as string)) : null,
              verified_at: s.verified_at ? ((s.verified_at as unknown as Date).toISOString?.() ?? (s.verified_at as unknown as string)) : null,
              rejection_reason: s.rejection_reason,
              evidence_attachment: s.evidence_attachment as unknown as {
                provider: 'uploadthing'; storage_key: string; url: string;
                mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
                file_name_safe: string; size_bytes: number; uploaded_at: string;
              },
            }))}
          />
          <SensitiveChangeForm
            channelId={channel.id}
            hasPending={!!pending_change_request}
            initial={{
              name: channel.name,
              whatsapp_url: channel.whatsapp_url,
              website_url: channel.website_url ?? '',
              country_code: channel.country_code || '',
              category_slug: categories.find((c) => c.id === channel.category_id)?.slug || '',
            }}
            categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
