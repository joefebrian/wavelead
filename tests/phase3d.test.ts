// M06.0 CANONICAL FIXTURE — post-refund ledger identity.
//
// After the controlled Phase 3D + 4 sandbox flow (real PayPal partial refund),
// the fixture campaign's ledger MUST hold this identity forever:
//
//   funded    = 20,000,000 micros ($20.00)
//   spent     =    200,000 micros ($0.20 — 100 impressions × $2 CPM)
//   refunded  = 19,800,000 micros ($19.80 sandbox partial refund)
//   remaining =          0 micros
//
// Note: the promotion_campaigns / payment_funding_orders rows are wiped by
// M05.1 test setup. The ledger transactions are IMMUTABLE and are the true
// source of truth for M06.0's exact-integer money identity.
import { describe, it, expect } from 'vitest';
import { ledgerService } from '@/lib/services/ledger/ledgerService';
import { ledgerRepo } from '@/lib/repositories/ledgerRepo';

const CAMPAIGN_ID = 'smoke-camp-m06p3';

describe('M06.0 canonical fixture — post-refund ledger identity', () => {
  it('holds exactly 20,000,000 − 200,000 − 19,800,000 = 0 micros', async () => {
    const b = await ledgerService.campaignBalances(CAMPAIGN_ID);
    expect(b.funded_usd_micros).toBe(20_000_000);
    expect(b.spent_usd_micros).toBe(200_000);
    expect(b.refunded_usd_micros).toBe(19_800_000);
    expect(b.remaining_usd_micros).toBe(0);
    // Exact integer identity — never floating point.
    expect(b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros)
      .toBe(b.remaining_usd_micros);
  });

  it('ledger has exactly 1 funding, 100 spend, 1 refund transaction', async () => {
    const rows = await ledgerRepo.listForCampaign(CAMPAIGN_ID);
    const funding_rows = rows.filter((r) => r.transaction_type === 'funding_credit');
    const spend_rows = rows.filter((r) => r.transaction_type === 'spend_debit');
    const refund_rows = rows.filter((r) => r.transaction_type === 'refund_debit');
    expect(funding_rows.length).toBe(1);
    expect(spend_rows.length).toBe(100);
    expect(refund_rows.length).toBe(1);
  });

  it('every ledger transaction is double-entry balanced (debits == credits)', async () => {
    const rows = await ledgerRepo.listForCampaign(CAMPAIGN_ID);
    for (const t of rows) {
      const dr = t.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
      const cr = t.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
      expect(dr).toBe(cr);
    }
  });

  it('integrity checker returns 0 issues for the canonical fixture', async () => {
    const issues = await ledgerService.checkIntegrity({ campaign_id: CAMPAIGN_ID });
    expect(issues.length).toBe(0);
  });

  it('idempotency keys are unique across all ledger rows', async () => {
    const rows = await ledgerRepo.listForCampaign(CAMPAIGN_ID);
    const keys = rows.map((r) => r.idempotency_key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
