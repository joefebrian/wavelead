// WaveLead — SEO controlled repair for expired external WhatsApp CDN avatar URLs.
//
// The public SEO crawl flagged 20 pages with broken external images. These are
// stored `logo_url` values pointing at pre-signed WhatsApp CDN hosts that
// expire. Render-time we already suppress these URLs (see
// lib/seo/channelAvatar.ts), so crawlers no longer see broken <img src>.
// This script performs the corresponding DB cleanup: it clears ONLY the
// `logo_url` field on channel rows whose URL points at a volatile host, so
// the normal WaveLead fallback avatar renders and the WhatsApp metadata
// refresh job can populate a fresh URL when one is available.
//
// Safety invariants (do not weaken):
//   • Reads/writes ONLY the `logo_url` field. Never touches ownership,
//     financial state, follower counts, Campaign Commitment, marketplace
//     rows, or any other field.
//   • Refuses NODE_ENV=production unless CONFIRM_PRODUCTION_REPAIR=YES is
//     also set. This is an operator-initiated maintenance action, not an
//     automatic migration.
//   • Uses MONGO_URL / DB_NAME exclusively from process.env.
//   • Prints only counts and slugs — never prints the volatile URLs
//     themselves (they may contain signed tokens).
//
// Run:
//   NODE_ENV=<env> node scripts/repair_broken_avatars.mjs
//   NODE_ENV=production CONFIRM_PRODUCTION_REPAIR=YES node scripts/repair_broken_avatars.mjs
import { MongoClient } from 'mongodb';

const MONGO = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB = process.env.DB_NAME || 'wavelead';

const VOLATILE_HOST_SUFFIXES = ['.whatsapp.net', '.whatsapp.com', '.fbcdn.net'];
function isVolatile(hostname) {
  const h = String(hostname).toLowerCase();
  if (h === 'whatsapp.net' || h === 'whatsapp.com') return true;
  return VOLATILE_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

if ((process.env.NODE_ENV || '').toLowerCase() === 'production' && process.env.CONFIRM_PRODUCTION_REPAIR !== 'YES') {
  console.error('Refusing to run against production without CONFIRM_PRODUCTION_REPAIR=YES.');
  process.exit(2);
}

const client = new MongoClient(MONGO);
try {
  await client.connect();
  const db = client.db(DB);
  const channels = db.collection('channels');
  const cursor = channels.find({ logo_url: { $type: 'string', $ne: '' } }, { projection: { _id: 1, slug: 1, logo_url: 1 } });
  let scanned = 0;
  let cleared = 0;
  const volatileSlugs = [];
  while (await cursor.hasNext()) {
    const row = await cursor.next();
    scanned += 1;
    if (!row || !row.logo_url) continue;
    try {
      const u = new URL(String(row.logo_url));
      if (isVolatile(u.hostname)) {
        await channels.updateOne({ _id: row._id }, { $set: { logo_url: null, logo_url_repaired_at: new Date() } });
        cleared += 1;
        if (row.slug) volatileSlugs.push(row.slug);
      }
    } catch {
      // Non-URL / malformed — also volatile from an SEO standpoint.
      await channels.updateOne({ _id: row._id }, { $set: { logo_url: null, logo_url_repaired_at: new Date() } });
      cleared += 1;
      if (row.slug) volatileSlugs.push(row.slug);
    }
  }
  console.log(JSON.stringify({ ok: true, scanned, cleared, sample_slugs: volatileSlugs.slice(0, 20) }, null, 2));
} finally {
  await client.close();
}
