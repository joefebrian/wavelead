/**
 * READ-ONLY avatar pipeline diagnostic. ZERO writes.
 * Prints only hostnames + HTTP status — never full signed CDN URLs.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import path from 'node:path';
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db(process.env.DB_NAME || 'wavelead');

const rows = await db.collection('channels').find(
  { logo_url: { $ne: null }, is_demo: { $ne: true }, is_test_fixture: { $ne: true } },
).project({ slug: 1, name: 1, status: 1, logo_url: 1, follower_count: 1, follower_count_source: 1 }).limit(25).toArray();

console.log('=== channels holding a logo_url (non-demo, non-fixture):', rows.length);
const hostCount = {};
for (const r of rows) {
  let host = 'UNPARSEABLE';
  try { host = new URL(r.logo_url).hostname; } catch { /* keep */ }
  hostCount[host] = (hostCount[host] || 0) + 1;
  console.log(`  ${String(r.slug).padEnd(24)} status=${String(r.status).padEnd(15)} host=${host} len=${r.logo_url.length} f=${r.follower_count}`);
}
console.log('=== hostname histogram:', JSON.stringify(hostCount, null, 1));

console.log('\n=== live reachability probe (HEAD, then ranged GET fallback) ===');
for (const r of rows.slice(0, 8)) {
  let host = '?'; try { host = new URL(r.logo_url).hostname; } catch {}
  let line = `  ${String(r.slug).padEnd(24)} ${host.padEnd(28)} `;
  try {
    const ctl = AbortSignal.timeout(12000);
    let res = await fetch(r.logo_url, { method: 'HEAD', signal: ctl });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(r.logo_url, { method: 'GET', headers: { Range: 'bytes=0-64' }, signal: AbortSignal.timeout(12000) });
    }
    line += `HTTP ${res.status} content-type=${res.headers.get('content-type') || '-'} len=${res.headers.get('content-length') || '-'}`;
  } catch (e) {
    line += `NETWORK_ERROR ${e.name}: ${String(e.message).slice(0, 60)}`;
  }
  console.log(line);
}

// Did the repair script null anything out?
const nulled = await db.collection('channels').countDocuments({
  logo_url: null, is_demo: { $ne: true }, is_test_fixture: { $ne: true }, status: 'approved',
});
console.log('\napproved non-fixture channels with logo_url = null :', nulled);

await client.close();
