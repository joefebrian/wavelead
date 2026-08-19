// Phase 3D E2E driver — drives 100 billable sponsored impressions on the
// controlled QA campaign. Uses vitest as a script runner (single "test" that
// executes side-effecting business logic). Reports the reconciliation triplet
// exactly once. Run: `yarn vitest run tests/phase3d_driver.ts --no-coverage`.
import { describe, it, expect } from 'vitest';
import { MongoClient } from 'mongodb';
import { promotionDeliveryService } from '@/lib/services/promotion/deliveryService';
import { ledgerService } from '@/lib/services/ledger/ledgerService';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { ledgerRepo } from '@/lib/repositories/ledgerRepo';

const CAMPAIGN_ID = 'smoke-camp-m06p3';

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

describe('M06.0 Phase 3D — sandbox E2E reconciliation', () => {
  it('drives 100 billable impressions and reconciles exactly', async () => {
    const campBefore = await promotionCampaignRepo.findById(CAMPAIGN_ID);
    // eslint-disable-next-line no-console
    console.log('\n[phase3d] Starting reconciliation — status=%s budget=%s funded=%s', campBefore?.status, campBefore?.budget_total_usd_minor, campBefore?.funded_amount_usd_micros);

    const funding = (await paymentFundingOrderRepo.listForCampaign(CAMPAIGN_ID))[0];
    // eslint-disable-next-line no-console
    console.log('[phase3d] funding.id=%s status=%s provider_order_id=%s captured_minor=%s', funding?.id, funding?.status, funding?.provider_order_id, funding?.amount_captured_minor);

    const b0 = await ledgerService.campaignBalances(CAMPAIGN_ID);
    // eslint-disable-next-line no-console
    console.log('[phase3d] Pre-imp balances funded=%s spent=%s refunded=%s remaining=%s', b0.funded_usd_micros, b0.spent_usd_micros, b0.refunded_usd_micros, b0.remaining_usd_micros);
    expect(b0.funded_usd_micros).toBe(20_000_000);
    expect(b0.spent_usd_micros).toBe(0);

    let recorded = 0, capped = 0, other = 0;
    for (let i = 0; i < 100; i++) {
      const r = await promotionDeliveryService.acknowledgeImpression({
        campaign_id: CAMPAIGN_ID,
        placement: 'sponsored_search',
        anonymous_session_id: `p3d-e2e-${i}`,        // fresh session → bypass freq cap
        impression_event_id: `imp-p3d-e2e-${CAMPAIGN_ID}-${i}`,
      });
      if (r.recorded) recorded++;
      else if (r.reason === 'frequency_capped') capped++;
      else other++;
    }
    // eslint-disable-next-line no-console
    console.log('[phase3d] Imp acks: recorded=%s capped=%s other=%s', recorded, capped, other);
    expect(recorded).toBe(100);

    const b = await ledgerService.campaignBalances(CAMPAIGN_ID);
    // eslint-disable-next-line no-console
    console.log('[phase3d] Final balances funded=%s spent=%s refunded=%s remaining=%s',
      b.funded_usd_micros, b.spent_usd_micros, b.refunded_usd_micros, b.remaining_usd_micros);

    // Exact protocol targets.
    expect(b.funded_usd_micros).toBe(20_000_000);
    expect(b.spent_usd_micros).toBe(200_000);
    expect(b.refunded_usd_micros).toBe(0);
    expect(b.remaining_usd_micros).toBe(19_800_000);
    expect(b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros).toBe(b.remaining_usd_micros);

    // Ledger row inspection.
    const rows = await ledgerRepo.listForCampaign(CAMPAIGN_ID);
    const funding_rows = rows.filter((r) => r.transaction_type === 'funding_credit');
    const spend_rows = rows.filter((r) => r.transaction_type === 'spend_debit');
    // eslint-disable-next-line no-console
    console.log('[phase3d] Ledger rows total=%s funding=%s spend=%s refund=%s', rows.length, funding_rows.length, spend_rows.length, rows.length - funding_rows.length - spend_rows.length);
    expect(funding_rows.length).toBe(1);
    expect(spend_rows.length).toBe(100);
    // Each row must balance.
    for (const t of rows) {
      const dr = t.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
      const cr = t.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
      expect(dr).toBe(cr);
    }
    // Integrity checker.
    const issues = await ledgerService.checkIntegrity({ campaign_id: CAMPAIGN_ID });
    // eslint-disable-next-line no-console
    console.log('[phase3d] Integrity issues=%s %s', issues.length, JSON.stringify(issues));
    expect(issues.length).toBe(0);

    // Campaign lifecycle.
    const camp = await promotionCampaignRepo.findById(CAMPAIGN_ID);
    // eslint-disable-next-line no-console
    console.log('[phase3d] Campaign status=%s activated_at=%s delivered_impressions=%s estimated_spend_micros=%s',
      camp?.status, camp?.activated_at, camp?.delivered_impressions, (camp as unknown as { estimated_spend_usd_micros?: number })?.estimated_spend_usd_micros);
    expect(camp?.status).toBe('active');
    expect(camp?.delivered_impressions).toBe(100);

    // Also check that a webhook event was NOT required for funding to complete
    // (browser capture beat the webhook — legitimate path).
    const wh = await withDb((db) => db.collection('payment_webhook_events').find({ raw_payload: { $regex: '49G92867YW3451936' } }).toArray());
    // eslint-disable-next-line no-console
    console.log('[phase3d] Webhook events observed for this order=%s', wh.length);
  }, 60_000);
});
