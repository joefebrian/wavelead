// M18.1 — FX Infinity hotfix: canonical manual rate resolution.
//
// ROOT CAUSE covered here: providerFxService divided by `rate_scale` instead of
// `10 ** rate_scale`, so the production row { rate_scaled: 18200, rate_scale: 0 }
// produced 18200 / 0 = Infinity and /admin/fx-rates rendered "1 USD = ∞ IDR".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { FundingFxRate } from '@/lib/types';
import {
  canonicalManualRate, canonicalManualRateString, formatManualRate,
  isValidManualRateRow, resolveLatestValidManualRate, FX_UNAVAILABLE_LABEL,
} from '@/lib/services/fx/manualRate';
import { providerFxService, FX_STATUS_LABELS } from '@/lib/services/fx/providerFxService';
import { convertUsdMicrosToIdr } from '@/lib/services/fx/fxConversion';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const RUN = `m181-${Date.now()}`;

function row(over: Partial<FundingFxRate> = {}): FundingFxRate {
  const now = new Date();
  return {
    id: uuidv4(), base_currency: 'USD', quote_currency: 'IDR',
    rate_scaled: 18200, rate_scale: 0, source: 'admin', active: false,
    effective_from: now, effective_until: null, note: RUN,
    created_by: 'test', created_at: now, updated_at: now, ...over,
  };
}

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db()); } finally { await client.close(); }
}

