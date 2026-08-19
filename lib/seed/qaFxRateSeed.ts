// PREVIEW-ONLY QA FX rate fixture.
// Idempotently ensures that USD → IDR has an active admin-managed rate for
// deterministic testing. This mirrors the QA persona bootstrap safety model:
//   • disabled when NODE_ENV === 'production'
//   • disabled unless QA_SEED_ENABLED === 'true'
//   • deterministic value: 1 USD = 16,500 IDR (rate_scaled=16500, rate_scale=0)
//   • never overrides an existing active rate; only seeds when NONE is active
import { v4 as uuidv4 } from 'uuid';
import { fundingFxRateRepo } from '@/lib/repositories/fundingFxRateRepo';
import type { FundingFxRate } from '@/lib/types';

export async function seedQaFxRateIfEnabled(): Promise<{ seeded: boolean; reason?: string; row?: FundingFxRate }> {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return { seeded: false, reason: 'production_disabled' };
  if ((process.env.QA_SEED_ENABLED || '').toLowerCase() !== 'true') return { seeded: false, reason: 'qa_seed_env_flag_off' };
  const existing = await fundingFxRateRepo.findActive('USD', 'IDR');
  if (existing) return { seeded: false, reason: 'already_active', row: existing };
  const now = new Date();
  const row: FundingFxRate = {
    id: uuidv4(),
    base_currency: 'USD',
    quote_currency: 'IDR',
    rate_scaled: 16500,
    rate_scale: 0,
    source: 'admin',
    active: true,
    effective_from: now,
    effective_until: null,
    note: 'QA fixture — 1 USD = IDR 16,500',
    created_by: 'qa-seed',
    created_at: now,
    updated_at: now,
  };
  await fundingFxRateRepo.activate(row);
  return { seeded: true, row };
}
