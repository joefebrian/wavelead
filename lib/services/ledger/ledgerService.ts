// M06.0 Phase 3 — Double-entry ledger service.
//
// This is the single source of truth for campaign money movement. Every
// transaction is IMMUTABLE and IDEMPOTENT (unique index on idempotency_key
// dedups duplicate posts).
//
// Money units: USD micros throughout. $1.00 = 1,000,000 USD micros.
//   Payment provider quotes prices in USD minor units ($1.00 = 100 minor).
//   Conversion: minor × 10,000 = micros.
//
// Invariant per transaction: sum(debit_amounts) == sum(credit_amounts).
// Invariant per campaign:    funded − spent − refunded == remaining_balance.
import { v4 as uuidv4 } from 'uuid';
import { ledgerRepo } from '@/lib/repositories/ledgerRepo';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { LedgerTransaction, LedgerAccount, LedgerPosting, LedgerTransactionType } from '@/lib/types';

export const MICROS_PER_USD = 1_000_000;
export const MICROS_PER_MINOR = 10_000; // $0.01 minor → 10_000 micros

export function minorToMicros(minor: number): number {
  if (!Number.isInteger(minor)) throw new Error(`ledger: minor must be integer, got ${minor}`);
  return minor * MICROS_PER_MINOR;
}

function assertBalanced(postings: LedgerPosting[]): number {
  let dr = 0, cr = 0;
  for (const p of postings) {
    if (!Number.isInteger(p.amount_usd_micros) || p.amount_usd_micros < 0) {
      throw new Error(`ledger: posting amount must be non-negative integer micros; got ${p.amount_usd_micros}`);
    }
    if (p.direction === 'debit') dr += p.amount_usd_micros;
    else if (p.direction === 'credit') cr += p.amount_usd_micros;
    else throw new Error(`ledger: invalid posting direction ${p.direction}`);
  }
  if (dr !== cr) throw new Error(`ledger: unbalanced transaction (debits=${dr}, credits=${cr})`);
  return dr;
}

