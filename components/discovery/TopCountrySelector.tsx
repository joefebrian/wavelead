'use client';

// WaveLead — Top Channels country navigation.
//
// REPLACES a horizontal strip of ~240 country pills rendered straight from the
// canonical registry, which opened with "Afghanistan, Åland Islands, Albania…"
// on what is an Indonesia-first page.
//
// Behaviour:
//   • A short row of shortcuts: "All Countries", the home market (Indonesia),
//     then the countries that ACTUALLY have eligible public inventory, ordered
//     by their real counts. Counts come from the database — nothing is
//     invented, and a country with no inventory is never given a fake number.
//   • The currently selected country is always pinned into the row, so a deep
//     link to a quiet market still shows its own state as selected.
//   • Everything else lives behind a searchable dropdown over the full
//     canonical registry, so no country becomes unreachable.
//
// Routing is unchanged: these are ordinary <a href="/top?country=ID"> links
// using ISO alpha-2 codes, so deep links, the selected-country state and the
// existing canonical URLs all keep working. /country/<slug> landing pages are
// untouched.
import * as React from 'react';
import { ChevronDown, Search, Check, Globe } from 'lucide-react';

export interface CountryOption {
  code: string;
  slug: string;
  name: string;
  flag: string;
  channel_count?: number;
}

interface Props {
  /** Full canonical registry, each with its real eligible count. */
  countries: CountryOption[];
  /** Selected ISO alpha-2 code, or 'all'. */
  active: string;
  /** Path the links point at (query-param routing is preserved). */
  basePath?: string;
  /** Market pinned first whenever it exists. */
  homeMarket?: string;
  /** How many shortcut pills to show besides "All Countries". */
  shortcutLimit?: number;
}

export default function TopCountrySelector({
  countries,
  active,
  basePath = '/top',
  homeMarket = 'ID',
  shortcutLimit = 7,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [queryText, setQueryText] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const byCode = React.useMemo(
    () => new Map(countries.map((c) => [c.code, c])),
    [countries],
  );

  // Shortcut row: home market first, then real inventory by count, then the
  // selected country if it would otherwise be missing.
  const shortcuts = React.useMemo(() => {
    const picked: CountryOption[] = [];
    const take = (c?: CountryOption) => {
      if (c && !picked.some((p) => p.code === c.code)) picked.push(c);
    };
    take(byCode.get(homeMarket));
    countries
      .filter((c) => (c.channel_count ?? 0) > 0)
      .sort((a, b) => (b.channel_count ?? 0) - (a.channel_count ?? 0) || a.name.localeCompare(b.name))
      .forEach(take);
    const limited = picked.slice(0, shortcutLimit);
    if (active !== 'all' && !limited.some((c) => c.code === active)) {
      const sel = byCode.get(active);
      if (sel) limited.push(sel);
    }
    return limited;
  }, [countries, byCode, homeMarket, shortcutLimit, active]);

  const filtered = React.useMemo(() => {
    const t = queryText.trim().toLowerCase();
    const list = t
      ? countries.filter((c) => c.name.toLowerCase().includes(t) || c.code.toLowerCase() === t)
      : countries;
    // Countries with real inventory float to the top of the full list too.
    return list
      .slice()
      .sort((a, b) => (b.channel_count ?? 0) - (a.channel_count ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [countries, queryText]);

  const pill = (isActive: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
      isActive
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-card text-foreground border-border hover:border-primary/40'
    }`;

  return (
    <div className="mt-5" ref={wrapRef} data-testid="top-country-selector">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`${basePath}?country=all`}
          className={pill(active === 'all')}
          aria-current={active === 'all' ? 'page' : undefined}
          data-testid="country-pill-all"
        >
          <Globe className="h-3.5 w-3.5" aria-hidden />
          All Countries
        </a>

        {shortcuts.map((c) => (
          <a
            key={c.code}
            href={`${basePath}?country=${c.code}`}
            className={pill(c.code === active)}
            aria-current={c.code === active ? 'page' : undefined}
            data-testid={`country-pill-${c.code}`}
          >
            <span aria-hidden>{c.flag}</span>
            {c.name}
            {(c.channel_count ?? 0) > 0 && (
              <span className={`text-xs ${c.code === active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                {c.channel_count}
              </span>
            )}
          </a>
        ))}

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-primary/40"
            data-testid="country-more-button"
          >
            More countries
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="All countries"
              className="absolute left-0 z-30 mt-2 w-72 max-w-[85vw] rounded-lg border border-border bg-card shadow-lg"
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <input
                  autoFocus
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Search countries…"
                  aria-label="Search countries"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  data-testid="country-search-input"
                />
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {filtered.length === 0 && (
                  <p className="px-3 py-3 text-sm text-muted-foreground">No country matches that search.</p>
                )}
                {filtered.map((c) => (
                  <a
                    key={c.code}
                    href={`${basePath}?country=${c.code}`}
                    role="option"
                    aria-selected={c.code === active}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                  >
                    <span aria-hidden>{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    {(c.channel_count ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">{c.channel_count}</span>
                    )}
                    {c.code === active && <Check className="h-4 w-4 text-primary" aria-hidden />}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
