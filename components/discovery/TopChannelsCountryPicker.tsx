'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ChannelCard from './ChannelCard';
import SectionHeader from './SectionHeader';
import EmptyState from './EmptyState';
import { Loader2, ChevronDown } from 'lucide-react';
import type { PublicChannel } from '@/lib/types';

interface CountryOpt { code: string; slug: string; name: string; flag: string; }
interface Props {
  initial: PublicChannel[];
  initialCountry: CountryOpt;
  countries: CountryOpt[];
  limit?: number;
}

export default function TopChannelsCountryPicker({ initial, initialCountry, countries, limit = 5 }: Props) {
  const [country, setCountry] = useState<CountryOpt>(initialCountry);
  const [items, setItems] = useState<PublicChannel[]>(initial);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const cacheKey = useMemo(() => `${country.code}:${limit}`, [country.code, limit]);

  useEffect(() => {
    let cancelled = false;
    if (country.code === initialCountry.code) return;
    setLoading(true);
    fetch(`/api/channels/top?country=${country.code}&limit=${limit}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setItems((j?.data?.items as PublicChannel[]) || []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return (
    <section className="container py-10">
      <SectionHeader
        title={`Top Channels in ${country.name}`}
        subtitle="Ranked by follower reach on WaveLead."
        href={`/top?country=${country.code}`}
        cta="View Top Channels"
        right={
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className="inline-flex items-center gap-1.5 text-xs text-foreground bg-card border border-border rounded-full px-3 py-1 hover:border-primary/40"
            >
              <span aria-hidden>{country.flag}</span>
              <span>{country.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
                <div role="listbox" className="absolute right-0 top-full mt-1 z-20 min-w-[190px] max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md">
                  {countries.map((c) => (
                    <button
                      key={c.code}
                      role="option"
                      aria-selected={c.code === country.code}
                      onClick={() => { setCountry(c); setOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/60 flex items-center gap-2 ${c.code === country.code ? 'bg-secondary/40 font-semibold' : ''}`}
                    >
                      <span aria-hidden>{c.flag}</span> <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />
      {loading ? (
        <div className="wh-card p-8 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading top channels…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No approved channels yet"
          message={`No approved channels in ${country.name} yet.`}
          ctaHref="/channels"
        />
      ) : (
        <div className="wh-card p-2 md:p-3 divide-y divide-border/60">
          {items.map((c, i) => <ChannelCard key={c.id} channel={c} variant="ranking" rank={i + 1} />)}
        </div>
      )}
      <div className="mt-3 text-right">
        <Link href={`/top?country=${country.code}`} className="text-xs text-primary">View full ranking →</Link>
      </div>
    </section>
  );
}