async function postTransaction(input: {
  transaction_type: LedgerTransactionType;
  idempotency_key: string;
  campaign_id: string;
  funding_order_id?: string | null;
  provider_event_id?: string | null;
  reference_event_id?: string | null;
  postings: LedgerPosting[];
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<{ inserted: boolean; transaction: LedgerTransaction }> {
  const amount = assertBalanced(input.postings);
  const txn: LedgerTransaction = {
    id: uuidv4(),
    transaction_type: input.transaction_type,
    idempotency_key: input.idempotency_key,
    campaign_id: input.campaign_id,
    funding_order_id: input.funding_order_id ?? null,
    provider_event_id: input.provider_event_id ?? null,
    reference_event_id: input.reference_event_id ?? null,
    postings: input.postings,
    amount_usd_micros: amount,
    metadata: input.metadata || {},
    created_at: input.now || new Date(),
  };
  const r = await ledgerRepo.insertIfAbsent(txn);
  return { inserted: r.inserted, transaction: r.inserted ? txn : (r.existing || txn) };
}

// -------- Public postings --------
export const ledgerService = {
  /** DR gateway_clearing, CR campaign_unspent_funds. */
  async postFunding(input: {
    campaign_id: string;
    funding_order_id: string;
    amount_usd_micros: number;
    provider_capture_id: string;
    now?: Date;
  }): Promise<{ inserted: boolean; transaction: LedgerTransaction }> {
    return postTransaction({
      transaction_type: 'funding_credit',
      idempotency_key: `funding:${input.funding_order_id}`,
      campaign_id: input.campaign_id,
      funding_order_id: input.funding_order_id,
      reference_event_id: input.provider_capture_id,
      postings: [
        { account: 'gateway_clearing',       direction: 'debit',  amount_usd_micros: input.amount_usd_micros },
        { account: 'campaign_unspent_funds', direction: 'credit', amount_usd_micros: input.amount_usd_micros },
      ],
      metadata: { provider_capture_id: input.provider_capture_id },
      now: input.now,
    });
  },

  /** DR campaign_unspent_funds, CR ad_delivery_revenue. */
  async postSpend(input: {
    campaign_id: string;
    impression_event_id: string;
    amount_usd_micros: number;
    placement?: string;
    channel_id?: string;
    now?: Date;
  }): Promise<{ inserted: boolean; transaction: LedgerTransaction }> {
    return postTransaction({
      transaction_type: 'spend_debit',
      idempotency_key: `spend:${input.impression_event_id}`,
      campaign_id: input.campaign_id,
      reference_event_id: input.impression_event_id,
      postings: [
        { account: 'campaign_unspent_funds', direction: 'debit',  amount_usd_micros: input.amount_usd_micros },
        { account: 'ad_delivery_revenue',    direction: 'credit', amount_usd_micros: input.amount_usd_micros },
      ],
      metadata: { placement: input.placement, channel_id: input.channel_id },
      now: input.now,
    });
  },

  /** DR campaign_unspent_funds, CR refund_payable. Funds leave the campaign. */
  async postRefund(input: {
    campaign_id: string;
    funding_order_id: string;
    refund_reference: string;
    amount_usd_micros: number;
    now?: Date;
  }): Promise<{ inserted: boolean; transaction: LedgerTransaction }> {
    return postTransaction({
      transaction_type: 'refund_debit',
      idempotency_key: `refund:${input.refund_reference}`,
      campaign_id: input.campaign_id,
      funding_order_id: input.funding_order_id,
      reference_event_id: input.refund_reference,
      postings: [
        { account: 'campaign_unspent_funds', direction: 'debit',  amount_usd_micros: input.amount_usd_micros },
        { account: 'refund_payable',         direction: 'credit', amount_usd_micros: input.amount_usd_micros },
      ],
      metadata: { refund_reference: input.refund_reference },
      now: input.now,
    });
  },

  // -------- Read-only aggregates --------
  /** Balance of a specific account for a campaign, in USD micros (signed by direction). */
  async accountBalance(campaign_id: string, account: LedgerAccount): Promise<number> {
    const rows = await ledgerRepo.listForCampaign(campaign_id);
    let bal = 0;
    for (const t of rows) {
      for (const p of t.postings) {
        if (p.account !== account) continue;
        bal += (p.direction === 'credit' ? 1 : -1) * p.amount_usd_micros;
      }
    }
    return bal;
  },

  /** Aggregated campaign balances derived from the ledger. */
  async campaignBalances(campaign_id: string): Promise<{
    funded_usd_micros: number;
    spent_usd_micros: number;
    refunded_usd_micros: number;
    remaining_usd_micros: number;
  }> {
    const rows = await ledgerRepo.listForCampaign(campaign_id);
    let funded = 0, spent = 0, refunded = 0;
    for (const t of rows) {
      if (t.transaction_type === 'funding_credit') funded += t.amount_usd_micros;
      else if (t.transaction_type === 'spend_debit') spent += t.amount_usd_micros;
      else if (t.transaction_type === 'refund_debit') refunded += t.amount_usd_micros;
    }
    const remaining = funded - spent - refunded;
    return {
      funded_usd_micros: funded,
      spent_usd_micros: spent,
      refunded_usd_micros: refunded,
      remaining_usd_micros: remaining,
    };
  },

  /** Deterministic integrity checker. Returns [] when everything reconciles. */
  async checkIntegrity(filter: { campaign_id?: string } = {}): Promise<Array<{
    kind: 'unbalanced_transaction' | 'duplicate_idempotency_key' | 'negative_remaining' | 'invalid_amount';
    detail: string;
    txn_id?: string;
  }>> {
    const rows = filter.campaign_id
      ? await ledgerRepo.listForCampaign(filter.campaign_id)
      : await ledgerRepo.list({});
    const issues: Array<{ kind: 'unbalanced_transaction' | 'duplicate_idempotency_key' | 'negative_remaining' | 'invalid_amount'; detail: string; txn_id?: string }> = [];
    const seenKeys = new Map<string, string>();
    // Per-transaction invariant + duplicate-key check.
    for (const t of rows) {
      let dr = 0, cr = 0, bad = false;
      for (const p of t.postings) {
        if (!Number.isInteger(p.amount_usd_micros) || p.amount_usd_micros < 0) {
          bad = true;
          issues.push({ kind: 'invalid_amount', detail: `txn=${t.id} amount=${p.amount_usd_micros}`, txn_id: t.id });
          continue;
        }
        if (p.direction === 'debit') dr += p.amount_usd_micros;
        else cr += p.amount_usd_micros;
      }
      if (!bad && dr !== cr) issues.push({ kind: 'unbalanced_transaction', detail: `txn=${t.id} dr=${dr} cr=${cr}`, txn_id: t.id });
      const prior = seenKeys.get(t.idempotency_key);
      if (prior) issues.push({ kind: 'duplicate_idempotency_key', detail: `key=${t.idempotency_key} txns=${prior},${t.id}`, txn_id: t.id });
      else seenKeys.set(t.idempotency_key, t.id);
    }
    // Per-campaign non-negative remaining balance.
    // OPTIMIZATION: when scanning the whole ledger, avoid re-fetching per
    // campaign (was O(N × campaigns) with a live query per campaign). Reuse
    // the already-loaded `rows` to compute balances in-memory.
    if (filter.campaign_id) {
      const b = await this.campaignBalances(filter.campaign_id);
      if (b.remaining_usd_micros < 0) issues.push({ kind: 'negative_remaining', detail: `campaign=${filter.campaign_id} remaining=${b.remaining_usd_micros}` });
    } else {
      const balByCid = new Map<string, { funded: number; spent: number; refunded: number }>();
      for (const t of rows) {
        const cur = balByCid.get(t.campaign_id) || { funded: 0, spent: 0, refunded: 0 };
        if (t.transaction_type === 'funding_credit') cur.funded += t.amount_usd_micros;
        else if (t.transaction_type === 'spend_debit') cur.spent += t.amount_usd_micros;
        else if (t.transaction_type === 'refund_debit') cur.refunded += t.amount_usd_micros;
        balByCid.set(t.campaign_id, cur);
      }
      for (const [cid, b] of balByCid) {
        const remaining = b.funded - b.spent - b.refunded;
        if (remaining < 0) issues.push({ kind: 'negative_remaining', detail: `campaign=${cid} remaining=${remaining}` });
      }
    }
    return issues;
  },

  /** Cheap integrity signal: aggregation-based, no client-side row scan.
   * Uses MongoDB `$facet` to compute all invariant checks in a single
   * round-trip and returns a count. Safe to call from a dashboard render
   * even with hundreds of thousands of rows. */
  async checkIntegrityCount(filter: { campaign_id?: string } = {}): Promise<number> {
    const c = await getCollection<LedgerTransaction>(COLLECTIONS.LEDGER_TRANSACTIONS);
    const match = filter.campaign_id ? { campaign_id: filter.campaign_id } : {};
    const pipeline = [
      { $match: match },
      {
        $facet: {
          unbalanced: [
            {
              $addFields: {
                dr: { $sum: { $map: { input: { $filter: { input: '$postings', cond: { $eq: ['$$this.direction', 'debit'] } } }, in: '$$this.amount_usd_micros' } } },
                cr: { $sum: { $map: { input: { $filter: { input: '$postings', cond: { $eq: ['$$this.direction', 'credit'] } } }, in: '$$this.amount_usd_micros' } } },
              },
            },
            { $match: { $expr: { $ne: ['$dr', '$cr'] } } },
            { $count: 'n' },
          ],
          dup_keys: [
            { $group: { _id: '$idempotency_key', n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
            { $count: 'n' },
          ],
          per_campaign: [
            { $unwind: '$postings' },
            {
              $group: {
                _id: '$campaign_id',
                funded: { $sum: { $cond: [{ $eq: ['$transaction_type', 'funding_credit'] }, '$amount_usd_micros', 0] } },
                spent: { $sum: { $cond: [{ $eq: ['$transaction_type', 'spend_debit'] }, '$amount_usd_micros', 0] } },
                refunded: { $sum: { $cond: [{ $eq: ['$transaction_type', 'refund_debit'] }, '$amount_usd_micros', 0] } },
              },
            },
            { $addFields: { remaining: { $subtract: [{ $subtract: ['$funded', '$spent'] }, '$refunded'] } } },
            { $match: { remaining: { $lt: 0 } } },
            { $count: 'n' },
          ],
        },
      },
    ];
    const [agg] = await c.aggregate(pipeline).toArray();
    const unbalanced = (agg?.unbalanced?.[0]?.n as number | undefined) ?? 0;
    const dup = (agg?.dup_keys?.[0]?.n as number | undefined) ?? 0;
    const negCamp = (agg?.per_campaign?.[0]?.n as number | undefined) ?? 0;
    return unbalanced + dup + negCamp;
  },
};
