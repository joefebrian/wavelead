// Indonesian rupiah display helper.
//
// Use only for UI output — never store formatted strings in MongoDB or use
// the result in any arithmetic. Callers must pass integer whole rupiah.
//
// Format follows Indonesian locale convention:
//   330000    → Rp330.000
//   1650000   → Rp1.650.000
//   0         → Rp0
//   -330000   → -Rp330.000

export function formatIdr(amount_idr: number): string {
  if (!Number.isInteger(amount_idr)) {
    throw new Error('formatIdr requires an integer amount of whole rupiah');
  }
  const sign = amount_idr < 0 ? '-' : '';
  const abs = Math.abs(amount_idr).toString();
  // Insert '.' as thousands separator every 3 digits from the right.
  const withSeparators = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp${withSeparators}`;
}

export function formatUsdMicros(amount_usd_micros: number): string {
  if (!Number.isInteger(amount_usd_micros)) {
    throw new Error('formatUsdMicros requires an integer micros value');
  }
  const negative = amount_usd_micros < 0;
  const abs = Math.abs(amount_usd_micros);
  const dollars = Math.floor(abs / 1_000_000);
  const cents = Math.floor((abs % 1_000_000) / 10_000);
  return `${negative ? '-' : ''}$${dollars.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`;
}
