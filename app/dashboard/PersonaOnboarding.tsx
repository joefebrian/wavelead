'use client';

// Phase 3 — Persona onboarding UX.
// Dismissible, non-blocking. Never touches RBAC or entitlements — pure
// preference. Existing users without a persona see this card ONCE; skipping
// or choosing persists a dismissal timestamp so the dashboard stays out of
// their way going forward.
import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, Circle, Loader2, AlertTriangle, Users, Megaphone, Wallet, Handshake, Kanban, ShieldCheck, Sparkles,
} from 'lucide-react';

type Persona = 'owner' | 'brand' | 'both';
interface ChecklistItem { key: string; label: string; done: boolean; href: string; }
interface State {
  persona: Persona | null;
  prompt_dismissed: boolean;
  should_prompt: boolean;
  owner_checklist: ChecklistItem[] | null;
  brand_checklist: ChecklistItem[] | null;
}

export default function PersonaOnboarding({ initial }: { initial: State }) {
  const [state, setState] = useState<State>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'owner' | 'brand'>(initial.persona === 'brand' ? 'brand' : 'owner');

  async function choose(p: Persona) {
    setBusy(p); setError(null);
    try {
      const r = await fetch('/api/me/persona', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ persona: p }),
      });
      const j = await r.json() as { ok?: boolean; data?: State; error?: string };
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to save preference');
      if (j.data) setState(j.data);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function dismiss() {
    setBusy('dismiss'); setError(null);
    try {
      const r = await fetch('/api/me/persona/dismiss', { method: 'POST', credentials: 'include' });
      const j = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      setState((s) => ({ ...s, prompt_dismissed: true, should_prompt: false }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  // 1) Prompt when the user has no persona and hasn't dismissed.
  if (state.should_prompt) {
    return (
      <section
        className="mt-6 wh-card p-6 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent"
        data-testid="persona-picker"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2"><Sparkles className="h-5 w-5 text-primary" /></div>
          <div>
            <h2 className="text-lg font-semibold">What do you want to do with WaveLead?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick a workspace to prioritize. You can change this later — it&apos;s a UX preference, not a role.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <PersonaButton
            testid="persona-choose-owner" icon={<Megaphone className="h-4 w-4" />}
            title="Grow & monetize my channel" desc="Claim, verify, and earn sponsorship revenue."
            onClick={() => choose('owner')} busy={busy === 'owner'}
          />
          <PersonaButton
            testid="persona-choose-brand" icon={<Handshake className="h-4 w-4" />}
            title="Find & sponsor channels" desc="Discover WhatsApp Channels and book sponsorships."
            onClick={() => choose('brand')} busy={busy === 'brand'}
          />
          <PersonaButton
            testid="persona-choose-both" icon={<Users className="h-4 w-4" />}
            title="Both" desc="One account, quick switch between workspaces."
            onClick={() => choose('both')} busy={busy === 'both'}
          />
        </div>
        {error && <div className="mt-3 text-sm text-rose-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{error}</div>}
        <div className="mt-3 text-right">
          <button
            type="button" onClick={dismiss} disabled={busy === 'dismiss'}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            data-testid="persona-skip"
          >
            {busy === 'dismiss' ? 'Skipping…' : 'Skip for now'}
          </button>
        </div>
      </section>
    );
  }

  // 2) If persona is set, show the checklist(s) + optional view switcher.
  if (state.persona) {
    const showOwner = state.persona === 'owner' || (state.persona === 'both' && view === 'owner');
    const showBrand = state.persona === 'brand' || (state.persona === 'both' && view === 'brand');
    return (
      <div className="mt-6 space-y-4" data-testid="persona-checklist-wrap">
        {state.persona === 'both' && (
          <div className="flex items-center gap-2" data-testid="persona-view-switch">
            <Button
              size="sm" variant={view === 'owner' ? 'default' : 'outline'}
              onClick={() => setView('owner')}
              data-testid="persona-view-owner"
              className="gap-1.5"
            >
              <Megaphone className="h-4 w-4" /> Channel Owner
            </Button>
            <Button
              size="sm" variant={view === 'brand' ? 'default' : 'outline'}
              onClick={() => setView('brand')}
              data-testid="persona-view-brand"
              className="gap-1.5"
            >
              <Handshake className="h-4 w-4" /> Brand / Sponsor
            </Button>
          </div>
        )}
        {showOwner && state.owner_checklist && (
          <Checklist
            testid="owner-checklist"
            title="Get set up as a channel owner"
            badge="Owner"
            icon={<Megaphone className="h-4 w-4" />}
            items={state.owner_checklist}
          />
        )}
        {showBrand && state.brand_checklist && (
          <Checklist
            testid="brand-checklist"
            title="Start sponsoring channels"
            badge="Brand"
            icon={<Handshake className="h-4 w-4" />}
            items={state.brand_checklist}
          />
        )}
      </div>
    );
  }

  // 3) Prompt dismissed with no persona — silent (no card).
  return null;
}

function PersonaButton({ icon, title, desc, onClick, busy, testid }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; busy: boolean; testid: string }) {
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      className="text-left rounded-lg border border-border p-4 hover:border-primary/60 hover:bg-primary/5 transition disabled:opacity-60"
      data-testid={testid}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

function Checklist({ title, badge, icon, items, testid }: { title: string; badge: string; icon: React.ReactNode; items: ChecklistItem[]; testid: string }) {
  const doneCount = items.filter((i) => i.done).length;
  return (
    <section className="wh-card p-5" data-testid={testid}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold">{title}</h3>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{badge}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{doneCount} / {items.length} done</div>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-3 text-sm">
            {it.done
              ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
            <Link href={it.href} className={`flex-1 ${it.done ? 'text-muted-foreground line-through' : 'text-foreground hover:text-primary'}`} data-testid={`checklist-item-${it.key}`}>
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Icons re-exported for consumers that want to keep a consistent lucide set.
export const PersonaIcons = { Kanban, ShieldCheck, Wallet, Megaphone, Handshake };
