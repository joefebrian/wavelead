/**
 * READ-ONLY: avatar host/path-shape + reachability for REAL submitted channels.
 * Prints path shape and query-parameter NAMES only — never signed values.
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

const SAMPLES = ['bali-united-fc', 'agus-mulyadi', 'vijay-deverakonda', 'tiara-andini',
  'sticker-random-post', 'm05-final-sync-test', 'm05-test-channel'];

const rows = await db.collection('channels')
  .find({ slug: { $in: SAMPLES } })
  .project({ slug: 1, status: 1, logo_url: 1, cover_url: 1, follower_count: 1, follower_count_source: 1, created_at: 1 })
  .toArray();

for (const r of rows) {
  console.log(`\n--- ${r.slug}  (status=${r.status}, followers=${r.follower_count}, src=${r.follower_count_source})`);
  if (!r.logo_url) { console.log('    logo_url: NULL'); continue; }
  try {
    const u = new URL(r.logo_url);
    console.log(`    host      : ${u.hostname}`);
    console.log(`    path shape: ${u.pathname.replace(/[A-Za-z0-9_-]{12,}/g, '<id>')}`);
    console.log(`    query keys: ${[...u.searchParams.keys()].join(', ') || '(none)'}`);
    const hasExpiry = u.searchParams.has('oe') || u.searchParams.has('oh') || u.searchParams.has('_nc_oc');
    console.log(`    signed/expiring markers (oe/oh/_nc_oc): ${hasExpiry ? 'YES' : 'no'}`);
    try {
      let res = await fetch(r.logo_url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(r.logo_url, { method: 'GET', headers: { Range: 'bytes=0-64' }, signal: AbortSignal.timeout(12000) });
      }
      console.log(`    LIVE      : HTTP ${res.status} ${res.headers.get('content-type') || '-'} ${res.headers.get('content-length') || '-'}B`);
    } catch (e) {
      console.log(`    LIVE      : NETWORK_ERROR ${e.name}`);
    }
  } catch { console.log('    logo_url UNPARSEABLE'); }
}

// Probe a fresh enrichment to see what host the fetcher returns TODAY.
console.log('\n=== what does the live metadata fetcher return right now? ===');
const target = rows.find((r) => r.slug === 'bali-united-fc') || rows[0];
const ch = await db.collection('channels').findOne({ slug: target?.slug }, { projection: { whatsapp_url: 1, slug: 1 } });
console.log('probing OpenGraph for:', ch?.slug);
try {
  const res = await fetch(ch.whatsapp_url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WaveLeadBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  console.log('  page HTTP', res.status, 'html length', html.length);
  if (og) {
    const u = new URL(og[1].replace(/&amp;/g, '&'));
    console.log('  og:image host      :', u.hostname);
    console.log('  og:image path shape:', u.pathname.replace(/[A-Za-z0-9_-]{12,}/g, '<id>'));
    console.log('  og:image query keys:', [...u.searchParams.keys()].join(', ') || '(none)');
    const probe = await fetch(u.href, { method: 'GET', headers: { Range: 'bytes=0-64' }, signal: AbortSignal.timeout(12000) });
    console.log('  og:image LIVE      : HTTP', probe.status, probe.headers.get('content-type'), probe.headers.get('content-length') + 'B');
  } else {
    console.log('  no og:image found');
  }
} catch (e) { console.log('  fetch failed:', e.name, String(e.message).slice(0, 80)); }

await client.close();
