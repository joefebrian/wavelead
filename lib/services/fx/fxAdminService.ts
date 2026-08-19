// Admin-only orchestration for FX rate management.
// Server-side authority — clients cannot submit rate values.
import { v4 as uuidv4 } from 'uuid';
import { fundingFxRateRepo } from '@/lib/repositories/fundingFxRateRepo';
import { auditRepo } from '@/lib/repositories/genericRepo';
import type { FundingFxRate, Actor } from '@/lib/types';
import { HttpError } from '@/lib/auth/rbac';

export const fxAdminService = {
  async list(): Promise<FundingFxRate[]> { return fundingFxRateRepo.listAll(); },

  async getActive(base: string, quote: string): Promise<FundingFxRate | null> {
    return fundingFxRateRepo.findActive(base, quote);
  },

  async createAndActivate(actor: Actor, input: { base_currency: string; quote_currency: string; rate_scaled: number; rate_scale: number; note?: string }): Promise<FundingFxRate> {
    if (input.base_currency !== 'USD' || input.quote_currency !== 'IDR') {
      throw new HttpError(400, 'Only USD → IDR is supported in M06.1');
    }
    if (!Number.isInteger(input.rate_scaled) || input.rate_scaled <= 0) throw new HttpError(400, 'rate_scaled must be a positive integer');
    if (!Number.isInteger(input.rate_scale) || input.rate_scale < 0 || input.rate_scale > 8) throw new HttpError(400, 'rate_scale must be an integer 0..8');
    const now = new Date();
    const row: FundingFxRate = {
      id: uuidv4(),
      base_currency: input.base_currency,
      quote_currency: input.quote_currency,
      rate_scaled: input.rate_scaled,
      rate_scale: input.rate_scale,
      source: 'admin',
      active: true,
      effective_from: now,
      effective_until: null,
      note: input.note ?? null,
      created_by: actor.user.id,
      created_at: now,
      updated_at: now,
    };
    await fundingFxRateRepo.activate(row);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor.user.id,
      action: 'FX_RATE_ACTIVATED',
      entity_type: 'funding_fx_rate',
      entity_id: row.id,
      before_data: null,
      after_data: { base: row.base_currency, quote: row.quote_currency, rate_scaled: row.rate_scaled, rate_scale: row.rate_scale },
      created_at: new Date(),
    });
    return row;
  },

  async deactivate(actor: Actor, id: string): Promise<void> {
    const existing = await fundingFxRateRepo.findById(id);
    if (!existing) throw new HttpError(404, 'Rate not found');
    if (!existing.active) return; // idempotent
    await fundingFxRateRepo.deactivate(id);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor.user.id,
      action: 'FX_RATE_DEACTIVATED',
      entity_type: 'funding_fx_rate',
      entity_id: id,
      before_data: null,
      after_data: null,
      created_at: new Date(),
    });
  },
};
