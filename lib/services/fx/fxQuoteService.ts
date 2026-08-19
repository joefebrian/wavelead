// USD/IDR checkout quote service.
//
// A quote is a locked snapshot of (rate, campaign_usd_micros, quoted_idr) at
// the moment the owner previews a hypothetical IDR checkout. In M06.1 no
// local payment provider is wired up yet, so the quote is used only for
//   • IDR equivalent display
//   • future local-payment readiness
//   • QA verification
// It does NOT create payment authority, does NOT fund campaigns, and does
// NOT activate campaigns.
//
// Immutability: rate/campaign/idr fields are frozen at `locked_at`. Only
// `status` transitions via the controlled machine open → expired / consumed.
import { v4 as uuidv4 } from 'uuid';
import { fundingFxQuoteRepo } from '@/lib/repositories/fundingFxQuoteRepo';
import { fxRateProvider } from './fxRateProvider';
import { convertUsdMicrosToIdr } from './fxConversion';
import type { FundingFxQuote } from '@/lib/types';
import { HttpError } from '@/lib/auth/rbac';

export const DEFAULT_QUOTE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const fxQuoteService = {
  /** Preview conversion without persisting a quote — pure computation. */
  async previewIdrForCampaign(campaign_usd_micros: number): Promise<{ idr_whole: number; rate: { rate_scaled: number; rate_scale: number; source_rate_id: string } } | null> {
    const rate = await fxRateProvider.getActiveRate('USD', 'IDR');
    if (!rate) return null;
    const { idr_whole } = convertUsdMicrosToIdr({
      usd_micros: campaign_usd_micros,
      rate_scaled: rate.rate_scaled,
      rate_scale: rate.rate_scale,
      rounding: 'ceil',
    });
    return { idr_whole, rate: { rate_scaled: rate.rate_scaled, rate_scale: rate.rate_scale, source_rate_id: rate.id } };
  },

  /** Create + persist an immutable locked quote for a specific campaign. */
  async lockQuoteForCampaign(campaign_id: string, campaign_usd_micros: number, ttl_ms: number = DEFAULT_QUOTE_TTL_MS): Promise<FundingFxQuote> {
    const rate = await fxRateProvider.getActiveRate('USD', 'IDR');
    if (!rate) throw new HttpError(409, 'No active USD/IDR conversion rate configured');
    const { idr_whole } = convertUsdMicrosToIdr({
      usd_micros: campaign_usd_micros,
      rate_scaled: rate.rate_scaled,
      rate_scale: rate.rate_scale,
      rounding: 'ceil',
    });
    const now = new Date();
    const row: FundingFxQuote = {
      id: uuidv4(),
      campaign_id,
      funding_order_id: null,
      base_currency: 'USD',
      quote_currency: 'IDR',
      campaign_usd_micros,
      rate_scaled: rate.rate_scaled,
      rate_scale: rate.rate_scale,
      quoted_idr_amount: idr_whole,
      source_rate_id: rate.id,
      locked_at: now,
      expires_at: new Date(now.getTime() + ttl_ms),
      status: 'open',
    };
    await fundingFxQuoteRepo.insert(row);
    return row;
  },

  isExpired(q: FundingFxQuote, now: Date = new Date()): boolean {
    return q.expires_at.getTime() <= now.getTime();
  },

  /** Sweep helper: mark a quote as expired if past its window and still `open`. */
  async expireIfDue(id: string): Promise<boolean> {
    const q = await fundingFxQuoteRepo.findById(id);
    if (!q) return false;
    if (q.status !== 'open') return false;
    if (!this.isExpired(q)) return false;
    return fundingFxQuoteRepo.transitionStatus(id, 'open', 'expired');
  },
};
