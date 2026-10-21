/**
 * P0B PRE-DEPLOY PRODUCTION BASELINE (read-only).
 *
 * Captured from the LIVE production public API before the P0B deployment.
 * It deliberately records ONLY what production genuinely exposes read-only.
 * The canonical bucket-level snapshot (claimable / linked-unverified /
 * verified / needs-review) CANNOT be captured before this release, because
 * the metrics + snapshot endpoints ship WITH it. That gap is reported, never
 * invented or back-filled.
 */
const PROD = process.env.PROD_URL || 'https://grow-infrastructure.emergent.host';
const PAGE = 60;

async function j(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

(async () => {
  const captured_at = new Date().toISOString();
  const health = await j(`${PROD}/api/health`);

  const first = await j(`${PROD}/api/channels?limit=1`);
  const total = first.data.total;

  let scanned = 0;
  const verified = [];
  const countries = {};
  for (let skip = 0; skip < total + PAGE; skip += PAGE) {
    const page = await j(`${PROD}/api/channels?limit=${PAGE}&skip=${skip}`);
    const items = page.data.items || [];
    if (items.length === 0) break;
    scanned += items.length;
    for (const it of items) {
      if (it.is_verified) verified.push(it.slug);
      countries[it.country_code || 'unknown'] = (countries[it.country_code || 'unknown'] || 0) + 1;
    }
    if (scanned >= total) break;
  }

  // Public ownership-CTA distribution across a spread sample. This is a
  // SAMPLE, not a count, and is labelled as such.
  const sampleSlugs = [];
  for (const skip of [0, 200, 400, 600, 800]) {
    const page = await j(`${PROD}/api/channels?limit=${PAGE}&skip=${skip}`);
    (page.data.items || []).filter((_, i) => i % 12 === 0).forEach((i) => sampleSlugs.push(i.slug));
  }
  const cta = {};
  for (const s of sampleSlugs) {
    const html = await (await fetch(`${PROD}/channel/${s}`)).text();
    const m = html.match(/ownership-cta-[a-z-]+/);
    const key = m ? m[0] : 'none';
    cta[key] = (cta[key] || 0) + 1;
  }

  console.log(JSON.stringify({
    phase: process.env.SNAP_PHASE || 'pre_deploy',
    source: 'production public API (read-only)',
    captured_at,
    environment: health.data.env,
    deployed_commit_reported_by_app: health.data.commit,
    deployed_version_reported_by_app: health.data.version,
    public_approved_total: total,
    channels_scanned: scanned,
    verified_public_count: verified.length,
    verified_public_slugs: verified,
    top_countries: Object.fromEntries(Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 5)),
    ownership_cta_sample: { sample_size: sampleSlugs.length, distribution: cta },
    canonical_bucket_snapshot: null,
    canonical_bucket_snapshot_note:
      'NOT AVAILABLE pre-deploy: the claim-path metrics and inventory snapshot endpoints ship WITH this release. No baseline was fabricated.',
  }, null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
