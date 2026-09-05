// M11 — Super Admin Verified Owner Activation reporting (READ-ONLY) tests.
// Validates channelActivationService.adminListActivations against the existing
// preview DB: RBAC, response shape, summary aggregation math, masking, and
// domain isolation (no marketplace fields). Purely read-only — never touches
// PayPal or /start.
import { describe, it, expect } from 'vitest';
import { channelActivationService } from '@/lib/services/channelActivationService';
import type { Actor } from '@/lib/types';

function actorFor(role: 'user' | 'moderator' | 'admin' | 'super_admin'): Actor {
  const id = `m11-report-${role}`;
  return { session: { userId: id, email: `${id}@t.test`, v: 0 }, user: { id, email: `${id}@t.test`, role, display_name: id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}

describe('adminListActivations (read-only report)', () => {
  it('rejects anonymous and non-admin actors', async () => {
    await expect(channelActivationService.adminListActivations(null)).rejects.toThrow();
    await expect(channelActivationService.adminListActivations(actorFor('user'))).rejects.toThrow();
  });

  it('returns items + summary for admin with correct aggregation & masking', async () => {
    const report = await channelActivationService.adminListActivations(actorFor('super_admin'));
    expect(report).toBeTruthy();
    expect(Array.isArray(report.items)).toBe(true);
    expect(report.summary).toBeTruthy();
    expect(report.summary.currency).toBe('USD');
    expect(report.summary.total_payments).toBe(report.items.length);

    // Recompute aggregates from items and compare to summary.
    let gross = 0, fees = 0, net = 0, credit = 0, active = 0, refunded = 0;
    for (const r of report.items as Array<Record<string, unknown>>) {
      gross += (r.amount_captured_minor as number) || 0;
      fees += (r.provider_fee_minor as number) || 0;
      net += (r.provider_net_minor as number) || 0;
      credit += (r.wavelead_credit_minor as number) || 0;
      if (r.status === 'captured_finalized') active += 1;
      if (r.status === 'refunded' || r.status === 'partially_refunded' || ((r.amount_refunded_minor as number) || 0) > 0) refunded += 1;

      // Masking: capture/order refs must not equal raw (should be masked or null).
      const cap = r.provider_capture_id_masked as string | null;
      if (cap) expect(cap).toMatch(/[•]/);
      const owner = r.owner_masked as string | null;
      if (owner) expect(owner).toMatch(/[•]/);

      // Domain isolation: must NOT carry marketplace/promote keys.
      expect(r).not.toHaveProperty('campaign_id');
      expect(r).not.toHaveProperty('funding_order_id');
      expect(r).not.toHaveProperty('order_id');
      // Provider raw fields must not leak.
      expect(r).not.toHaveProperty('provider_order_id');
      expect(r).not.toHaveProperty('provider_capture_id');
    }
    expect(report.summary.gross_captured_minor).toBe(gross);
    expect(report.summary.gateway_fees_minor).toBe(fees);
    expect(report.summary.provider_net_minor).toBe(net);
    expect(report.summary.wavelead_credit_issued_minor).toBe(credit);
    expect(report.summary.active_activations).toBe(active);
    expect(report.summary.refunded_or_reversed).toBe(refunded);
  });
});
