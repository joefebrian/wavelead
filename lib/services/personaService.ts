// Phase 3 — Persona / onboarding UX service.
//
// PURE UX PREFERENCE:
//   * NEVER affects RBAC (Role / hasAtLeastRole / requireRole are untouched).
//   * NEVER affects entitlements (Plan / requireEntitlement are untouched).
//   * Existing users without a persona value continue to work — the picker is
//     dismissible and never blocks dashboard use.
import { z } from 'zod';
import { HttpError } from '../auth/rbac';
import { userRepo } from '../repositories/userRepo';
import { channelRepo } from '../repositories/channelRepo';
import { claimRepo } from '../repositories/genericRepo';
import { channelRateCardRepo, marketplaceOrderRepo, ownerPayoutMethodRepo } from '../repositories/marketplaceRepo';
import type { Actor, Channel } from '../types';

export type Persona = 'owner' | 'brand' | 'both';
export const PERSONAS: readonly Persona[] = ['owner', 'brand', 'both'] as const;

export const personaSchema = z.object({
  persona: z.enum(PERSONAS as readonly [Persona, ...Persona[]]),
});

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export interface PersonaState {
  persona: Persona | null;
  prompt_dismissed: boolean;
  should_prompt: boolean;
  owner_checklist: ChecklistItem[] | null;
  brand_checklist: ChecklistItem[] | null;
}

async function computeOwnerChecklist(actor: Actor): Promise<ChecklistItem[]> {
  const userId = actor.user.id;
  // Existing repos — server-side truth, never trust client.
  const [ownedChannels, orders, payoutMethod] = await Promise.all([
    channelRepo.list({ filter: { owner_id: userId }, limit: 50 }),
    marketplaceOrderRepo.listByOwner(userId),
    ownerPayoutMethodRepo.findActiveByOwner(userId),
  ]);

  const firstChannel: Channel | undefined = ownedChannels[0];
  const hasChannel = ownedChannels.length > 0;
  const verified = ownedChannels.some((c) => c.verification_status === 'verified' || c.verification_status === 'official');
  const profileComplete = !!firstChannel && !!firstChannel.description && !!firstChannel.logo_url;
  let hasRateCard = false;
  if (firstChannel) {
    const rc = await channelRateCardRepo.findByChannel(firstChannel.id);
    hasRateCard = !!(rc && Array.isArray(rc.packages) && rc.packages.length > 0);
  }
  const hasPayout = !!payoutMethod;
  const hasOrders = orders.length > 0;

  const chanSlug = firstChannel?.slug;
  const monetHref = chanSlug ? `/dashboard/channels/${chanSlug}/monetization` : '/dashboard/channels';

  return [
    { key: 'add_channel',         label: 'Add or claim your channel',           done: hasChannel,      href: hasChannel ? '/dashboard/channels' : '/submit' },
    { key: 'verify_ownership',    label: 'Verify ownership',                    done: verified,        href: '/dashboard/claims' },
    { key: 'complete_profile',    label: 'Complete channel profile',            done: profileComplete, href: chanSlug ? `/dashboard/channels/${chanSlug}` : '/dashboard/channels' },
    { key: 'create_package',      label: 'Create your first sponsorship package', done: hasRateCard,   href: monetHref },
    { key: 'payout_details',      label: 'Set payout details',                  done: hasPayout,       href: '/dashboard/earnings' },
    { key: 'review_opportunities',label: 'Review sponsorship opportunities',    done: hasOrders,       href: '/dashboard/sponsorships/pipeline' },
  ];
}

async function computeBrandChecklist(actor: Actor): Promise<ChecklistItem[]> {
  const userId = actor.user.id;
  const orders = await marketplaceOrderRepo.listByBuyer(userId);
  const profileComplete = !!actor.user.display_name && !!actor.user.email;
  const hasBooked = orders.length > 0;
  const hasCompleted = orders.some((o) => o.status === 'completed');
  return [
    { key: 'complete_profile', label: 'Complete account profile',   done: profileComplete, href: '/dashboard' },
    { key: 'discover',         label: 'Discover a channel',         done: hasBooked,       href: '/channels' },
    { key: 'review_packages',  label: 'Review sponsorship packages',done: hasBooked,       href: '/channels' },
    { key: 'first_sponsorship',label: 'Book your first sponsorship',done: hasBooked,       href: '/channels' },
    { key: 'track_delivery',   label: 'Track delivery',             done: hasCompleted,    href: '/dashboard/sponsorships' },
  ];
}

export const personaService = {
  /**
   * Read the current persona state for the actor and (when persona is set)
   * compute the relevant checklists using ONLY existing repos.
   */
  async getState(actor: Actor | null): Promise<PersonaState> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const rawPersona = (actor.user as { persona?: unknown }).persona;
    const persona: Persona | null = (rawPersona === 'owner' || rawPersona === 'brand' || rawPersona === 'both') ? rawPersona : null;
    const dismissedAt = (actor.user as { persona_prompt_dismissed_at?: Date | string | null }).persona_prompt_dismissed_at;
    const prompt_dismissed = !!dismissedAt;
    const should_prompt = persona === null && !prompt_dismissed;

    let ownerChecklist: ChecklistItem[] | null = null;
    let brandChecklist: ChecklistItem[] | null = null;
    if (persona === 'owner' || persona === 'both') ownerChecklist = await computeOwnerChecklist(actor);
    if (persona === 'brand' || persona === 'both') brandChecklist = await computeBrandChecklist(actor);

    return { persona, prompt_dismissed, should_prompt, owner_checklist: ownerChecklist, brand_checklist: brandChecklist };
  },

  /** Set the persona preference. Never changes user.role. */
  async setPersona(actor: Actor | null, input: unknown): Promise<PersonaState> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const parsed = personaSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid persona: ${parsed.error.issues[0]?.message || 'invalid'}`);
    await userRepo.updateFields(actor.user.id, {
      // Explicitly do NOT touch `role`, `plan`, `is_disabled`, or any RBAC field.
      persona: parsed.data.persona,
      persona_prompt_dismissed_at: new Date(),
      updated_at: new Date(),
    });
    // Rehydrate with the updated user so checklists reflect the new persona.
    const refreshed = await userRepo.findById(actor.user.id);
    const nextActor: Actor = { session: actor.session, user: refreshed as Actor['user'] };
    return this.getState(nextActor);
  },

  /**
   * Dismiss the persona prompt without setting a persona. Existing production
   * users hitting the dashboard for the first time can skip the picker.
   */
  async dismissPrompt(actor: Actor | null): Promise<{ ok: true; prompt_dismissed: true }> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    await userRepo.updateFields(actor.user.id, {
      persona_prompt_dismissed_at: new Date(),
      updated_at: new Date(),
    });
    return { ok: true, prompt_dismissed: true };
  },
};
