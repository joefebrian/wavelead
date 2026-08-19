// Provider-neutral FX rate abstraction.
//
// M06.1 ships ONE implementation: `AdminManagedFxRateProvider`, backed by
// the `funding_fx_rates` collection. A future automated provider (e.g. an
// upstream market-rate feed) would implement the same interface without
// changing any caller.
//
// Contract:
//   • `getActiveRate(base, quote)` returns the currently active rate row, or
//     `null` if no rate has been configured. Callers MUST treat `null` as
//     "cannot provide an IDR equivalent — do not display, do not lock".
//   • Rates are historical records; a stale row must never be silently
//     upgraded to today's numbers. If you need today's rate, ask this
//     provider directly.
import { fundingFxRateRepo } from '@/lib/repositories/fundingFxRateRepo';
import type { FundingFxRate } from '@/lib/types';

export interface FxRateProvider {
  name: 'admin_managed' | 'automated';
  getActiveRate(base: string, quote: string): Promise<FundingFxRate | null>;
  listAll(): Promise<FundingFxRate[]>;
}

export const adminManagedFxRateProvider: FxRateProvider = {
  name: 'admin_managed',
  async getActiveRate(base, quote) { return fundingFxRateRepo.findActive(base, quote); },
  async listAll() { return fundingFxRateRepo.listAll(); },
};

/** Default provider selected by M06.1 configuration. Kept as a single import
 * point so a future implementation swap is one line of code. */
export const fxRateProvider: FxRateProvider = adminManagedFxRateProvider;