describe('M18.1 §1 canonical rule: rate_scaled / 10^rate_scale', () => {
  it('1.1 18200 scale 0 → 18,200 (was Infinity)', () => {
    expect(canonicalManualRate({ rate_scaled: 18200, rate_scale: 0 })).toBe(18200);
    expect(formatManualRate({ rate_scaled: 18200, rate_scale: 0 })).toBe('18,200');
    expect(canonicalManualRateString({ rate_scaled: 18200, rate_scale: 0 })).toBe('18200');
  });

  it('1.2 16523545 scale 3 → 16,523.545', () => {
    expect(canonicalManualRate({ rate_scaled: 16523545, rate_scale: 3 })).toBeCloseTo(16523.545, 6);
    expect(formatManualRate({ rate_scaled: 16523545, rate_scale: 3 })).toBe('16,523.545');
  });

  it('1.3 zero / negative / NaN / Infinity / non-integer are all invalid', () => {
    for (const bad of [
      { rate_scaled: 0, rate_scale: 0 },
      { rate_scaled: -18200, rate_scale: 0 },
      { rate_scaled: Number.NaN, rate_scale: 0 },
      { rate_scaled: Number.POSITIVE_INFINITY, rate_scale: 0 },
      { rate_scaled: 18200, rate_scale: Number.NaN },
      { rate_scaled: 18200, rate_scale: Number.POSITIVE_INFINITY },
      { rate_scaled: 18200, rate_scale: -1 },
      { rate_scaled: 18200.5, rate_scale: 0 },
      { rate_scaled: 18200, rate_scale: 99 },
    ]) {
      expect(canonicalManualRate(bad)).toBeNull();
      expect(isValidManualRateRow(bad)).toBe(false);
      expect(formatManualRate(bad)).toBeNull();
    }
    expect(canonicalManualRate(null)).toBeNull();
  });

  it('1.4 no displayed rate can ever be Infinity / NaN / 0', () => {
    for (const r of [{ rate_scaled: 18200, rate_scale: 0 }, { rate_scaled: 1, rate_scale: 8 }]) {
      const v = canonicalManualRate(r) as number;
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    // The buggy expression is gone from the codebase.
    expect(src('lib/services/fx/providerFxService.ts')).not.toContain('rate_scaled / manual.rate_scale');
    expect(src('lib/services/fx/providerFxService.ts')).toContain('resolveLatestValidManualRate');
    const page = src('app/admin/fx-rates/page.tsx');
    expect(page).not.toContain('formatIdr(');                 // threw on fractional rates
    expect(page).toContain('formatManualRate');
    expect(src('app/admin/fx-rates/FxProviderPanel.tsx')).toContain('Number.isFinite(rateNum) && rateNum > 0');
  });

  it('1.5 payment economics untouched: BigInt conversion still authoritative', () => {
    expect(convertUsdMicrosToIdr({ usd_micros: 1_000_000, rate_scaled: 18200, rate_scale: 0, rounding: 'ceil' }).idr_whole).toBe(18200);
    expect(convertUsdMicrosToIdr({ usd_micros: 1_000_000, rate_scaled: 16523545, rate_scale: 3, rounding: 'ceil' }).idr_whole).toBe(16524);
    expect(convertUsdMicrosToIdr({ usd_micros: 1_000_000, rate_scaled: 16523545, rate_scale: 3, rounding: 'floor' }).idr_whole).toBe(16523);
  });
});

describe('M18.1 §2 latest-valid fallback without rewriting history', () => {
  it('2.1 active + valid → active row wins', () => {
    const r = resolveLatestValidManualRate([
      row({ rate_scaled: 17000, rate_scale: 0, effective_from: new Date('2026-01-01') }),
      row({ rate_scaled: 18200, rate_scale: 0, active: true, effective_from: new Date('2026-02-01') }),
    ]);
    expect(r?.from_active).toBe(true);
    expect(r?.rate).toBe(18200);
  });

  it('2.2 active row invalid → most recent VALID historical row is used', () => {
    const r = resolveLatestValidManualRate([
      row({ rate_scaled: 16000, rate_scale: 0, effective_from: new Date('2026-01-01') }),
      row({ rate_scaled: 17500, rate_scale: 0, effective_from: new Date('2026-01-20') }),
      row({ rate_scaled: 0, rate_scale: 0, active: true, effective_from: new Date('2026-02-01') }),
    ]);
    expect(r?.from_active).toBe(false);
    expect(r?.rate).toBe(17500);          // latest valid, not the invalid active one
  });

  it('2.3 no valid row anywhere → null (caller must show the unavailable label)', () => {
    expect(resolveLatestValidManualRate([row({ rate_scaled: 0, active: true }), row({ rate_scaled: -5 })])).toBeNull();
    expect(resolveLatestValidManualRate([])).toBeNull();
    expect(FX_UNAVAILABLE_LABEL).toBe('FX Reference Unavailable');
    expect(FX_STATUS_LABELS.unavailable).toBe('FX Reference Unavailable');
  });

  it('2.4 other currency pairs are never borrowed', () => {
    expect(resolveLatestValidManualRate([row({ base_currency: 'EUR', rate_scaled: 900, active: true })], 'USD', 'IDR')).toBeNull();
  });
});

describe('M18.1 §3 providerFxService.currentReference (live DB)', () => {
  beforeAll(async () => {
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.FUNDING_FX_RATES).deleteMany({ note: RUN });
    });
  });
  afterAll(async () => {
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.FUNDING_FX_RATES).deleteMany({ note: RUN });
    });
  });

  it('3.1 manual fallback is finite, positive and labelled as manual (never PayPal)', async () => {
    const ref = await providerFxService.currentReference('USD', 'IDR');
    if (ref.rate_value !== null) {
      const n = Number(ref.rate_value);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
      expect(String(ref.rate_value)).not.toMatch(/Infinity|NaN/);
    }
    if (ref.source === 'manual_reference' && ref.rate_value !== null) {
      expect(ref.source_label).toBe('Manual Admin Reference Rate');
      expect(ref.source_label).not.toMatch(/paypal/i);
      expect(ref.note).toMatch(/NOT a PayPal rate/i);
    }
    expect(['fresh', 'expired', 'manual_fallback', 'provider_unavailable', 'unavailable']).toContain(ref.status);
  });

  it('3.2 the view never carries a non-finite rate_value shape', async () => {
    const ref = await providerFxService.currentReference('USD', 'IDR');
    expect(JSON.stringify(ref)).not.toMatch(/"rate_value":\s*(null)?\s*"?(Infinity|-Infinity|NaN)"?/);
  });
});
