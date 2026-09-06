import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { channelService } from '@/lib/services/channelService';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { countryByCode } from '@/lib/constants/countries';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { marketplaceService } from '@/lib/services/marketplaceService';
import { sponsorshipLeadService } from '@/lib/services/sponsorshipLeadService';
import { OBJECTIVE_LABEL } from '@/lib/validation/sponsorshipSchemas';
import { Button } from '@/components/ui/button';
import SponsorForm from './SponsorForm';
import MarketplaceBookingForm from './MarketplaceBookingForm';
import { BadgeCheck, ShieldCheck, Users, ArrowLeft } from 'lucide-react';

interface Params { slug: string; }
interface SearchParams { package?: string | string[]; lead?: string | string[] }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await channelService.getPublicBySlug(slug);
  if (!c) return { title: 'Sponsor a Channel — WaveLead' };
  return { title: `Sponsor ${c.name} — WaveLead`, robots: { index: false, follow: false } };
}
export const dynamic = 'force-dynamic';

export default async function SponsorChannelPage({
  params, searchParams,
}: { params: Promise<Params>; searchParams?: Promise<SearchParams> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const channel = await channelService.getPublicBySlug(slug);
  if (!channel) notFound();
  const [category, actor] = await Promise.all([
    channel.category_id ? categoryRepo.listActive().then((cs) => cs.find((c) => c.id === channel.category_id) || null) : Promise.resolve(null),
    resolveActorFromCookies(),
  ]);

  // Resolve ?package=<id> to an active fixed-price marketplace package (if any).
  const wantedPackageId = typeof sp.package === 'string' ? sp.package : Array.isArray(sp.package) ? sp.package[0] : null;
  // M16.1 — ?lead=<id> continues an ACCEPTED sponsorship request into the
  // EXISTING marketplace booking flow. The package-selection step is kept —
  // WaveLead never infers a price from budget range or conversation.
  const wantedLeadId = typeof sp.lead === 'string' ? sp.lead : Array.isArray(sp.lead) ? sp.lead[0] : null;
  if (wantedLeadId && !actor) {
    const back = `/sponsor/${slug}?lead=${encodeURIComponent(wantedLeadId)}${wantedPackageId ? `&package=${encodeURIComponent(wantedPackageId)}` : ''}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }
  const continuationLead = wantedLeadId && actor
    ? await sponsorshipLeadService.getForBookingContinuation(actor, wantedLeadId, channel.id).catch(() => null)
    : null;
  const publicCard = (wantedPackageId || continuationLead) ? await marketplaceService.getPublicRateCard(channel.id).catch(() => null) : null;
  const resolvedPkg = wantedPackageId && publicCard ? publicCard.packages.find((p) => p.id === wantedPackageId) || null : null;
  // Only fixed-price packages route to marketplace UI. custom_quote / missing → fallback to lead flow.
  const useMarketplaceUi = !!(resolvedPkg && resolvedPkg.type !== 'custom_quote' && (resolvedPkg.price_minor ?? 0) > 0);
  const bookablePackages = (publicCard?.packages || []).filter((p) => p.type !== 'custom_quote' && (p.price_minor ?? 0) > 0);
  // Continuation without a chosen package → show the existing package
  // selection step (never the sales-assisted lead form, which would create a
  // duplicate request).
  const showPackageChooser = !!continuationLead && !useMarketplaceUi;

  const country = countryByCode(channel.country_code);
  const followers = channel.follower_count > 0 ? `${Number(channel.follower_count).toLocaleString()} followers` : 'Reach not verified';

  return (
    <>
      <Header />
      <main className="container py-8 md:py-12 max-w-5xl">
        <Link href={`/channel/${channel.slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to channel
        </Link>
        <div className="mt-4 grid md:grid-cols-[1fr_auto] gap-6 items-start">
          <div>
            <div className="text-xs uppercase tracking-wide text-primary font-semibold">
              {useMarketplaceUi ? 'Book a sponsorship' : 'Sponsor this Channel'}
            </div>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">{channel.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {channel.is_official && <span className="inline-flex items-center gap-1 text-primary"><BadgeCheck className="h-4 w-4" /> Official</span>}
              {channel.is_verified && !channel.is_official && <span className="inline-flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> Verified</span>}
              {category && <Link href={`/category/${category.slug}`} className="hover:text-foreground">{category.name}</Link>}
              {country && <span>{country.flag} {country.name}</span>}
              <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {followers}</span>
            </div>
            {channel.short_description && <p className="mt-3 text-sm text-muted-foreground max-w-xl">{channel.short_description}</p>}
            {wantedPackageId && !useMarketplaceUi && (
              <p className="mt-3 text-xs text-muted-foreground">
                That package is not available for direct booking. WaveLead will follow up manually to coordinate a custom sponsorship.
              </p>
            )}
          </div>
        </div>

        <div className="mt-8">
          {showPackageChooser ? (
            <div className="wh-card p-5 md:p-6" data-testid="continue-booking-package-chooser">
              <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Accepted by Channel Owner</div>
              <h2 className="mt-1 text-lg font-semibold">Choose the sponsorship package to book</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {channel.name} accepted your request. Select the package you want to book — WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed. Your campaign brief carries over.
              </p>
              {bookablePackages.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground" data-testid="continue-booking-no-packages">
                  This channel has no bookable fixed-price package published right now. Use the conversation on your{' '}
                  <Link href={`/dashboard/sponsorship-requests/${continuationLead!.id}`} className="text-primary underline">sponsorship request</Link>{' '}
                  to agree the package with the owner — they can publish it on their rate card.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3 md:grid-cols-2">
                  {bookablePackages.map((p) => (
                    <li key={p.id} className="rounded-md border border-border p-4 flex flex-col" data-testid={`continue-booking-pkg-${p.id}`}>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{p.type.replace(/_/g, ' ')}</div>
                      <div className="mt-0.5 font-semibold">{p.name}</div>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{p.description}</p>
                      <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                        <div className="text-base font-bold">${(((p.price_minor ?? 0) as number) / 100).toFixed(2)} <span className="text-xs font-normal text-muted-foreground">USD</span></div>
                        <Link href={`/sponsor/${channel.slug}?package=${encodeURIComponent(p.id)}&lead=${encodeURIComponent(continuationLead!.id)}`}>
                          <Button size="sm">Select</Button>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-muted-foreground">No payment is taken on this page. Payment always stays on WaveLead.</p>
            </div>
          ) : useMarketplaceUi && resolvedPkg ? (
            <MarketplaceBookingForm
              channelId={channel.id}
              channelName={channel.name}
              channelSlug={channel.slug}
              pkg={{
                id: resolvedPkg.id,
                type: resolvedPkg.type,
                name: resolvedPkg.name,
                description: resolvedPkg.description,
                price_minor: resolvedPkg.price_minor as number,
                currency: resolvedPkg.currency,
                deliverables: resolvedPkg.deliverables,
                estimated_delivery_days: resolvedPkg.estimated_delivery_days ?? null,
              }}
              initialContactName={continuationLead?.contact_name || actor?.user.display_name || ''}
              initialWorkEmail={continuationLead?.work_email || actor?.user.email || ''}
              isAuthed={!!actor}
              sourceLeadId={continuationLead?.id || null}
              initialCompanyName={continuationLead?.company_name || ''}
              initialObjective={continuationLead ? (OBJECTIVE_LABEL[continuationLead.objective] || continuationLead.objective) : ''}
              initialBrief={continuationLead?.brief || ''}
              initialNotes={continuationLead?.materials_url ? `Materials: ${continuationLead.materials_url}` : ''}
            />
          ) : (
            <SponsorForm
              channelSlug={channel.slug}
              channelName={channel.name}
              presetTargetCountry={channel.country_code}
              initialContactName={actor?.user.display_name || ''}
              initialWorkEmail={actor?.user.email || ''}
            />
          )}
        </div>

        {!useMarketplaceUi && !showPackageChooser && (
          <p className="mt-6 text-xs text-muted-foreground">Sales-assisted. WaveLead will coordinate with the channel owner and follow up manually. No payment is collected on this page.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
