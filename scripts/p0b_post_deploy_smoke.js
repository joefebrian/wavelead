/**
 * P0B POST-DEPLOY PRODUCTION SMOKE (read-only, unauthenticated).
 *
 * Verifies only what can be proven WITHOUT privileged credentials:
 *   • the P0B build actually landed (trimmed public health)
 *   • existing public inventory is still discoverable and unchanged
 *   • every new admin surface denies anonymous access without leaking data
 *   • P0A ownership protections and claim messaging are still intact
 *   • no 5xx anywhere
 * Admin-gated checks (build diagnostics, real metrics, review queue) need
 * production operator credentials and are reported as NOT VERIFIED here —
 * never assumed, never fabricated.
 */
const PROD = process.env.PROD_URL || 'https://grow-infrastructure.emergent.host';
const BASELINE = require('../memory/p0b_pre_deploy_baseline.json');

let pass = 0, fail = 0, unverified = 0;
const lines = [];
function record(status, name, evidence) {
  if (status === 'PASS') pass++; else if (status === 'FAIL') fail++; else unverified++;
  lines.push(`  ${status.padEnd(13)} ${name}${evidence ? ` :: ${evidence}` : ''}`);
}
const check = (name, cond, evidence) => record(cond ? 'PASS' : 'FAIL', name, evidence);

async function get(path) {
  const r = await fetch(`${PROD}${path}`, { redirect: 'manual' });
  const text = await r.text();
  return { status: r.status, text, loc: r.headers.get('location') };
}

(async () => {
  console.log(`\nP0B POST-DEPLOY SMOKE — ${PROD}\nstarted ${new Date().toISOString()}\n`);
  const codes = [];

  // 1. Build landed: public health must be TRIMMED.
  const h = await get('/api/health');
  codes.push(h.status);
  let hj = {}; try { hj = JSON.parse(h.text); } catch { /* */ }
  const d = hj.data || {};
  check('public /api/health returns 200', h.status === 200, String(h.status));
  check('health exposes ONLY status/service/time/env',
    Object.keys(d).sort().join(',') === 'env,service,status,time', Object.keys(d).join(','));
  check('health no longer leaks commit/version/branch',
    d.version === undefined && d.commit === undefined && d.branch === undefined && d.commitTime === undefined);
  check('environment is production', d.env === 'production', String(d.env));

  // 2. Existing public inventory still discoverable and unchanged.
  const list = await get('/api/channels?limit=1');
  codes.push(list.status);
  const total = JSON.parse(list.text).data.total;
  check('public channel API responds', list.status === 200, String(list.status));
  check(`public approved total unchanged vs baseline (${BASELINE.public_approved_total})`,
    total === BASELINE.public_approved_total, `now=${total}`);

  const dir = await get('/channels');
  codes.push(dir.status);
  check('public directory page loads', dir.status === 200 && dir.text.length > 50000,
    `${dir.status}, ${dir.text.length} bytes`);

  // Verified channels still verified, still correctly claim-restricted (P0A intact).
  let verifiedOk = true, badgeOk = true;
  for (const slug of BASELINE.verified_public_slugs) {
    const page = await get(`/channel/${slug}`);
    const claim = await get(`/claim/${slug}`);
    codes.push(page.status, claim.status);
    if (page.status !== 200 || !/owner-verified-badge/.test(page.text)) badgeOk = false;
    if (!/claim-state-verified-owner/.test(claim.text)) verifiedOk = false;
  }
  check('all baseline verified channels still show the verified badge', badgeOk);
  check('verified channels still restrict claiming (P0A intact)', verifiedOk);

  // Linked-but-unverified must still NOT claim a verified owner (the original P0 defect).
  const sample = ['deccan-herald', 'ap-news', 'base-infra'];
  let honest = true, leak = false;
  for (const slug of sample) {
    const claim = await get(`/claim/${slug}`);
    codes.push(claim.status);
    if (!/claim-state-linked-unverified/.test(claim.text)) honest = false;
    if (/already has a Verified Owner/i.test(claim.text)) honest = false;
    const emails = (claim.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
      .filter((e) => !/support@p2plabs\.asia/i.test(e));
    const uuids = claim.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
    if (emails.length || uuids.length || /capture_id|provider_order_id/.test(claim.text)) leak = true;
  }
  check('linked-but-unverified never claims a Verified Owner', honest);
  check('no owner identity or payment data in claim responses', !leak);

  // 3. New admin surfaces must deny anonymous access without leaking.
  const guarded = [
    '/admin/operations',
    '/api/admin/operations/metrics',
    '/api/admin/operations/release-candidates',
    '/api/admin/operations/sourcing-agents',
    '/api/admin/operations/sourcing-daily',
    '/api/admin/operations/snapshots',
    '/api/admin/diagnostics/build',
  ];
  for (const path of guarded) {
    const r = await get(path);
    codes.push(r.status);
    const denied = [301, 302, 307, 308, 401, 403, 404].includes(r.status);
    const leaked = /public_approved_total|linked_unverified|sourced_by_user_id|BUILD_COMMIT|commit_short|mongodb:\/\//.test(r.text);
    check(`anonymous denied on ${path}`, denied && !leaked, `status=${r.status}${leaked ? ' LEAKED DATA' : ''}`);
  }
  // Write surfaces must not be reachable anonymously either.
  for (const path of ['/api/admin/operations/sourcing-agents', '/api/admin/operations/snapshots']) {
    const r = await fetch(`${PROD}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual',
    });
    codes.push(r.status);
    check(`anonymous POST denied on ${path}`, ![200, 201].includes(r.status), `status=${r.status}`);
  }

  // 4. No 5xx anywhere.
  const server5xx = codes.filter((c) => c >= 500);
  check('no 5xx across all smoke requests', server5xx.length === 0,
    `requests=${codes.length}, 5xx=${server5xx.length}`);

  // 5. Admin-gated truths that need operator credentials.
  for (const name of [
    'build diagnostics display the actually deployed commit (needs admin credentials)',
    '/admin/operations renders real production metrics (needs admin credentials)',
    'claim-path buckets reconcile to the approved public total (needs admin credentials)',
    'ownership review candidates visible to authorised admins (positive case; needs admin credentials)',
    'post-deploy canonical inventory snapshot captured (needs admin credentials)',
  ]) record('NOT VERIFIED', name, 'no production admin account available to this agent');

  console.log(lines.join('\n'));
  console.log(`\nRESULT  PASS=${pass}  FAIL=${fail}  NOT VERIFIED=${unverified}  (requests=${codes.length})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
