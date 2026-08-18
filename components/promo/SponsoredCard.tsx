'use client';

// M05.1 sponsored channel card. Renders a clearly-labeled paid placement.
// On mount, acknowledges the impression to the server (which enforces
// frequency cap + budget + emits the sponsored channel_impression event).
// The /go link is decorated with the signed attribution token so the
// downstream follow-click event is credited as sponsored.
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

export interface SponsoredCardData {
  campaign_id: string;
  channel: {
    id: string;
    slug: string;
    name: string;
    short_description: string | null;
    logo_url: string | null;
    country_code: string | null;
    primary_language: string | null;
    is_verified: boolean;
    is_official: boolean;
  };
  attribution_token: string;
  placement: string;
  source: string;
}

export default function SponsoredCard({ data, sourcePath }: { data: SponsoredCardData; sourcePath: string }) {
  const acked = useRef(false);
  useEffect(() => {
    if (acked.current) return;
    acked.current = true;
    // Fire-and-forget. Server enforces cap + budget and de-duplicates.
    fetch('/api/track/sponsored/impression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribution_token: data.attribution_token }),
      keepalive: true,
    }).catch(() => {});
  }, [data.attribution_token]);

  async function onProfileClick() {
    // Best-effort profile-view acknowledgement.
    fetch('/api/track/sponsored/profile-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribution_token: data.attribution_token }),
      keepalive: true,
    }).catch(() => {});
  }

  const ch = data.channel;
  const goHref = `/go/${ch.slug}?wl_at=${encodeURIComponent(data.attribution_token)}&from=${encodeURIComponent(sourcePath)}`;

  return (
    <div className="wh-card p-4 relative border-primary/30 bg-primary/[0.02] hover:bg-primary/[0.04] transition">
      <div className="absolute -top-2 left-3">
        <Badge className="text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary border border-primary/30">Sponsored</Badge>
      </div>
      <div className="flex items-start gap-3">
        {ch.logo_url
          ? <img src={ch.logo_url} alt={ch.name} className="h-12 w-12 rounded-full object-cover border" />
          : <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center font-semibold">{ch.name[0]}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={`/channel/${ch.slug}`} onClick={onProfileClick} className="font-semibold hover:underline truncate">{ch.name}</Link>
            {ch.is_verified && <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Verified" />}
            {ch.is_official && <ShieldCheck className="h-4 w-4 text-amber-600" aria-label="Official" />}
          </div>
          {ch.short_description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ch.short_description}</p>}
          <div className="mt-3 flex gap-2">
            <Link href={`/channel/${ch.slug}`} onClick={onProfileClick} className="text-xs font-medium text-primary hover:underline">View Channel</Link>
            <span aria-hidden className="text-muted-foreground text-xs">·</span>
            <a href={goHref} className="text-xs font-medium text-primary hover:underline" rel="noopener nofollow sponsored">Follow on WhatsApp</a>
          </div>
        </div>
      </div>
    </div>
  );
}
