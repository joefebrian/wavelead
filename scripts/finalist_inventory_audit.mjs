/**
 * WaveLead — Finalist Readiness: operator-facing channel inventory audit.
 *
 * READ-ONLY. Performs ZERO writes, ZERO deletes, ZERO status changes.
 *
 * It imports the REAL shipped visibility policy from
 * lib/services/publicChannelVisibility.ts (transpiled on the fly with the
 * esbuild that already ships in node_modules), so the report can never drift
 * from the policy the application actually enforces.
 *
 * Usage:  node scripts/finalist_inventory_audit.mjs
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// ---- env (never printed) ---------------------------------------------------
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.MONGO_URL) { console.error('MONGO_URL is not set'); process.exit(1); }

// ---- load the real policy module -------------------------------------------
const tmp = path.join(process.cwd(), 'node_modules', '.cache', 'wavelead-audit');
fs.mkdirSync(tmp, { recursive: true });
const outfile = path.join(tmp, 'publicChannelVisibility.mjs');
await esbuild.build({
  entryPoints: [path.join(process.cwd(), 'lib/services/publicChannelVisibility.ts')],
  outfile, format: 'esm', platform: 'node', bundle: true, external: ['mongodb'], logLevel: 'silent',
});
const policy = await import(pathToFileURL(outfile).href);
const { buildPublicChannelFilter, publicVisibilitySuppressionReason } = policy;

// ---- connect ---------------------------------------------------------------
const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db(process.env.DB_NAME || 'wavelead');
const channels = db.collection('channels');

const all = await channels.find({}).project({
  id: 1, slug: 1, name: 1, status: 1, verification_status: 1, owner_id: 1,
  follower_count: 1, follower_count_source: 1, logo_url: 1, category_id: 1,
  country_code: 1, description: 1, whatsapp_url: 1, is_demo: 1,
  is_test_fixture: 1, is_featured: 1, created_at: 1,
}).toArray();

// Resolve which owner_ids point at an existing user — an orphaned owner_id is
// strong (but NOT decisive) evidence of a throw-away test record.
const userIds = new Set((await db.collection('users').find({}).project({ id: 1 }).toArray()).map((u) => u.id));

// A resolvable public WhatsApp Channel invite looks like
// https://whatsapp.com/channel/<invite-code>. Real invite codes issued by
// WhatsApp begin with "0029" and are ~22 chars.
const REAL_WA_INVITE = /^https:\/\/(?:www\.)?whatsapp\.com\/channel\/0029[A-Za-z0-9]{10,}$/;

const bucket = {
  suppressed: [],          // excluded by the shipped visibility policy
  eligible_public: [],     // approved + passes policy  → real public inventory
  pending: [],             // awaiting moderation       → never public
  rejected_or_removed: [], // rejected/suspended/archived
  ambiguous: [],           // passes policy but metadata too thin to trust
};
const reasons = {};

for (const c of all) {
  const reason = publicVisibilitySuppressionReason(c);
  if (reason) {
    reasons[reason] = (reasons[reason] || 0) + 1;
    bucket.suppressed.push({ ...c, _reason: reason });
    continue;
  }
  if (c.status === 'pending_review') { bucket.pending.push(c); continue; }
  if (c.status !== 'approved') { bucket.rejected_or_removed.push(c); continue; }

  // Approved AND not suppressed. Decide: confidently public, or ambiguous?
  const waOk = REAL_WA_INVITE.test(String(c.whatsapp_url || '').trim());
  const ownerOk = !c.owner_id || userIds.has(c.owner_id);
  const hasProfile = !!(c.description || '').trim() && !!c.country_code;
  if (waOk && ownerOk && hasProfile) bucket.eligible_public.push(c);
  else bucket.ambiguous.push({ ...c, _why: [!waOk && 'unresolvable_whatsapp_url', !ownerOk && 'orphaned_owner_id', !hasProfile && 'thin_metadata'].filter(Boolean).join(',') });
}

const submitted = all.filter((c) => c.follower_count_source === 'submitter' || c.owner_id);
const row = (c) => ({
  slug: c.slug, name: String(c.name || '').slice(0, 30), status: c.status,
  ownership: c.verification_status, followers: c.follower_count ?? null,
  source: c.follower_count_source ?? '—', country: c.country_code,
  avatar: c.logo_url ? 'yes' : 'no', category: c.category_id ? 'yes' : 'no',
});

console.log('================ WAVELEAD CHANNEL INVENTORY AUDIT (READ-ONLY) ================');
console.log('database                         :', db.databaseName);
console.log('total channel records            :', all.length);
console.log('  approved                       :', all.filter((c) => c.status === 'approved').length);
console.log('  pending_review                 :', all.filter((c) => c.status === 'pending_review').length);
console.log('  rejected / other               :', all.filter((c) => !['approved', 'pending_review'].includes(c.status)).length);
console.log('records carrying submission data :', submitted.length);
console.log('');
console.log('--- SUPPRESSED BY POLICY (demo / seed / fixture / internal) :', bucket.suppressed.length);
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(6)}  ${r}`);
}
console.log('');
console.log('--- ELIGIBLE PUBLIC INVENTORY                               :', bucket.eligible_public.length);
if (bucket.eligible_public.length) console.table(bucket.eligible_public.slice(0, 50).map(row));
console.log('--- AMBIGUOUS, REQUIRES HUMAN REVIEW (kept hidden, NOT deleted) :', bucket.ambiguous.length);
if (bucket.ambiguous.length) console.table(bucket.ambiguous.slice(0, 50).map((c) => ({ ...row(c), why: c._why })));
console.log('--- PENDING REVIEW (never public under existing policy)      :', bucket.pending.length);
if (bucket.pending.length) console.table(bucket.pending.map(row));
console.log('--- REJECTED / REMOVED (never public)                       :', bucket.rejected_or_removed.length);
if (bucket.rejected_or_removed.length) console.table(bucket.rejected_or_removed.map(row));

// Cross-check: what the application itself would return.
const liveCount = await channels.countDocuments(buildPublicChannelFilter({ status: 'approved' }));
console.log('');
console.log('cross-check — approved rows passing the SHIPPED Mongo filter :', liveCount);
console.log('(must equal eligible_public + ambiguous =', bucket.eligible_public.length + bucket.ambiguous.length, ')');

// Follower-observation coverage: can we honestly show growth anywhere?
const snaps = await db.collection('channel_audience_snapshots')
  .aggregate([{ $group: { _id: '$channel_id', n: { $sum: 1 } } }]).toArray();
const snapMap = new Map(snaps.map((s) => [s._id, s.n]));
const publicIds = [...bucket.eligible_public, ...bucket.ambiguous].map((c) => c.id);
console.log('eligible channels with >=1 follower observation             :', publicIds.filter((i) => snapMap.has(i)).length);
console.log('eligible channels with >=2 observations (growth showable)    :', publicIds.filter((i) => (snapMap.get(i) || 0) >= 2).length);
console.log('=============================== END OF AUDIT ================================');
console.log('NOTE: this script never writes. No record was created, modified or deleted.');

await client.close();
