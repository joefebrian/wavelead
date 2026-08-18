import Link from 'next/link';
import { ShieldCheck, Users, Sparkles } from 'lucide-react';
import { countryByCode } from '@/lib/constants/countries';
import type { PublicChannel } from '@/lib/types';

export type ChannelCardVariant = 'standard' | 'compact' | 'ranking' | 'horizontal';

interface Props {
  channel: PublicChannel;
  variant?: ChannelCardVariant;
  rank?: number;
  sponsored?: boolean; // architecture-ready, never render fake sponsored
}

function Avatar({ channel, size = 'h-12 w-12 text-lg' }: { channel: PublicChannel; size?: string }) {
  return (
    <div className={`${size} shrink-0 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold`}
      aria-hidden>
      {(channel.name || 'W').charAt(0).toUpperCase()}
    </div>
  );
}

function Meta({ channel }: { channel: PublicChannel }) {
  const country = countryByCode(channel.country_code);
  return (
    <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center gap-1.5">
      {country && <span aria-hidden>{country.flag}</span>}
      <span>{channel.country_code}</span>
      {channel.primary_language && <span aria-hidden>·</span>}
      {channel.primary_language && <span>{channel.primary_language}</span>}
    </div>
  );
}

export default function ChannelCard({ channel, variant = 'standard', rank, sponsored }: Props) {
  const href = `/channel/${channel.slug}`;
  const followers = channel.follower_count > 0 ? `${Number(channel.follower_count).toLocaleString()} followers` : 'Followers not verified';

  if (variant === 'ranking') {
    return (
      <Link href={href} className="group flex items-center gap-4 rounded-lg border border-transparent p-3 hover:bg-secondary/40 hover:border-border transition">
        <div className="w-6 shrink-0 text-center text-lg font-bold text-muted-foreground">{rank}</div>
        <Avatar channel={channel} size="h-10 w-10 text-base" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold truncate">{channel.name}</span>
            {channel.is_verified && <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
          </div>
          <div className="text-xs text-muted-foreground truncate">{channel.short_description}</div>
        </div>
        <div className="text-xs text-muted-foreground hidden md:block whitespace-nowrap">{followers}</div>
      </Link>
    );
  }

  if (variant === 'compact') {
    return (
      <Link href={href} className="wh-card p-4 block">
        <div className="flex items-start gap-3">
          <Avatar channel={channel} size="h-10 w-10 text-base" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="font-semibold truncate text-sm">{channel.name}</div>
              {channel.is_verified && <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
            </div>
            <Meta channel={channel} />
          </div>
        </div>
      </Link>
    );
  }

  if (variant === 'horizontal') {
    return (
      <Link href={href} className="wh-card p-4 flex items-start gap-4 w-[280px] shrink-0">
        <Avatar channel={channel} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold truncate">{channel.name}</div>
            {channel.is_verified && <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
          </div>
          <Meta channel={channel} />
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{channel.short_description || channel.description}</p>
        </div>
      </Link>
    );
  }

  // standard
  return (
    <Link href={href} className="wh-card p-5 block relative">
      {sponsored && <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">Sponsored</span>}
      <div className="flex items-start gap-4">
        <Avatar channel={channel} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold truncate">{channel.name}</div>
            {channel.is_verified && <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
            {channel.is_featured && <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />}
          </div>
          <Meta channel={channel} />
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{channel.short_description || channel.description}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {followers}
            </span>
            <span className="text-xs font-medium text-primary">View channel →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
