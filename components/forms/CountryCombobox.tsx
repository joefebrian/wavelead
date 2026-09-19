'use client';
// M17.1 — Searchable country combobox.
//
// WHY: the canonical ISO 3166-1 dataset has 200+ entries. Rendering all of
// them in an open <select> is unusable. This control:
//   • never dumps the full list before the user types (it shows a small
//     suggested set instead),
//   • filters by country NAME and ISO alpha-2 CODE,
//   • supports full keyboard navigation (Up/Down/Enter/Escape),
//   • stores the CANONICAL alpha-2 code as its value.
//
// It reads the SAME canonical dataset created in M17 (@/lib/constants/countries).
// No second country list is introduced anywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, countryByCode, type CountryEntry } from '@/lib/constants/countries';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';

/** Small suggested set shown BEFORE the user types. Resolved from the canonical dataset. */
export const SUGGESTED_COUNTRY_CODES = ['SA', 'AE', 'EG', 'ID', 'IN', 'PK', 'NG', 'GB', 'US', 'BR'];

/** Hard cap on rendered matches — we never paint 200+ rows at once. */
export const COUNTRY_RESULT_LIMIT = 50;

export function suggestedCountries(): CountryEntry[] {
  return SUGGESTED_COUNTRY_CODES.map((c) => countryByCode(c)).filter((c): c is CountryEntry => !!c);
}

/** Name- and ISO-code search over the canonical dataset. Name matches rank first. */
export function searchCountries(query: string, limit = COUNTRY_RESULT_LIMIT): CountryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestedCountries();
  const starts: CountryEntry[] = [];
  const contains: CountryEntry[] = [];
  const byCode: CountryEntry[] = [];
  for (const c of COUNTRIES) {
    const name = c.name.toLowerCase();
    const code = c.code.toLowerCase();
    if (name.startsWith(q)) starts.push(c);
    else if (code === q || code.startsWith(q)) byCode.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  return [...starts, ...byCode, ...contains].slice(0, limit);
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  testId?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function CountryCombobox({
  value, onChange, id = 'country', testId = 'country-combobox',
  placeholder = 'Search country…', disabled, className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = countryByCode(value);
  const results = useMemo(() => searchCountries(query), [query]);
  const showingSuggestions = query.trim().length === 0;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  const pick = useCallback((c: CountryEntry) => {
    onChange(c.code);            // canonical alpha-2 code — never a display name
    setOpen(false);
    setQuery('');
  }, [onChange]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = results[active]; if (c) pick(c); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Tab') { setOpen(false); }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`} data-testid={testId}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        data-testid={`${testId}-trigger`}
      >
        <span className={selected ? '' : 'text-muted-foreground'}>
          {selected ? `${selected.flag} ${selected.name}` : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg" data-testid={`${testId}-panel`}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-autocomplete="list"
              aria-controls={`${id}-listbox`}
              className="w-full bg-transparent text-sm outline-none"
              data-testid={`${testId}-input`}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {showingSuggestions && (
            <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" data-testid={`${testId}-suggested`}>
              Suggested — type to search all countries
            </div>
          )}

          <ul id={`${id}-listbox`} role="listbox" className="max-h-64 overflow-auto py-1" data-testid={`${testId}-listbox`}>
            {results.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>No country matches “{query}”.</li>
            )}
            {results.map((c, i) => (
              <li key={c.code} role="option" aria-selected={c.code === value}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
                  data-testid={`${testId}-option-${c.code}`}
                >
                  <span>{c.flag} {c.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.code}
                    {c.code === value && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
